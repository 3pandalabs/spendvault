// processDocument: decrypt → extract → categorize → dedupe → store. Idempotent:
// re-running it on the same document maps every line onto the same
// fingerprint, so nothing is inserted twice. DB-bound (the Temporal activity
// and the inline queue both call this).
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/index.js";
import { accounts, categoryRules, documents, pdfPasswords, transactions, users } from "../../db/schema.js";
import { env } from "../../env.js";
import { categorize, isCategory, type Category } from "../categories.js";
import { decrypt, decryptString, encrypt } from "../crypto.js";
import { institutionByKey, institutionFromText, type Institution } from "../institutions.js";
import { toDbAmount } from "../money.js";
import { replySafely } from "../whatsapp.js";
import { recomputeAlertsForUser } from "../insights/sweep.js";
import { looksLikeAlert, parseAlertText } from "./alert.js";
import { fileTypeOf } from "./classify.js";
import { categorizeWithLlm, extractStatementWithLlm, type LlmClient } from "./llm.js";
import { errKind, ingestLog } from "./log.js";
import { extractPdfText } from "./pdf.js";
import { fingerprints, reconcile } from "./reconcile.js";
import { parseStatementText } from "./statement.js";
import { parseCsvBuffer, parseXlsBuffer, parseXlsxBuffer, UnsupportedFormatError } from "./tabular.js";
import type { ParseResult } from "./types.js";

export type ProcessOptions = { password?: string; savePassword?: boolean };

type DocRow = typeof documents.$inferSelect;

let llmClient: LlmClient | null = null;
function llm(): LlmClient | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  llmClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return llmClient;
}

class NeedsPassword extends Error {}
class UserFacingError extends Error {}

// ---------------------------------------------------------------- passwords

type Candidate = { secret: string; savedId: string | null };

async function passwordCandidates(userId: string, institution: string | null, given?: string): Promise<Candidate[]> {
  const saved = await db.select().from(pdfPasswords).where(eq(pdfPasswords.userId, userId));
  const rank = (p: (typeof saved)[number]) => (institution && p.institution === institution ? 0 : p.institution === null ? 1 : 2);
  saved.sort((a, b) => rank(a) - rank(b) || (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0));
  const out: Candidate[] = given ? [{ secret: given, savedId: null }] : [];
  for (const p of saved) {
    try {
      out.push({ secret: decryptString(p.secretEnc, env.DATA_KEY), savedId: p.id });
    } catch {
      ingestLog.warn({ passwordId: p.id }, "saved password not decryptable");
    }
  }
  return out;
}

// ---------------------------------------------------------------- extraction

async function fromStatementText(pages: string[], inst: Institution | undefined): Promise<ParseResult> {
  const client = llm();
  if (client) {
    try {
      const r = await extractStatementWithLlm(client, env.ANTHROPIC_MODEL, { pages });
      if (r.txns.length) return r;
    } catch (err) {
      ingestLog.warn({ err: errKind(err) }, "llm extraction failed; using rules");
    }
  }
  const text = pages.join("\n");
  const rules = parseStatementText(text, { country: inst?.country, kinds: inst?.kinds });
  if (!rules.txns.length && text.length < 4000 && looksLikeAlert(text)) return parseAlertText(text);
  return rules;
}

type Extracted = { result: ParseResult; inst: Institution | undefined; usedPassword: Candidate | null };

