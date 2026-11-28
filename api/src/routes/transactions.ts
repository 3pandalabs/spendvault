import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { accounts, categoryRules, transactionSplits, transactions, users } from "../db/schema.js";
import { CATEGORIES, CATEGORY_KEYS, NON_SPEND, categorize, isCategory, type Category } from "../lib/categories.js";
import { conflict, invalid, notFound } from "../lib/errors.js";
import { CASH_ACCOUNT, MANUAL, cleanMerchant, manualFingerprint, validManualDate } from "../lib/manualTxn.js";
import { rematchReceiptsForUser } from "../lib/receipts/db.js";
import { todayFor } from "../lib/userTime.js";
import type { DbOrTx } from "../db/index.js";
import { MAX_NOTE_LENGTH, MAX_TAG_LENGTH, MAX_TAGS, normalizeNote, normalizeTags, ruleKey, SplitError, validateSplit } from "../lib/txnTools.js";
import { toDbAmount } from "../lib/money.js";
import { institutionName } from "../lib/institutions.js";
import { num } from "../lib/money.js";
import { recomputeAlertsForUser } from "../lib/insights/sweep.js";
import { scopeUserIds } from "../lib/household/db.js";

type TxnRow = typeof transactions.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The `Transaction` shape from ROUTES.md. `receiptId` = the linked receipt, if any. */
export function transactionView(t: TxnRow, receiptId: string | null = null, hasSplit = false) {
  return {
    id: t.id,
    accountId: t.accountId,
    documentId: t.documentId,
    postedOn: t.postedOn,
    descriptionRaw: t.descriptionRaw,
    merchant: t.merchant,
    category: t.category,
    amount: num(t.amount),
    direction: t.direction,
    currency: t.currency,
    sourceKind: t.sourceKind,
    categoryLocked: t.categoryLocked,
    receiptId,
    tags: t.tags ?? [],
    note: t.note ?? null,
    hasSplit,
  };
}

/** The `Account` shape from ROUTES.md. */
export function accountView(a: AccountRow, txnCount: number, lastTxnOn: string | null) {
  return {
    id: a.id,
    institution: a.institution,
    institutionName: institutionName(a.institution),
    kind: a.kind,
    last4: a.last4,
    label: a.label,
    currency: a.currency,
    includeInNetWorth: a.includeInNetWorth,
    txnCount,
    lastTxnOn,
  };
}

async function accountWithCounts(userId: string, a: AccountRow) {
  const r = await db.execute<{ n: number; last: string | null }>(sql`
    SELECT count(*)::int AS n, max(posted_on)::text AS last FROM transactions
    WHERE user_id = ${userId} AND account_id = ${a.id} AND superseded_by IS NULL`);
  return accountView(a, r.rows[0]?.n ?? 0, r.rows[0]?.last ?? null);
}

// Cursor = base64url JSON of the last row's (postedOn, id).
const encodeCursor = (t: { postedOn: string; id: string }) => Buffer.from(JSON.stringify([t.postedOn, t.id])).toString("base64url");
function decodeCursor(c: string): { postedOn: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && DATE.test(v[0]) && typeof v[1] === "string" && UUID.test(v[1])) {
      return { postedOn: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

const manualMoney = z.number().finite().positive().max(1e9);

/** The caller's "Cash" account, created on first use (the accounts unique index keeps it single). */
async function cashAccount(tx: DbOrTx, userId: string, currency: string): Promise<AccountRow> {
  await tx
    .insert(accounts)
    .values({ userId, institution: CASH_ACCOUNT.institution, kind: CASH_ACCOUNT.kind, last4: CASH_ACCOUNT.last4, label: CASH_ACCOUNT.label, currency, includeInNetWorth: false })
    .onConflictDoNothing({ target: [accounts.userId, accounts.institution, accounts.kind, accounts.last4] });
  const [a] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.institution, CASH_ACCOUNT.institution), eq(accounts.kind, CASH_ACCOUNT.kind), eq(accounts.last4, CASH_ACCOUNT.last4)))
    .limit(1);
  return a;
}

/** accountId given → that account (must be the caller's, else 404); null/omitted → Cash. */
async function manualAccount(tx: DbOrTx, userId: string, accountId: string | null | undefined, baseCurrency: string): Promise<AccountRow> {
  if (!accountId) return cashAccount(tx, userId, baseCurrency);
  if (!UUID.test(accountId)) throw notFound();
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId))).limit(1);
  if (!a) throw notFound();
  return a;
}

