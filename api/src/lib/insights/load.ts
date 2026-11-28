// DB side of the insights engine: loads rows for the pure analytics modules.
// (Imports db; the pure modules in this folder never import this file.)
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { NetWorthAccountInput, NetWorthItemInput } from "./networth.js";
import { db } from "../../db/index.js";
import { accounts, alerts, budgets, documents, netWorthItems, transactions } from "../../db/schema.js";
import { institutionName } from "../institutions.js";
import { num, toNum } from "../money.js";
import type { Txn } from "./util.js";

/** Non-superseded transactions of one currency, optionally bounded by date. */
export async function loadTxns(userId: string, currency: string, from?: string, to?: string): Promise<Txn[]> {
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      postedOn: transactions.postedOn,
      merchant: transactions.merchant,
      category: transactions.category,
      amount: transactions.amount,
      direction: transactions.direction,
      currency: transactions.currency,
      descriptionRaw: transactions.descriptionRaw,
      sourceKind: transactions.sourceKind,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.supersededBy),
        eq(transactions.currency, currency),
        from ? gte(transactions.postedOn, from) : undefined,
        to ? lte(transactions.postedOn, to) : undefined,
      ),
    )
    .orderBy(asc(transactions.postedOn), asc(transactions.id));
  return rows.map((r) => ({ ...r, amount: num(r.amount), direction: r.direction === "credit" ? "credit" : "debit" }));
}

/** Months with any non-superseded transaction in the currency, newest first. */
export async function loadAvailableMonths(userId: string, currency: string): Promise<string[]> {
  const rows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(posted_on, 'YYYY-MM') AS m FROM transactions
    WHERE user_id = ${userId} AND superseded_by IS NULL AND currency = ${currency}
    ORDER BY m DESC`);
  return rows.rows.map((r) => r.m);
}

type AccountRow = typeof accounts.$inferSelect;

export function accountLabel(a: Pick<AccountRow, "label" | "institution" | "kind" | "last4">): string {
  if (a.label) return a.label;
  const inst = institutionName(a.institution) ?? (a.institution === "unknown" ? "Account" : a.institution);
  const kind = a.kind === "credit_card" ? " card" : a.kind === "bank" ? " account" : "";
  return `${inst}${kind}${a.last4 ? ` ••${a.last4}` : ""}`;
}

export async function loadAccountLabels(userId: string): Promise<Array<{ id: string; label: string }>> {
  const rows = await db.select().from(accounts).where(eq(accounts.userId, userId));
  return rows.map((a) => ({ id: a.id, label: accountLabel(a) }));
}

type AlertRow = typeof alerts.$inferSelect;

/** The `Alert` shape from ROUTES.md. */
export function alertView(a: AlertRow) {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    body: a.body,
    category: a.category,
    merchant: a.merchant,
    amount: toNum(a.amount),
    baseline: toNum(a.baseline),
    periodStart: a.periodStart,
    createdAt: a.createdAt.toISOString(),
    dismissedAt: a.dismissedAt ? a.dismissedAt.toISOString() : null,
  };
}

/** Category budgets (base currency). */
export async function loadBudgets(userId: string): Promise<Array<{ category: string; amount: number }>> {
  const rows = await db.select({ category: budgets.category, amount: budgets.amount }).from(budgets).where(eq(budgets.userId, userId));
  return rows.map((r) => ({ category: r.category, amount: num(r.amount) }));
}

/**
 * Accounts with the closing balance of their latest parsed statement (by
 * period end, then processing time), plus the manual net-worth items.
 */
export async function loadNetWorthInputs(userId: string): Promise<{ accounts: NetWorthAccountInput[]; items: NetWorthItemInput[] }> {
  const [acctRows, latest, itemRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)),
    db.execute<{ account_id: string; closing_balance: string; as_of: string }>(sql`
      SELECT DISTINCT ON (account_id) account_id, closing_balance::text,
             coalesce(period_end, processed_at::date, created_at::date)::text AS as_of
      FROM ${documents}
      WHERE user_id = ${userId} AND account_id IS NOT NULL AND kind = 'statement' AND status = 'parsed'
        AND closing_balance IS NOT NULL
      ORDER BY account_id, period_end DESC NULLS LAST, processed_at DESC NULLS LAST`),
    db.select().from(netWorthItems).where(eq(netWorthItems.userId, userId)).orderBy(asc(netWorthItems.createdAt)),
  ]);
  const bal = new Map(latest.rows.map((r) => [r.account_id, r]));
  return {
    accounts: acctRows.map((a) => ({
      accountId: a.id,
      label: accountLabel(a),
      kind: a.kind,
      currency: a.currency,
      includeInNetWorth: a.includeInNetWorth,
      balance: bal.has(a.id) ? num(bal.get(a.id)!.closing_balance) : null,
      asOf: bal.get(a.id)?.as_of ?? null,
    })),
    items: itemRows.map(netWorthItemView),
  };
}

export function netWorthItemView(i: typeof netWorthItems.$inferSelect): NetWorthItemInput {
  return { id: i.id, kind: i.kind, type: i.type, name: i.name, amount: num(i.amount), updatedAt: i.updatedAt.toISOString() };
}