async function extract(doc: DocRow, buf: Buffer, opts: ProcessOptions): Promise<Extracted> {
  let inst = institutionByKey(doc.institution);
  const type = fileTypeOf(doc.mimeType, doc.filename, buf.subarray(0, 8));
  switch (type) {
    case "pdf": {
      const candidates = await passwordCandidates(doc.userId, doc.institution, opts.password);
      const pdf = await extractPdfText(buf, candidates.map((c) => c.secret));
      if (!pdf.ok) throw new NeedsPassword();
      inst ??= institutionFromText(pdf.pages[0]?.slice(0, 3000));
      const result = await fromStatementText(pdf.pages, inst);
      return { result, inst, usedPassword: pdf.passwordIndex === null ? null : candidates[pdf.passwordIndex] };
    }
    case "csv":
      return { result: parseCsvBuffer(buf, { country: inst?.country, kinds: inst?.kinds }), inst, usedPassword: null };
    case "xlsx":
      return { result: await parseXlsxBuffer(buf, { country: inst?.country, kinds: inst?.kinds }), inst, usedPassword: null };
    case "xls":
      return { result: parseXlsBuffer(buf, { country: inst?.country, kinds: inst?.kinds }), inst, usedPassword: null };
    case "text": {
      const text = buf.toString("utf8");
      inst ??= institutionFromText(text.slice(0, 3000));
      const fallbackDate = text.match(/\[email-date: (\d{4}-\d{2}-\d{2})\]/)?.[1] ?? doc.createdAt.toISOString().slice(0, 10);
      if (doc.kind === "alert") {
        let result = parseAlertText(text, { order: inst?.country === "US" ? "MDY" : undefined, fallbackDate });
        const client = llm();
        if (!result.txns.length && client) {
          try {
            const r = await extractStatementWithLlm(client, env.ANTHROPIC_MODEL, { pages: [text] });
            result = { ...r, parser: "llm", sourceKind: "alert" };
          } catch (err) {
            ingestLog.warn({ documentId: doc.id, err: errKind(err) }, "llm alert fallback failed");
          }
        }
        return { result, inst, usedPassword: null };
      }
      return { result: await fromStatementText([text], inst), inst, usedPassword: null };
    }
    case "image": {
      const client = llm();
      if (!client) throw new UserFacingError("Photos need AI parsing, which isn't enabled. Send the statement PDF instead.");
      const mediaType = (["image/png", "image/webp"].includes(doc.mimeType) ? doc.mimeType : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
      const result = await extractStatementWithLlm(client, env.ANTHROPIC_MODEL, { image: { mediaType, data: buf } });
      return { result, inst, usedPassword: null };
    }
    default:
      throw new UserFacingError("Unsupported file type");
  }
}

// ---------------------------------------------------------------- categorize

async function categorizeAll(userId: string, result: ParseResult) {
  const rules = await db.select({ merchant: categoryRules.merchant, category: categoryRules.category }).from(categoryRules).where(eq(categoryRules.userId, userId));
  const map = new Map<string, Category>();
  for (const r of rules) if (isCategory(r.category)) map.set(r.merchant.toLowerCase(), r.category);
  const cats = result.txns.map((t) => categorize(t.description, t.direction, map));
  const client = llm();
  const unmatched = cats.map((c, i) => ({ c, i })).filter((x) => !x.c.matched);
  if (client && unmatched.length) {
    try {
      const batch = unmatched.slice(0, 100);
      const res = await categorizeWithLlm(
        client,
        env.ANTHROPIC_MODEL,
        batch.map((x) => ({ description: result.txns[x.i].description, direction: result.txns[x.i].direction })),
      );
      for (const [j, v] of res) {
        const i = batch[j].i;
        // A user rule on the LLM's merchant name still wins.
        cats[i] = { merchant: v.merchant, category: map.get(v.merchant.toLowerCase()) ?? v.category, matched: true };
      }
    } catch (err) {
      ingestLog.warn({ err: errKind(err) }, "llm categorization failed");
    }
  }
  return cats;
}

// ---------------------------------------------------------------- persist

const ACCOUNT_MATCH = (alias: string, accountId: string | null, institution: string, last4: string) => sql`(
  ${sql.raw(alias)}.account_id IS NULL
  OR ${sql.raw(alias)}.account_id = ${accountId}::uuid
  OR ((a.institution = ${institution}::text OR a.institution = 'unknown' OR ${institution}::text = 'unknown')
      AND (a.last4 = '' OR ${last4}::text = '' OR a.last4 = ${last4}::text)))`;

async function supersedeAlertFor(tx: DbOrTx, userId: string, stmt: { id: string; amount: string; direction: string; postedOn: string }, accountId: string | null, institution: string, last4: string) {
  await tx.execute(sql`
    UPDATE transactions SET superseded_by = ${stmt.id}
    WHERE id = (
      SELECT t.id FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = ${userId} AND t.source_kind = 'alert' AND t.superseded_by IS NULL
        AND t.amount = ${stmt.amount}::numeric AND t.direction = ${stmt.direction}
        AND t.posted_on BETWEEN ${stmt.postedOn}::date - 3 AND ${stmt.postedOn}::date + 3
        AND ${ACCOUNT_MATCH("t", accountId, institution, last4)}
      ORDER BY abs(t.posted_on - ${stmt.postedOn}::date), t.created_at
      LIMIT 1 FOR UPDATE OF t SKIP LOCKED)`);
}

async function coveringStatementTxn(tx: DbOrTx, userId: string, t: { amount: string; direction: string; postedOn: string }, accountId: string | null, institution: string, last4: string): Promise<string | null> {
  const res = await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM transactions s LEFT JOIN accounts a ON a.id = s.account_id
    WHERE s.user_id = ${userId} AND s.source_kind IN ('statement', 'csv') AND s.superseded_by IS NULL
      AND s.amount = ${t.amount}::numeric AND s.direction = ${t.direction}
      AND s.posted_on BETWEEN ${t.postedOn}::date - 3 AND ${t.postedOn}::date + 3
      AND ${ACCOUNT_MATCH("s", accountId, institution, last4)}
      AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.user_id = ${userId} AND x.superseded_by = s.id)
    ORDER BY abs(s.posted_on - ${t.postedOn}::date)
    LIMIT 1`);
  return res.rows[0]?.id ?? null;
}

type Outcome = { txnCount: number; parsedCount: number; institution: string | null };

async function persist(doc: DocRow, ex: Extracted, user: typeof users.$inferSelect): Promise<Outcome> {
  const { result } = ex;
  const inst = ex.inst ?? institutionFromText(result.institutionName ?? undefined);
  const institution = inst?.key ?? "unknown";
  const last4 = result.last4 ?? "";
  const currency = (result.currency || (inst?.country === "US" ? "USD" : user.baseCurrency)).toUpperCase();
  const cats = result.txns.length ? await categorizeAll(doc.userId, result) : [];
  const rec = reconcile({ accountKind: result.accountKind, previousBalance: result.previousBalance, totalDue: result.totalDue, closingBalance: result.closingBalance, txns: result.txns });

  return db.transaction(async (tx) => {
    let accountId: string | null = null;
    if (result.txns.length) {
      const [acct] = await tx
        .insert(accounts)
        .values({ userId: doc.userId, institution, kind: result.accountKind, last4, currency })
        .onConflictDoUpdate({ target: [accounts.userId, accounts.institution, accounts.kind, accounts.last4], set: { currency } })
        .returning({ id: accounts.id });
      accountId = acct.id;
    }
    const isAlert = result.sourceKind === "alert";
    const fps = fingerprints(accountId, result.txns, isAlert ? "alert" : "statement");
    for (let i = 0; i < result.txns.length; i += 200) {
      const slice = result.txns.slice(i, i + 200);
      const values = [];
      for (let j = 0; j < slice.length; j++) {
        const t = slice[j];
        const amount = toDbAmount(t.amount);
        const supersededBy = isAlert ? await coveringStatementTxn(tx, doc.userId, { amount, direction: t.direction, postedOn: t.postedOn }, accountId, institution, last4) : null;
        values.push({
          userId: doc.userId,
          accountId,
          documentId: doc.id,
          postedOn: t.postedOn,
          descriptionRaw: t.description,
          merchant: cats[i + j].merchant.slice(0, 80) || "Unknown",
          category: cats[i + j].category,
          amount,
          direction: t.direction,
          currency,
          sourceKind: result.sourceKind,
          fingerprint: fps[i + j],
          supersededBy,
        });
      }
      const inserted = await tx
        .insert(transactions)
        .values(values)
        .onConflictDoNothing({ target: [transactions.userId, transactions.fingerprint] })
        .returning({ id: transactions.id, amount: transactions.amount, direction: transactions.direction, postedOn: transactions.postedOn });
      if (!isAlert) {
        for (const s of inserted) await supersedeAlertFor(tx, doc.userId, s, accountId, institution, last4);
      }
    }
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, doc.userId), eq(transactions.documentId, doc.id)));

    const parsedOk = result.txns.length > 0;
    const keepOriginal = !user.deleteOriginals;
    await tx
      .update(documents)
      .set({
        status: parsedOk ? "parsed" : "ignored",
        error: parsedOk ? null : "no transactions found",
        kind: doc.kind === "unknown" ? (isAlert ? "alert" : "statement") : doc.kind,
        institution: inst?.key ?? doc.institution,
        accountId,
        periodStart: result.periodStart ?? null,
        periodEnd: result.periodEnd ?? null,
        statementTotal: rec.statementTotal === null ? null : toDbAmount(rec.statementTotal),
        extractedDebits: parsedOk ? toDbAmount(rec.extractedDebits) : null,
        reconciled: rec.reconciled,
        txnCount: n,
        parser: result.parser,
        processedAt: new Date(),
        ...(keepOriginal ? {} : { contentEnc: null }),
      })
      .where(eq(documents.id, doc.id));
    return { txnCount: n, parsedCount: result.txns.length, institution: inst?.key ?? doc.institution };
  });
}

// ---------------------------------------------------------------- notify

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d: string, withYear: boolean) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MON[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (!start || !end || start === end) return fmtDate((start ?? end)!, true);
  return `${fmtDate(start, start.slice(0, 4) !== end.slice(0, 4))} – ${fmtDate(end, true)}`;
}

async function notifyWhatsApp(documentId: string, message: string) {
  const [d] = await db.select({ source: documents.source, whatsappFrom: documents.whatsappFrom }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (d?.source !== "whatsapp" || !d.whatsappFrom) return;
  await replySafely(d.whatsappFrom, message, (msg) => ingestLog.warn({ documentId }, msg));
}

// ---------------------------------------------------------------- entry

export async function processDocument(documentId: string, opts: ProcessOptions = {}): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return;
  const [user] = await db.select().from(users).where(eq(users.id, doc.userId)).limit(1);
  if (!user || user.deletedAt) return;
  if (!doc.contentEnc) {
    if (doc.status !== "parsed" && doc.status !== "ignored") {
      await db.update(documents).set({ status: "failed", error: "original deleted" }).where(eq(documents.id, doc.id));
    }
    return;
  }
  await db.update(documents).set({ status: "processing", error: null }).where(eq(documents.id, doc.id));
  try {
    const buf = decrypt(doc.contentEnc, env.DATA_KEY);
    const ex = await extract(doc, buf, opts);

    if (ex.usedPassword?.savedId) {
      await db.update(pdfPasswords).set({ lastUsedAt: new Date() }).where(and(eq(pdfPasswords.id, ex.usedPassword.savedId), eq(pdfPasswords.userId, doc.userId)));
    } else if (ex.usedPassword && opts.savePassword) {
      const instKey = ex.inst?.key ?? doc.institution ?? null;
      const name = institutionByKey(instKey)?.name;
      await db.insert(pdfPasswords).values({
        userId: doc.userId,
        institution: instKey,
        label: name ? `${name} statement password` : "Statement password",
        secretEnc: encrypt(ex.usedPassword.secret, env.DATA_KEY),
      });
    }

    const out = await persist(doc, ex, user);
    ingestLog.info({ documentId, userId: doc.userId, parser: ex.result.parser, txns: out.txnCount }, "document processed");
    if (out.parsedCount > 0) {
      try {
        await recomputeAlertsForUser(doc.userId);
      } catch (err) {
        ingestLog.warn({ userId: doc.userId, err: errKind(err) }, "alert recompute failed");
      }
      const name = institutionByKey(out.institution)?.name ?? "your statement";
      const period = formatPeriod(ex.result.periodStart ?? null, ex.result.periodEnd ?? null);
      await notifyWhatsApp(doc.id, `${out.txnCount} transaction${out.txnCount === 1 ? "" : "s"} added from ${name}${period ? ` (${period})` : ""}`);
    } else {
      await notifyWhatsApp(doc.id, "No transactions found in that file. If it's a statement, try the PDF the bank emailed you.");
    }
  } catch (err) {
    if (err instanceof NeedsPassword) {
      await db.update(documents).set({ status: "needs_password", error: opts.password ? "password incorrect" : "password required" }).where(eq(documents.id, doc.id));
      await notifyWhatsApp(
        doc.id,
        opts.password
          ? "That password didn't work — reply with the correct password, or add it in SpendVault > Setup."
          : "This PDF is password-protected — reply with the password, or add it in SpendVault > Setup.",
      );
      return;
    }
    const message = err instanceof UserFacingError || err instanceof UnsupportedFormatError ? err.message : "Could not read this document";
    await db.update(documents).set({ status: "failed", error: message.slice(0, 200), processedAt: new Date() }).where(eq(documents.id, doc.id));
    ingestLog.error({ documentId, err: errKind(err) }, "document processing failed");
    await notifyWhatsApp(doc.id, `Couldn't read that file: ${message}`);
  }
}
