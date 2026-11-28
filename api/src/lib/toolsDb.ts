// DB side of the 0003 features: card dues, savings goals, receipt reminder
// inputs, refund watches, user splits. Imports db; the pure modules
// (insights/cards, goals, refunds, receipts/returns, prices) never import this.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, goalContributions, receiptItems, receipts, refundWatches, savingsGoals, transactionSplits, transactions, users } from "../db/schema.js";
import { cardDues, type CardDue, type CardStatementInput } from "./insights/cards.js";
import { goalProgress } from "./insights/goals.js";
import { accountLabel, loadTxns } from "./insights/load.js";
import { resolveRefunds, refundStatus, type RefundWatchInput } from "./insights/refunds.js";
import { addDays } from "./insights/util.js";
import { num, toNum } from "./money.js";
import type { ReturnAlertReceipt } from "./receipts/returns.js";

// ---------------------------------------------------------------- cards

/** Each credit card's latest parsed statement (by period end, then processing time). */
export async function loadCardStatements(userId: string): Promise<CardStatementInput[]> {
  const rows = await db.execute<{
    account_id: string;
    document_id: string;
    period_end: string | null;
    closing_balance: string | null;
    statement_total: string | null;
    minimum_due: string | null;
    due_date: string | null;
    credit_limit: string | null;
  }>(sql`
    SELECT DISTINCT ON (d.account_id) d.account_id, d.id AS document_id, d.period_end::text, d.closing_balance::text,
           d.statement_total::text, d.minimum_due::text, d.due_date::text, d.credit_limit::text
    FROM documents d JOIN accounts a ON a.id = d.account_id
    WHERE d.user_id = ${userId} AND a.user_id = ${userId} AND a.kind = 'credit_card'
      AND d.kind = 'statement' AND d.status = 'parsed'
    ORDER BY d.account_id, d.period_end DESC NULLS LAST, d.processed_at DESC NULLS LAST`);
  if (!rows.rows.length) return [];
  const accts = await db.select().from(accounts).where(and(eq(accounts.userId, userId), inArray(accounts.id, rows.rows.map((r) => r.account_id))));
  const byId = new Map(accts.map((a) => [a.id, a]));
  // An older statement may carry the credit limit when the latest one didn't print it.
  const limits = await db.execute<{ account_id: string; credit_limit: string }>(sql`
    SELECT DISTINCT ON (account_id) account_id, credit_limit::text FROM documents
    WHERE user_id = ${userId} AND credit_limit IS NOT NULL AND status = 'parsed'
    ORDER BY account_id, period_end DESC NULLS LAST`);
  const limitOf = new Map(limits.rows.map((r) => [r.account_id, r.credit_limit]));
  return rows.rows.flatMap((r) => {
    const a = byId.get(r.account_id);
    if (!a) return [];
    return [
      {
        accountId: a.id,
        label: accountLabel(a),
        currency: a.currency,
        documentId: r.document_id,
        periodEnd: r.period_end,
        statementBalance: toNum(r.closing_balance ?? r.statement_total),
        minimumDue: toNum(r.minimum_due),
        dueDate: r.due_date,
        creditLimit: toNum(r.credit_limit ?? limitOf.get(a.id) ?? null),
      },
    ];
  });
}

export async function loadCardDues(userId: string, today: string): Promise<CardDue[]> {
  const cards = await loadCardStatements(userId);
  if (!cards.length) return [];
  const since = cards.map((c) => c.periodEnd ?? addDays(today, -60)).sort()[0];
  const currencies = [...new Set(cards.map((c) => c.currency))];
  const txns = (await Promise.all(currencies.map((cur) => loadTxns(userId, cur, since)))).flat();
  return cardDues(cards, txns, today);
}

// ---------------------------------------------------------------- goals

export async function loadGoals(userId: string, today: string) {
  const [goals, contribs] = await Promise.all([
    db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(asc(savingsGoals.createdAt)),
    db.select().from(goalContributions).where(eq(goalContributions.userId, userId)).orderBy(desc(goalContributions.contributedOn), desc(goalContributions.createdAt)),
  ]);
  return goals.map((g) => {
    const mine = contribs.filter((c) => c.goalId === g.id);
    const list = mine.map((c) => ({ amount: num(c.amount), contributedOn: c.contributedOn }));
    return {
      id: g.id,
      name: g.name,
      targetAmount: num(g.targetAmount),
      targetDate: g.targetDate,
      currency: g.currency,
      createdAt: g.createdAt.toISOString(),
      progress: goalProgress({ targetAmount: num(g.targetAmount), targetDate: g.targetDate, contributions: list }, today),
      contributions: mine.slice(0, 50).map((c) => ({ id: c.id, amount: num(c.amount), contributedOn: c.contributedOn, note: c.note, createdAt: c.createdAt.toISOString() })),
    };
  });
}

// ---------------------------------------------------------------- receipts (reminders)