/** Category for a typed-in merchant: the user's rule, then the built-in map, else Other (debits) / Income (credits). */
async function guessCategory(userId: string, merchant: string, direction: "debit" | "credit"): Promise<Category> {
  const rules = await db.select({ merchant: categoryRules.merchant, category: categoryRules.category }).from(categoryRules).where(eq(categoryRules.userId, userId));
  const map = new Map<string, Category>(rules.filter((r) => isCategory(r.category)).map((r) => [r.merchant, r.category as Category]));
  return map.get(merchant.trim().toLowerCase()) ?? categorize(merchant, direction, map).category;
}

async function manualBasics(userId: string) {
  const [u] = await db.select({ baseCurrency: users.baseCurrency, timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound();
  return { currency: u.baseCurrency, today: todayFor(u) };
}

/** After a manual write: refresh alerts and try to match receipts (both fail-soft, in the background). */
function afterManualWrite(userId: string, log: (o: object, m: string) => void) {
  void recomputeAlertsForUser(userId).catch((err) => log({ userId, err: String(err).slice(0, 200) }, "alert recompute failed"));
  void rematchReceiptsForUser(userId).catch((err) => log({ userId, err: String(err).slice(0, 200) }, "receipt rematch failed"));
}

async function txnExtras(userId: string, id: string) {
  const extra = await db.execute<{ has: boolean; receipt_id: string | null }>(sql`
    SELECT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = ${id}) AS has,
           (SELECT r.id FROM receipts r WHERE r.transaction_id = ${id} AND r.user_id = ${userId}) AS receipt_id`);
  return { receiptId: extra.rows[0]?.receipt_id ?? null, hasSplit: extra.rows[0]?.has ?? false };
}

export async function transactionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/categories", async () => ({
    items: CATEGORY_KEYS.map((key) => ({
      key,
      label: CATEGORIES[key].label,
      essential: CATEGORIES[key].essential,
      spend: !NON_SPEND.has(key),
    })),
  }));

  // ---------------------------------------------------------------- accounts

  app.get("/accounts", { preHandler: requireAuth }, async (req) => {
    const userId = req.userId!;
    const [rows, counts] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.createdAt),
      db.execute<{ account_id: string; n: number; last: string | null }>(sql`
        SELECT account_id, count(*)::int AS n, max(posted_on)::text AS last FROM transactions
        WHERE user_id = ${userId} AND superseded_by IS NULL AND account_id IS NOT NULL GROUP BY account_id`),
    ]);
    const byAcct = new Map(counts.rows.map((r) => [r.account_id, r]));
    return { items: rows.map((a) => accountView(a, byAcct.get(a.id)?.n ?? 0, byAcct.get(a.id)?.last ?? null)) };
  });

  app.patch(
    "/accounts/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ label: z.string().trim().max(60).nullable(), includeInNetWorth: z.boolean() }).partial().strict(),
      },
    },
    async (req) => {
      if (!UUID.test(req.params.id)) throw notFound();
      const set: { label?: string | null; includeInNetWorth?: boolean } = {};
      if (req.body.label !== undefined) set.label = req.body.label ? req.body.label : null;
      if (req.body.includeInNetWorth !== undefined) set.includeInNetWorth = req.body.includeInNetWorth;
      if (Object.keys(set).length === 0) {
        const [cur] = await db.select().from(accounts).where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!))).limit(1);
        if (!cur) throw notFound();
        return accountWithCounts(req.userId!, cur);
      }
      const [a] = await db
        .update(accounts)
        .set(set)
        .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
        .returning();
      if (!a) throw notFound();
      return accountWithCounts(req.userId!, a);
    },
  );

  // ---------------------------------------------------------------- transactions

  app.get(
    "/transactions",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          from: z.string().regex(DATE).optional(),
          to: z.string().regex(DATE).optional(),
          category: z.string().max(40).optional(),
          accountId: z.string().max(40).optional(),
          q: z.string().trim().max(100).optional(),
          tag: z.string().trim().max(40).optional(),
          direction: z.enum(["debit", "credit"]).optional(),
          source: z.enum(["statement", "alert", "csv", "manual"]).optional(),
          documentId: z.string().max(40).optional(),
          scope: z.enum(["me", "household"]).optional(),
          member: z.string().max(40).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          cursor: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const qs = req.query;
      if (qs.accountId && !UUID.test(qs.accountId)) return { items: [], nextCursor: null };
      if (qs.documentId && !UUID.test(qs.documentId)) return { items: [], nextCursor: null };
      if (qs.member && qs.member !== "all" && !UUID.test(qs.member)) throw notFound();
      const scope = await scopeUserIds(req.userId!, qs.scope, qs.member);
      const household = qs.scope === "household" && scope.members.length > 0;
      const cursor = qs.cursor ? decodeCursor(qs.cursor) : null;
      if (qs.cursor && !cursor) return reply.code(400).send({ error: "invalid_cursor", code: "VALIDATION" });
      const like = qs.q ? `%${escapeLike(qs.q)}%` : null;
      const rows = await db
        .select({
          t: transactions,
          receiptId: sql<string | null>`(SELECT r.id FROM receipts r WHERE r.transaction_id = ${transactions.id})`,
          hasSplit: sql<boolean>`EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = ${transactions.id})`,
        })
        .from(transactions)
        .where(
          and(
            scope.ids.length === 1 ? eq(transactions.userId, scope.ids[0]) : inArray(transactions.userId, scope.ids),
            isNull(transactions.supersededBy),
            qs.documentId ? eq(transactions.documentId, qs.documentId) : undefined,
            qs.from ? gte(transactions.postedOn, qs.from) : undefined,
            qs.to ? lte(transactions.postedOn, qs.to) : undefined,
            qs.category ? eq(transactions.category, qs.category) : undefined,
            qs.accountId ? eq(transactions.accountId, qs.accountId) : undefined,
            qs.direction ? eq(transactions.direction, qs.direction) : undefined,
            qs.source ? eq(transactions.sourceKind, qs.source) : undefined,
            like ? or(ilike(transactions.merchant, like), ilike(transactions.descriptionRaw, like), ilike(transactions.note, like)) : undefined,
            qs.tag ? sql`${normalizeTags([qs.tag])[0] ?? ""} = ANY(${transactions.tags})` : undefined,
            cursor ? sql`(${transactions.postedOn}, ${transactions.id}) < (${cursor.postedOn}::date, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(transactions.postedOn), desc(transactions.id))
        .limit(qs.limit + 1);
      const page = rows.slice(0, qs.limit);
      return {
        items: page.map((r) => (household ? { ...transactionView(r.t, r.receiptId, r.hasSplit), ownerId: r.t.userId } : transactionView(r.t, r.receiptId, r.hasSplit))),
        nextCursor: rows.length > qs.limit ? encodeCursor(page[page.length - 1].t) : null,
      };
    },
  );

  // ---------------------------------------------------------------- manual (cash) transactions (0005)

  app.post(
    "/transactions",
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            postedOn: z.string().regex(DATE),
            amount: manualMoney,
            direction: z.enum(["debit", "credit"]).default("debit"),
            merchant: z.string().max(200),
            category: z.string().refine(isCategory, "unknown category").optional(),
            accountId: z.string().max(40).nullable().optional(),
            note: z.string().max(MAX_NOTE_LENGTH * 2).nullable().optional(),
            tags: z.array(z.string().max(MAX_TAG_LENGTH + 10)).max(MAX_TAGS * 2).optional(),
          })
          .strict(),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const b = req.body;
      const { currency, today } = await manualBasics(userId);
      if (!validManualDate(b.postedOn, today)) throw invalid("invalid_date");
      const merchant = cleanMerchant(b.merchant);
      if (!merchant) throw invalid("merchant_required");
      const category = (b.category as Category | undefined) ?? (await guessCategory(userId, merchant, b.direction));
      const row = await db.transaction(async (tx) => {
        const acct = await manualAccount(tx, userId, b.accountId, currency);
        const [t] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId: acct.id,
            documentId: null,
            postedOn: b.postedOn,
            descriptionRaw: merchant,
            merchant,
            category,
            amount: toDbAmount(b.amount),
            direction: b.direction,
            currency: acct.currency,
            sourceKind: MANUAL,
            fingerprint: manualFingerprint(),
            categoryLocked: b.category !== undefined,
            tags: normalizeTags(b.tags ?? []),
            note: normalizeNote(b.note ?? null),
          })
          .returning();
        return t;
      });
      req.log.info({ userId, txnId: row.id }, "manual transaction added");
      afterManualWrite(userId, (o, m) => req.log.warn(o, m));
      return reply.code(201).send(transactionView(row));
    },
  );

  app.delete("/transactions/:id", { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const userId = req.userId!;
    if (!UUID.test(req.params.id)) throw notFound();
    const [t] = await db.select({ id: transactions.id, sourceKind: transactions.sourceKind }).from(transactions).where(and(eq(transactions.id, req.params.id), eq(transactions.userId, userId))).limit(1);
    if (!t) throw notFound();
    // Statement/alert rows come from a document: delete the document instead.
    if (t.sourceKind !== MANUAL) throw conflict("not_manual");
    await db.delete(transactions).where(and(eq(transactions.id, t.id), eq(transactions.userId, userId), eq(transactions.sourceKind, MANUAL)));
    req.log.info({ userId, txnId: t.id }, "manual transaction deleted");
    afterManualWrite(userId, (o, m) => req.log.warn(o, m));
    return reply.code(204).send();
  });

  app.patch(
    "/transactions/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z
          .object({
            category: z.string().refine(isCategory, "unknown category").optional(),
            applyToMerchant: z.boolean().optional(),
            tags: z.array(z.string().max(MAX_TAG_LENGTH + 10)).max(MAX_TAGS * 2).optional(),
            note: z.string().max(MAX_NOTE_LENGTH * 2).nullable().optional(),
            // Manual rows only (409 not_manual otherwise): what the bank reported stays as reported.
            postedOn: z.string().regex(DATE).optional(),
            amount: manualMoney.optional(),
            merchant: z.string().max(200).optional(),
            direction: z.enum(["debit", "credit"]).optional(),
            accountId: z.string().max(40).nullable().optional(),
          })
          .refine((b) => Object.values(b).some((v) => v !== undefined), "empty patch"),
      },
    },
    async (req) => {
      const userId = req.userId!;
      if (!UUID.test(req.params.id)) throw notFound();
      const { category, applyToMerchant, tags, note, postedOn, amount, merchant: rawMerchant, direction, accountId } = req.body;
      const manualEdit = postedOn !== undefined || amount !== undefined || rawMerchant !== undefined || direction !== undefined || accountId !== undefined;
      const manualSet: Partial<typeof transactions.$inferInsert> = {};
      if (manualEdit) {
        const [cur] = await db.select({ sourceKind: transactions.sourceKind }).from(transactions).where(and(eq(transactions.id, req.params.id), eq(transactions.userId, userId))).limit(1);
        if (!cur) throw notFound();
        if (cur.sourceKind !== MANUAL) throw conflict("not_manual");
        const { currency, today } = await manualBasics(userId);
        if (postedOn !== undefined) {
          if (!validManualDate(postedOn, today)) throw invalid("invalid_date");
          manualSet.postedOn = postedOn;
        }
        if (amount !== undefined) manualSet.amount = toDbAmount(amount);
        if (direction !== undefined) manualSet.direction = direction;
        if (rawMerchant !== undefined) {
          const m = cleanMerchant(rawMerchant);
          if (!m) throw invalid("merchant_required");
          manualSet.merchant = m;
          manualSet.descriptionRaw = m;
        }
        if (accountId !== undefined) {
          const acct = await manualAccount(db, userId, accountId, currency);
          manualSet.accountId = acct.id;
          manualSet.currency = acct.currency;
        }
      }
      const updated = await db.transaction(async (tx) => {
        const [t] = await tx
          .update(transactions)
          .set({
            ...(category ? { category, categoryLocked: true } : {}),
            ...(tags !== undefined ? { tags: normalizeTags(tags) } : {}),
            ...(note !== undefined ? { note: normalizeNote(note) } : {}),
            ...manualSet,
          })
          .where(
            and(
              eq(transactions.id, req.params.id),
              eq(transactions.userId, userId),
              manualEdit ? eq(transactions.sourceKind, MANUAL) : undefined,
            ),
          )
          .returning();
        if (!t) return null;
        if (category && applyToMerchant) {
          const key = t.merchant.trim().toLowerCase();
          await tx
            .insert(categoryRules)
            .values({ userId, merchant: key, category })
            .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.merchant], set: { category } });
          await tx
            .update(transactions)
            .set({ category })
            .where(
              and(
                eq(transactions.userId, userId),
                eq(transactions.categoryLocked, false),
                sql`lower(trim(${transactions.merchant})) = ${key}`,
              ),
            );
        }
        return t;
      });
      if (!updated) throw notFound();
      // Categories feed the spike detector; refresh this user's alerts (fail-soft).
      if (manualEdit) afterManualWrite(userId, (o, m) => req.log.warn(o, m));
      else if (category) void recomputeAlertsForUser(userId).catch((err) => req.log.warn({ userId, err: String(err) }, "alert recompute failed"));
      const extra = await txnExtras(userId, updated.id);
      return transactionView(updated, extra.receiptId, extra.hasSplit);
    },
  );

  // ---------------------------------------------------------------- splits

  app.put(
    "/transactions/:id/splits",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ parts: z.array(z.object({ category: z.string().max(40), amount: z.number().finite() })).max(20) }),
      },
    },
    async (req) => {
      const userId = req.userId!;
      if (!UUID.test(req.params.id)) throw notFound();
      const [t] = await db.select().from(transactions).where(and(eq(transactions.id, req.params.id), eq(transactions.userId, userId))).limit(1);
      if (!t) throw notFound();
      if (t.direction !== "debit") throw invalid("split_debits_only");
      let parts: Array<{ category: string; amount: number }> = [];
      if (req.body.parts.length) {
        try {
          parts = validateSplit(num(t.amount), req.body.parts);
        } catch (err) {
          if (err instanceof SplitError) throw invalid(err.message);
          throw err;
        }
      }
      await db.transaction(async (tx) => {
        await tx.delete(transactionSplits).where(and(eq(transactionSplits.transactionId, t.id), eq(transactionSplits.userId, userId)));
        if (parts.length) {
          await tx.insert(transactionSplits).values(parts.map((p, i) => ({ userId, transactionId: t.id, position: i, category: p.category, amount: toDbAmount(p.amount) })));
        }
      });
      return { parts };
    },
  );

  app.delete("/transactions/:id/splits", { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const [t] = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, req.params.id), eq(transactions.userId, req.userId!))).limit(1);
    if (!t) throw notFound();
    await db.delete(transactionSplits).where(and(eq(transactionSplits.transactionId, t.id), eq(transactionSplits.userId, req.userId!)));
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- tags + rules

  app.get("/tags", { preHandler: requireAuth }, async (req) => {
    const r = await db.execute<{ tag: string; n: number }>(sql`
      SELECT tag, count(*)::int AS n FROM transactions, unnest(tags) AS tag
      WHERE user_id = ${req.userId!} AND superseded_by IS NULL GROUP BY tag ORDER BY n DESC, tag LIMIT 100`);
    return { items: r.rows.map((x) => ({ tag: x.tag, count: x.n })) };
  });

  app.get("/category-rules", { preHandler: requireAuth }, async (req) => {
    const rows = await db.select().from(categoryRules).where(eq(categoryRules.userId, req.userId!)).orderBy(categoryRules.merchant);
    return { items: rows.map((r) => ({ id: r.id, merchant: r.merchant, category: r.category, createdAt: r.createdAt.toISOString() })) };
  });

  app.post(
    "/category-rules",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({ merchant: z.string().trim().min(1).max(80), category: z.string().refine(isCategory, "unknown category"), applyToPast: z.boolean().default(true) }),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const key = ruleKey(req.body.merchant);
      const { category, applyToPast } = req.body;
      const [rule, updated] = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(categoryRules)
          .values({ userId, merchant: key, category })
          .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.merchant], set: { category } })
          .returning();
        const changed = applyToPast
          ? await tx
              .update(transactions)
              .set({ category })
              .where(and(eq(transactions.userId, userId), eq(transactions.categoryLocked, false), sql`lower(trim(${transactions.merchant})) = ${key}`))
              .returning({ id: transactions.id })
          : [];
        return [r, changed.length] as const;
      });
      if (updated) void recomputeAlertsForUser(userId).catch((err) => req.log.warn({ userId, err: String(err) }, "alert recompute failed"));
      return reply.code(201).send({ rule: { id: rule.id, merchant: rule.merchant, category: rule.category, createdAt: rule.createdAt.toISOString() }, updated });
    },
  );

  app.delete("/category-rules/:id", { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const del = await db.delete(categoryRules).where(and(eq(categoryRules.id, req.params.id), eq(categoryRules.userId, req.userId!))).returning({ id: categoryRules.id });
    if (!del.length) throw notFound();
    return reply.code(204).send();
  });
}
