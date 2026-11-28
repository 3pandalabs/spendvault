// "Safe to spend" for the rest of this month (Overview). Pure.
//
//   safe = base − spent so far − upcoming recurring charges still expected this month
//
// base, first that applies:
//   1. the user's overall monthly budget (Settings / Budgets page)        → "budget"
//   2. the sum of their category budgets                                  → "category_budgets"
//   3. average monthly income over the last 3 complete months, when at
//      least 2 of them show income                                         → "income"
// No base → null (the card asks the user to set a budget).
// spent = this month's spend, same rules as the dashboard total.
// upcoming = every ACTIVE recurring spend charge (subscriptions AND bills like
// rent) whose next expected date falls in this month and that hasn't shown up
// yet. A charge that was expected earlier this month but isn't in the data
// still counts: statements arrive late, so it was probably just not seen yet.

import { expectedChargesBetween, type Recurring } from "./recurring.js";
import { totalSpend } from "./budgets.js";
import { addMonths, daysBetween, incomeTxns, monthEnd, monthOf, monthStart, round2, usable, type Txn } from "./util.js";

export type SafeToSpendBasis = "budget" | "category_budgets" | "income";

export type SafeToSpend = {
  month: string;
  basis: SafeToSpendBasis;
  base: number;
  spent: number;
  upcoming: number;
  upcomingItems: Array<{ merchant: string; amount: number; expectedOn: string }>;
  amount: number; // may be negative (already over)
  daysLeft: number; // including today
  perDay: number; // max(0, amount) / daysLeft
};

/** Average monthly income over the last 3 complete months with data, or null when < 2 of them had income. */
export function trailingIncome(txns: readonly Txn[], currency: string, today: string): number | null {
  const rows = usable(txns, currency);
  const cur = monthOf(today);
  const months = [...new Set(rows.map((t) => monthOf(t.postedOn)))].filter((m) => m < cur && m >= addMonths(cur, -3)).sort();
  if (months.length < 2) return null;
  const byMonth = new Map<string, number>();
  for (const t of incomeTxns(rows)) {
    const m = monthOf(t.postedOn);
    if (months.includes(m)) byMonth.set(m, (byMonth.get(m) ?? 0) + t.amount);
  }
  if (byMonth.size < 2) return null;
  return round2([...byMonth.values()].reduce((s, v) => s + v, 0) / months.length);
}

export function computeSafeToSpend(opts: {
  txns: readonly Txn[];
  currency: string;
  today: string;
  recurring: readonly Recurring[];
  monthlyBudget?: number | null;
  categoryBudgetTotal?: number;
}): SafeToSpend | null {
  const { currency, today } = opts;
  const month = monthOf(today);
  let basis: SafeToSpendBasis;
  let base: number;
  if (opts.monthlyBudget && opts.monthlyBudget > 0) {
    basis = "budget";
    base = opts.monthlyBudget;
  } else if (opts.categoryBudgetTotal && opts.categoryBudgetTotal > 0) {
    basis = "category_budgets";
    base = opts.categoryBudgetTotal;
  } else {
    const income = trailingIncome(opts.txns, currency, today);
    if (income === null || income <= 0) return null;
    basis = "income";
    base = income;
  }
  const spent = totalSpend(opts.txns, currency, month);
  const upcomingItems = opts.recurring
    .filter((r) => r.active)
    .flatMap((r) => expectedChargesBetween(r, monthStart(month), monthEnd(month)).map((d) => ({ merchant: r.merchant, amount: round2(r.latestAmount), expectedOn: d })))
    .sort((a, b) => a.expectedOn.localeCompare(b.expectedOn) || b.amount - a.amount);
  const upcoming = round2(upcomingItems.reduce((s, x) => s + x.amount, 0));
  const amount = round2(base - spent - upcoming);
  const daysLeft = daysBetween(today, monthEnd(month)) + 1;
  return { month, basis, base: round2(base), spent, upcoming, upcomingItems, amount, daysLeft, perDay: round2(Math.max(0, amount) / daysLeft) };
}