export async function loadReturnAlertReceipts(userId: string, since: string): Promise<ReturnAlertReceipt[]> {
  const rows = await db
    .select({ r: receipts })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), sql`(${receipts.purchasedOn} >= ${since}::date OR ${receipts.warrantyUntil} >= ${since}::date)`))
    .limit(1000);
  if (!rows.length) return [];
  const ids = rows.map((x) => x.r.id);
  const [items, returned] = await Promise.all([
    db.select({ receiptId: receiptItems.receiptId, category: receiptItems.category }).from(receiptItems).where(and(eq(receiptItems.userId, userId), inArray(receiptItems.receiptId, ids))),
    db.select({ receiptId: refundWatches.receiptId, transactionId: refundWatches.transactionId }).from(refundWatches).where(eq(refundWatches.userId, userId)),
  ]);
  const cats = new Map<string, string[]>();
  for (const i of items) cats.set(i.receiptId, [...(cats.get(i.receiptId) ?? []), i.category]);
  const returnedReceipts = new Set(returned.map((w) => w.receiptId).filter(Boolean));
  const returnedTxns = new Set(returned.map((w) => w.transactionId).filter(Boolean));
  return rows.map(({ r }) => ({
    id: r.id,
    merchant: r.merchant,
    purchasedOn: r.purchasedOn,
    returnDays: r.returnDays,
    total: toNum(r.total),
    currency: r.currency,
    warrantyUntil: r.warrantyUntil,
    returned: returnedReceipts.has(r.id) || (r.transactionId !== null && returnedTxns.has(r.transactionId)),
    itemCategories: cats.get(r.id) ?? [],
  }));
}

// ---------------------------------------------------------------- refunds

type WatchRow = typeof refundWatches.$inferSelect;

export const watchInput = (w: WatchRow): RefundWatchInput => ({
  id: w.id,
  merchant: w.merchant,
  amount: num(w.amount),
  currency: w.currency,
  returnedOn: w.returnedOn,
  refundTransactionId: w.refundTransactionId,
  transactionId: w.transactionId,
});

/** Link open watches to matching credits (persisted). Returns all of the user's watches, fresh. */
export async function syncRefundWatches(userId: string): Promise<WatchRow[]> {
  const all = await db.select().from(refundWatches).where(eq(refundWatches.userId, userId)).orderBy(desc(refundWatches.createdAt));
  const open = all.filter((w) => !w.refundTransactionId && !w.resolvedAt);
  if (!open.length) return all;
  const since = addDays(open.map((w) => w.returnedOn).sort()[0], -2);
  const currencies = [...new Set(open.map((w) => w.currency))];
  const txns = (await Promise.all(currencies.map((c) => loadTxns(userId, c, since)))).flat();
  const hits = resolveRefunds(all.map(watchInput), txns);
  for (const [watchId, t] of hits) {
    await db
      .update(refundWatches)
      .set({ refundTransactionId: t.id, resolvedAt: new Date() })
      .where(and(eq(refundWatches.id, watchId), eq(refundWatches.userId, userId), isNull(refundWatches.refundTransactionId)));
  }
  return hits.size ? db.select().from(refundWatches).where(eq(refundWatches.userId, userId)).orderBy(desc(refundWatches.createdAt)) : all;
}

export function refundWatchView(w: WatchRow, today: string, refund?: { postedOn: string; amount: number } | null) {
  return {
    id: w.id,
    transactionId: w.transactionId,
    receiptId: w.receiptId,
    merchant: w.merchant,
    amount: num(w.amount),
    currency: w.currency,
    returnedOn: w.returnedOn,
    status: w.resolvedAt && !w.refundTransactionId ? ("closed" as const) : refundStatus(w, today),
    refundTransactionId: w.refundTransactionId,
    refundedOn: refund?.postedOn ?? null,
    refundAmount: refund?.amount ?? null,
    createdAt: w.createdAt.toISOString(),
  };
}

export async function refundWatchViews(userId: string, rows: WatchRow[], today: string) {
  const ids = rows.map((w) => w.refundTransactionId).filter((x): x is string => Boolean(x));
  const credits = ids.length
    ? await db.select({ id: transactions.id, postedOn: transactions.postedOn, amount: transactions.amount }).from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)))
    : [];
  const byId = new Map(credits.map((c) => [c.id, { postedOn: c.postedOn, amount: num(c.amount) }]));
  return rows.map((w) => refundWatchView(w, today, w.refundTransactionId ? byId.get(w.refundTransactionId) : null));
}

// ---------------------------------------------------------------- splits

export async function loadUserSplits(userIds: readonly string[], txnIds?: readonly string[]): Promise<Map<string, Array<{ category: string; amount: number }>>> {
  if (!userIds.length) return new Map();
  const rows = await db
    .select({ transactionId: transactionSplits.transactionId, category: transactionSplits.category, amount: transactionSplits.amount })
    .from(transactionSplits)
    .where(and(inArray(transactionSplits.userId, [...userIds]), txnIds ? inArray(transactionSplits.transactionId, [...txnIds]) : undefined))
    .orderBy(asc(transactionSplits.transactionId), asc(transactionSplits.position));
  const out = new Map<string, Array<{ category: string; amount: number }>>();
  for (const r of rows) out.set(r.transactionId, [...(out.get(r.transactionId) ?? []), { category: r.category, amount: num(r.amount) }]);
  return out;
}

/** The user row bits most routes need ("today" in their zone). */
export async function userBasicsRow(userId: string) {
  const [u] = await db
    .select({ baseCurrency: users.baseCurrency, monthlyBudget: users.monthlyBudget, timezone: users.timezone })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return u ?? null;
}
