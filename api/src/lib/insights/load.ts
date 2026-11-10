// DB side of the insights engine: loads rows for the pure analytics modules.
// (Imports db; the pure modules in this folder never import this file.)
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, alerts, transactions } from "../../db/schema.js";
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
