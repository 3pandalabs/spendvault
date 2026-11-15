// DB side of receipts: persisting extractions, matching to transactions,
// re-matching after new statements, and loading item splits for the
// dashboard. (Imports db; the pure modules in this folder never import this.)
// Logs ids and counts only: never amounts, merchants or item names.
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/index.js";
import { documents, receiptItems, receipts, transactions, type ReceiptMatchStatus } from "../../db/schema.js";
import { categorize, type Category } from "../categories.js";
import { errKind, ingestLog } from "../ingest/log.js";
import { num, toDbAmount, toNum } from "../money.js";
import { amountTolerance, looseScore, matchWindow, pickMatch, type MatchCandidate, type MatchReceipt } from "./match.js";
import { allocateItems, type SplitPart } from "./split.js";
import type { ReceiptExtraction } from "./llm.js";

export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptItemRow = typeof receiptItems.$inferSelect;
type DocRow = typeof documents.$inferSelect;

/** Create the receipt row for a receipt document (idempotent). */
export async function ensureReceipt(tx: DbOrTx, doc: Pick<DocRow, "id" | "userId">, currency: string): Promise<ReceiptRow> {
  await tx.insert(receipts).values({ userId: doc.userId, documentId: doc.id, currency }).onConflictDoNothing({ target: receipts.documentId });
  const [r] = await tx.select().from(receipts).where(eq(receipts.documentId, doc.id)).limit(1);
  return r;
}

/** Merchant-level category, used for items the extractor didn't categorize. */
export function merchantCategory(merchant: string | null): Category {
  return merchant ? categorize(merchant, "debit").category : "other";
}

/** Replace a receipt's extracted fields + items. */
export async function saveExtraction(tx: DbOrTx, r: ReceiptRow, ex: ReceiptExtraction): Promise<void> {
  const fallback = merchantCategory(ex.merchant);
  await tx
    .update(receipts)
    .set({
      status: ex.total === null ? "failed" : "extracted",
      error: ex.total === null ? "Couldn't read the total. Enter it by hand." : null,
      merchant: ex.merchant?.slice(0, 120) ?? null,
      purchasedOn: ex.date,
      total: ex.total === null ? null : toDbAmount(ex.total),
      tax: ex.tax === null ? null : toDbAmount(ex.tax),
      currency: ex.currency,
      itemsReconciled: ex.itemsReconciled,
      parser: "llm:receipt",
      updatedAt: new Date(),
    })
    .where(eq(receipts.id, r.id));
  await tx.delete(receiptItems).where(eq(receiptItems.receiptId, r.id));
  if (ex.items.length) {
    await tx.insert(receiptItems).values(
      ex.items.map((it, i) => ({
        receiptId: r.id,
        userId: r.userId,
        position: i,
        name: it.name.slice(0, 200),
        quantity: it.quantity === null ? null : String(Math.round(it.quantity * 1000) / 1000),
        unitPrice: it.unitPrice === null ? null : toDbAmount(it.unitPrice),
        lineTotal: toDbAmount(it.lineTotal),
        category: it.category ?? fallback,
      })),
    );
  }
}

// ---------------------------------------------------------------- matching

function toMatchReceipt(r: ReceiptRow, receivedOn: string): MatchReceipt | null {
  const total = toNum(r.total);
  if (total === null || total <= 0) return null;
  return { total, purchasedOn: r.purchasedOn, receivedOn, merchant: r.merchant, currency: r.currency, rejected: r.rejectedTxnIds };
}

/** Debit, non-superseded, not-yet-linked transactions in the window and amount band. */
async function loadCandidates(userId: string, receiptId: string, mr: MatchReceipt, widen = false): Promise<MatchCandidate[]> {
  const w = matchWindow(mr);
  const pad = widen ? 4 : 0;
  const tol = widen ? Math.max(amountTolerance(mr.total), mr.total * 0.1) : amountTolerance(mr.total);
  const rows = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amount: transactions.amount,
      merchant: transactions.merchant,
      descriptionRaw: transactions.descriptionRaw,
      currency: transactions.currency,
      direction: transactions.direction,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.supersededBy),
        eq(transactions.direction, "debit"),
        gte(transactions.postedOn, sql`${w.from}::date - ${pad}::int`),
        lte(transactions.postedOn, sql`${w.to}::date + ${pad}::int`),
        gte(transactions.amount, toDbAmount(Math.max(0, mr.total - tol))),
        lte(transactions.amount, toDbAmount(mr.total + tol)),
        sql`NOT EXISTS (SELECT 1 FROM receipts x WHERE x.transaction_id = ${transactions.id} AND x.id <> ${receiptId}::uuid)`,
      ),
    )
    .orderBy(asc(transactions.postedOn))
    .limit(50);
  return rows.map((r) => ({ ...r, amount: num(r.amount) }));
}

/** Try to auto-link one receipt. Never overrides a link the user confirmed. Returns true when linked. */
export async function matchReceipt(userId: string, receiptId: string): Promise<boolean> {
  const [row] = await db
    .select({ r: receipts, createdAt: documents.createdAt })
    .from(receipts)
    .innerJoin(documents, eq(documents.id, receipts.documentId))
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
    .limit(1);
  if (!row || row.r.transactionId) return false;
  const mr = toMatchReceipt(row.r, row.createdAt.toISOString().slice(0, 10));
  if (!mr) return false;
  const best = pickMatch(mr, await loadCandidates(userId, receiptId, mr));
  if (!best) return false;
  try {
    const done = await db
      .update(receipts)
      .set({ transactionId: best.id, matchStatus: "auto", matchedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId), isNull(receipts.transactionId)))
      .returning({ id: receipts.id });
    return done.length > 0;
  } catch (err) {
    // Unique index: another receipt grabbed that transaction first.
    if ((err as { code?: string }).code === "23505") return false;
    throw err;
  }
}

