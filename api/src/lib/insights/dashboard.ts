// Dashboard aggregation (GET /dashboard, minus recentAlerts). Pure.
//
// Currency: only `currency` (the user's base currency) rows are summed; other
// currencies are ignored in v1. Refunds attributable to a merchant net against
// that merchant's category (util.spendEntries); every bucket is floored at 0.

import { mostCommon } from "./recurring.js";
import {
  addMonths,
  categoryLabel,
  daysInMonth,
  incomeTxns,
  monthOf,
  round2,
  spendEntries,
  sumBy,
  usable,
  type Txn,
} from "./util.js";

export type AccountInfo = { id: string; label: string };

export type DashboardData = {
  month: string;
  currency: string;
  availableMonths: string[];
  totals: { spend: number; previousMonthSpend: number; avg3MonthSpend: number; income: number; txnCount: number };
  byCategory: Array<{ category: string; label: string; amount: number; previous: number; avg3: number; share: number }>;
  byAccount: Array<{ accountId: string | null; label: string; amount: number }>;
  topMerchants: Array<{ merchant: string; category: string; amount: number; count: number }>;
  daily: Array<{ date: string; amount: number }>;
  trend: Array<{ month: string; spend: number }>;
};

const pos = (n: number | undefined) => round2(Math.max(0, n ?? 0));

/**
 * `availableMonths` (newest first) should cover all time; pass it in when
 * `txns` is only a window. `txns` must include the selected month and the
 * 11 months before it (trend) — 3 are enough for avg3.
 * avg3 = mean over those of the 3 previous calendar months that have data
 * (any transaction in the currency); 0 if none do.
 */
export function computeDashboard(opts: {
  txns: readonly Txn[];
  currency: string;
  month?: string;
  today: string;
  availableMonths?: string[];
  accounts?: readonly AccountInfo[];
}): DashboardData {
  const txns = usable(opts.txns, opts.currency);
  const availableMonths = opts.availableMonths ?? [...new Set(txns.map((t) => monthOf(t.postedOn)))].sort().reverse();
  const month = opts.month ?? availableMonths[0] ?? monthOf(opts.today);
  const entries = spendEntries(txns);
  const dataMonths = new Set(availableMonths);

  const prevMonth = addMonths(month, -1);
  const avgMonths = [1, 2, 3].map((n) => addMonths(month, -n)).filter((m) => dataMonths.has(m));

  const inMonth = entries.filter((e) => monthOf(e.date) === month);
  const catMonth = sumBy(entries, (e) => `${e.category}|${monthOf(e.date)}`);
  const catNow = sumBy(inMonth, (e) => e.category);
  const spend = [...catNow.values()].reduce((s, v) => s + Math.max(0, v), 0);

  const avgOf = (get: (m: string) => number) =>
    avgMonths.length ? round2(avgMonths.reduce((s, m) => s + get(m), 0) / avgMonths.length) : 0;

  const byCategory = [...catNow.entries()]
    .map(([category, amt]) => ({
      category,
      label: categoryLabel(category),
      amount: pos(amt),
      previous: pos(catMonth.get(`${category}|${prevMonth}`)),
      avg3: avgOf((m) => Math.max(0, catMonth.get(`${category}|${m}`) ?? 0)),
      share: spend > 0 ? Math.round((Math.max(0, amt) / spend) * 10_000) / 10_000 : 0,
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));

  const labels = new Map((opts.accounts ?? []).map((a) => [a.id, a.label]));
  const byAccount = [...sumBy(inMonth, (e) => e.accountId).entries()]
    .map(([accountId, amt]) => ({
      accountId,
      label: (accountId && labels.get(accountId)) || (accountId ? "Account" : "Unassigned"),
      amount: pos(amt),
    }))
    .filter((a) => a.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const merchants = new Map<string, { merchant: string; cats: string[]; amount: number; count: number }>();
  for (const e of inMonth) {
    const k = e.merchant.toLowerCase();
    const m = merchants.get(k) ?? { merchant: e.merchant, cats: [], amount: 0, count: 0 };
    m.amount += e.amount;
    if (e.amount > 0) {
      m.count += 1;
      m.cats.push(e.category);
    }
    merchants.set(k, m);
  }
  const topMerchants = [...merchants.values()]
    .filter((m) => m.amount > 0 && m.count > 0)
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
    .slice(0, 10)
    .map((m) => ({ merchant: m.merchant, category: mostCommon(m.cats), amount: round2(m.amount), count: m.count }));

  const byDay = sumBy(inMonth, (e) => e.date);
  const daily = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, amount: pos(byDay.get(date)) };
  });

  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(month, i - 11);
    return { month: m, spend: monthSpend(catMonth, m) };
  });

  const income = incomeTxns(txns)
    .filter((t) => monthOf(t.postedOn) === month)
    .reduce((s, t) => s + t.amount, 0);

  return {
    month,
    currency: opts.currency,
    availableMonths,
    totals: {
      spend: round2(spend),
      previousMonthSpend: monthSpend(catMonth, prevMonth),
      avg3MonthSpend: avgOf((m) => monthSpend(catMonth, m)),
      income: round2(income),
      txnCount: txns.filter((t) => monthOf(t.postedOn) === month).length,
    },
    byCategory,
    byAccount,
    topMerchants,
    daily,
    trend,
  };
}

/** A month's spend = sum of its categories, each floored at 0 (a refund can't make a category negative). */
function monthSpend(catMonth: Map<string, number>, month: string): number {
  let s = 0;
  for (const [k, v] of catMonth) if (k.endsWith(`|${month}`)) s += Math.max(0, v);
  return round2(s);
}
