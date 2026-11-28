// Calculator pre-fill from the user's own data (GET /calculators/prefill). Pure.
//
// Averages use the last 3 COMPLETE months that have any transactions (same
// window as budget suggestions), with the dashboard's spend rules: spend
// debits, refunds netted, each category floored at 0. Manual cash spends count.

import { categorySpend } from "./budgets.js";
import { incomeTxns, isEssential, monthOf, round2, usable, type Txn } from "./util.js";

export type SpendAverages = {
  months: string[]; // the months averaged, oldest first
  avgMonthlySpend: number;
  avgMonthlyEssentialSpend: number;
  avgMonthlyIncome: number;
};

export function spendAverages(all: readonly Txn[], currency: string, today: string, window = 3): SpendAverages {
  const txns = usable(all, currency);
  const months = [...new Set(txns.map((t) => monthOf(t.postedOn)))].filter((m) => m < monthOf(today)).sort().slice(-window);
  if (months.length === 0) return { months, avgMonthlySpend: 0, avgMonthlyEssentialSpend: 0, avgMonthlyIncome: 0 };
  let spend = 0;
  let essential = 0;
  for (const m of months) {
    for (const [cat, v] of categorySpend(txns, currency, m)) {
      spend += v;
      if (isEssential(cat)) essential += v;
    }
  }
  const inMonths = new Set(months);
  const income = incomeTxns(txns)
    .filter((t) => inMonths.has(monthOf(t.postedOn)))
    .reduce((s, t) => s + t.amount, 0);
  const n = months.length;
  return { months, avgMonthlySpend: round2(spend / n), avgMonthlyEssentialSpend: round2(essential / n), avgMonthlyIncome: round2(income / n) };
}