/**
 * After new statements/alerts land: follow alert→statement supersession,
 * clear links whose transaction was deleted, then try every unlinked receipt.
 */
export async function rematchReceiptsForUser(userId: string): Promise<number> {
  // Move links off alert rows a statement line has since superseded (unless the
  // statement row is already linked elsewhere).
  await db.execute(sql`
    UPDATE receipts r SET transaction_id = t.superseded_by, updated_at = now()
    FROM transactions t
    WHERE r.user_id = ${userId} AND r.transaction_id = t.id AND t.superseded_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM receipts x WHERE x.transaction_id = t.superseded_by)`);
  await db
    .update(receipts)
    .set({ matchStatus: "unmatched", matchedAt: null, updatedAt: new Date() })
    .where(and(eq(receipts.userId, userId), isNull(receipts.transactionId), ne(receipts.matchStatus, "unmatched")));
  const open = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), isNull(receipts.transactionId), isNotNull(receipts.total)))
    .orderBy(asc(receipts.createdAt))
    .limit(200);
  let matched = 0;
  for (const r of open) {
    try {
      if (await matchReceipt(userId, r.id)) matched++;
    } catch (err) {
      ingestLog.warn({ receiptId: r.id, err: errKind(err) }, "receipt match failed");
    }
  }
  if (open.length) ingestLog.info({ userId, receipts: open.length, matched }, "receipts rematched");
  return matched;
}

/** Ranked transactions the user could link this receipt to (wider than auto-match). */
export async function candidatesFor(userId: string, r: ReceiptRow, receivedOn: string) {
  const mr = toMatchReceipt(r, receivedOn);
  if (!mr) return [];
  const cands = await loadCandidates(userId, r.id, mr, true);
  return cands
    .map((c) => ({ id: c.id, score: looseScore(mr, c) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 10);
}

// ---------------------------------------------------------------- dashboard splits

/** Item splits for matched transactions in [from, to] whose receipts add up. */
export async function loadReceiptSplits(userId: string, from: string, to: string): Promise<Map<string, SplitPart[]>> {
  const rows = await db
    .select({
      txnId: transactions.id,
      txnAmount: transactions.amount,
      txnCategory: transactions.category,
      category: receiptItems.category,
      lineTotal: receiptItems.lineTotal,
    })
    .from(receipts)
    .innerJoin(transactions, eq(transactions.id, receipts.transactionId))
    .innerJoin(receiptItems, eq(receiptItems.receiptId, receipts.id))
    .where(
      and(
        eq(receipts.userId, userId),
        eq(transactions.userId, userId),
        inArray(receipts.matchStatus, ["auto", "confirmed"] satisfies ReceiptMatchStatus[]),
        eq(receipts.itemsReconciled, true),
        eq(transactions.categoryLocked, false),
        isNull(transactions.supersededBy),
        gte(transactions.postedOn, from),
        lte(transactions.postedOn, to),
      ),
    );
  const grouped = new Map<string, { amount: number; category: string; items: Array<{ category: string; lineTotal: number }> }>();
  for (const r of rows) {
    const g = grouped.get(r.txnId) ?? { amount: num(r.txnAmount), category: r.txnCategory, items: [] };
    g.items.push({ category: r.category, lineTotal: num(r.lineTotal) });
    grouped.set(r.txnId, g);
  }
  const out = new Map<string, SplitPart[]>();
  for (const [id, g] of grouped) {
    const parts = allocateItems(g.amount, g.category, g.items);
    if (parts) out.set(id, parts);
  }
  return out;
}

// ---------------------------------------------------------------- views

type ReceiptDocFields = Pick<DocRow, "source" | "filename" | "mimeType" | "contentEnc">;

/** The `Receipt` shape from ROUTES.md. */
export function receiptView(r: ReceiptRow, d: Pick<ReceiptDocFields, "source" | "filename" | "mimeType"> & { hasOriginal: boolean }, itemCount: number) {
  return {
    id: r.id,
    documentId: r.documentId,
    status: r.status,
    merchant: r.merchant,
    purchasedOn: r.purchasedOn,
    total: toNum(r.total),
    tax: toNum(r.tax),
    currency: r.currency,
    itemCount,
    itemsReconciled: r.itemsReconciled,
    parser: r.parser,
    error: r.error,
    source: d.source,
    filename: d.filename,
    mimeType: d.mimeType,
    hasImage: d.hasOriginal,
    transactionId: r.transactionId,
    matchStatus: (r.transactionId ? r.matchStatus : "unmatched") as ReceiptMatchStatus,
    matchedAt: r.transactionId && r.matchedAt ? r.matchedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The `ReceiptItem` shape from ROUTES.md. */
export function receiptItemView(i: ReceiptItemRow) {
  return {
    id: i.id,
    name: i.name,
    quantity: i.quantity === null ? null : Number(i.quantity),
    unitPrice: toNum(i.unitPrice),
    lineTotal: num(i.lineTotal),
    category: i.category,
    categoryLocked: i.categoryLocked,
  };
}

/** Rows for receiptView: doc fields without decrypting/loading the blob. */
export const receiptDocColumns = {
  source: documents.source,
  filename: documents.filename,
  mimeType: documents.mimeType,
  hasOriginal: sql<boolean>`${documents.contentEnc} IS NOT NULL`,
  createdAt: documents.createdAt,
};

export const receiptItemCount = sql<number>`(SELECT count(*)::int FROM receipt_items i WHERE i.receipt_id = ${receipts.id})`;
