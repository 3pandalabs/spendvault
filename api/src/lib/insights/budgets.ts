// Budgets: per-category monthly progress, suggested starting budgets and
// over-budget alerts. Pure.
//
// "Spent" uses the dashboard's rules (util.spendEntries: spend debits, refunds
// net against the merchant's category, each category floored at 0), so a
// budget bar and the Overview category total always agree.

import type { AlertCandidate } from "./spikes.js";
import { addMonths, categoryLabel, formatMoney, monthLabel, monthOf, monthStart, round2, spendEntries, threshold, usable, type Txn } from "./util.js";

/** Rollover settings (0005). `since` = first month (YYYY-MM) whose leftover carries; null = off. */
export type Rollover = { unspent: boolean; overspend: boolean; since: string | null };
export const NO_ROLLOVER: Rollover = { unspent: false, overspend: false, since: null };

export type BudgetInput = { category: string; amount: number; rollover?: Rollover };
export type BudgetStatus = "ok" | "near" | "over";

export type BudgetLine = {
  category: string;
  label: string;
  budget: number;
  spent: number;
  remaining: number; // may be negative
  progress: number; // spent / budget (0 when budget is 0)
  status: BudgetStatus;
  /** Carried in from earlier months (+ unspent, - overspent); 0 without rollover. */
  rolledOver: number;
  /** budget + rolledOver: what this month's bar measures against. */
  available: number;
  rollover: Rollover;
};

export type BudgetSuggestion = { category: string; label: string; suggested: number; average: number };

/** At or above this share of the budget a line is "near". */
export const NEAR_SHARE = 0.8;

/** Never suggest a budget for these (fees are to avoid, not budget for). */
const NO_SUGGEST = new Set(["fees_charges"]);

export const statusOf = (spent: number, budget: number): BudgetStatus =>
  spent > budget + 0.004 ? "over" : budget > 0 && spent >= budget * NEAR_SHARE ? "near" : "ok";

/** Spend per category in `month`, floored at 0 (same as the dashboard). */
export function categorySpend(txns: readonly Txn[], currency: string, month: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of spendEntries(usable(txns, currency))) {
    if (monthOf(e.date) !== month) continue;
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  }
  for (const [k, v] of m) m.set(k, round2(Math.max(0, v)));
  return m;
}

/** Longest look-back for a rollover chain (older months simply stop counting). */
export const MAX_ROLLOVER_MONTHS = 12;

/** The month rollover counting starts from for `month` (capped look-back), or null when off. */
export const rolloverFrom = (r: Rollover | undefined, month: string): string | null => {
  if (!r?.since || (!r.unspent && !r.overspend)) return null;
  const floor = addMonths(month, -MAX_ROLLOVER_MONTHS);
  return r.since < floor ? floor : r.since;
};

/**
 * Money carried INTO `month`. Starting at `since` (the month rollover was
 * switched on, carry 0), each month's leftover = budget + carry - real spend.
 * A positive leftover carries when `unspent` is on, a negative one when
 * `overspend` is on; otherwise the carry resets to 0. Months before `since`
 * never count. Uses today's budget amount for every month (no amount history).
 */
export function rolloverCarry(budget: number, month: string, r: Rollover | undefined, spentIn: (m: string) => number): number {
  const from = rolloverFrom(r, month);
  if (!r || !from || month <= from) return 0;
  let carry = 0;
  for (let m = from; m < month; m = addMonths(m, 1)) {
    const left = round2(budget + carry - spentIn(m));
    carry = left >= 0 ? (r.unspent ? left : 0) : r.overspend ? left : 0;
  }
  return round2(carry);
}

/**
 * Rollover toggles changed: switching on from fully off starts counting at
 * `currentMonth` (the user's month, lib/userTime.ts); staying on keeps the
 * original start; switching both off clears it.
 */
export function nextRollover(prev: Rollover, next: { unspent: boolean; overspend: boolean }, currentMonth: string): Rollover {
  if (!next.unspent && !next.overspend) return { ...NO_ROLLOVER };
  const wasOn = Boolean((prev.unspent || prev.overspend) && prev.since);
  return { unspent: next.unspent, overspend: next.overspend, since: wasOn ? prev.since : currentMonth };
}

function lineFor(category: string, amount: number, spent: number, rolledOver: number, rollover: Rollover): BudgetLine {
  const available = round2(amount + rolledOver);
  return {
    category,
    label: categoryLabel(category),
    budget: round2(amount),
    spent,
    remaining: round2(available - spent),
    progress: available > 0 ? round2(spent / available) : spent > 0 ? 1 : 0,
    status: available > 0 ? statusOf(spent, available) : spent > 0.004 ? "over" : "ok",
    rolledOver,
    available,
    rollover,
  };
}

export function budgetLines(txns: readonly Txn[], currency: string, month: string, budgets: readonly BudgetInput[]): BudgetLine[] {
  const spend = categorySpend(txns, currency, month);
  const byMonth = new Map<string, Map<string, number>>();
  const spentIn = (cat: string) => (m: string) => {
    let s = byMonth.get(m);
    if (!s) byMonth.set(m, (s = categorySpend(txns, currency, m)));
    return s.get(cat) ?? 0;
  };
  return budgets
    .map((b) => {
      const spent = spend.get(b.category) ?? 0;
      const rollover = b.rollover ?? NO_ROLLOVER;
      return lineFor(b.category, b.amount, spent, rolloverCarry(b.amount, month, rollover, spentIn(b.category)), rollover);
    })
    .sort((a, b) => b.progress - a.progress || b.spent - a.spent || a.category.localeCompare(b.category));
}

/** Total spend in `month` (sum of the floored category totals). */
export const totalSpend = (txns: readonly Txn[], currency: string, month: string) =>
  round2([...categorySpend(txns, currency, month).values()].reduce((s, v) => s + v, 0));

/** The overall monthly budget with its rollover (null when no overall budget is set). */
export function overallBudgetLine(txns: readonly Txn[], currency: string, month: string, monthlyBudget: number | null | undefined, rollover?: Rollover): BudgetLine | null {
  if (!monthlyBudget || monthlyBudget <= 0) return null;
  const r = rollover ?? NO_ROLLOVER;
  const carry = rolloverCarry(monthlyBudget, month, r, (m) => totalSpend(txns, currency, m));
  return { ...lineFor("total", monthlyBudget, totalSpend(txns, currency, month), carry, r), label: "Monthly budget" };
}

/** Round a suggestion UP to a friendly step: $5/$25/$100, ₹50/₹500/₹1,000. */
export function niceCeil(n: number, currency: string): number {
  if (n <= 0) return 0;
  const step = currency === "INR" ? (n < 1000 ? 50 : n < 10_000 ? 500 : 1000) : n < 100 ? 5 : n < 1000 ? 25 : 100;
  return Math.ceil(n / step - 1e-9) * step;
}

/**
 * Starting budgets: the average of each spend category over the last 3
 * complete months that have any data (a month without spend in a category
 * counts as 0), rounded up with niceCeil. Categories averaging under ₹200
 * ($5) are skipped, as are categories that already have a budget.
 */
export function suggestBudgets(opts: { txns: readonly Txn[]; currency: string; today: string; existing?: ReadonlySet<string> }): BudgetSuggestion[] {
  const { currency, today } = opts;
  const txns = usable(opts.txns, currency);
  const dataMonths = [...new Set(txns.map((t) => monthOf(t.postedOn)))].filter((m) => m < monthOf(today)).sort();
  const months = dataMonths.slice(-3);
  if (months.length === 0) return [];
  const totals = new Map<string, number>();
  for (const m of months) for (const [cat, v] of categorySpend(txns, currency, m)) totals.set(cat, (totals.get(cat) ?? 0) + v);
  const out: BudgetSuggestion[] = [];
  for (const [cat, sum] of totals) {
    if (NO_SUGGEST.has(cat) || opts.existing?.has(cat)) continue;
    const average = round2(sum / months.length);
    if (average < threshold(200, currency)) continue;
    out.push({ category: cat, label: categoryLabel(cat), suggested: niceCeil(average, currency), average });
  }
  return out.sort((a, b) => b.average - a.average || a.category.localeCompare(b.category));
}

/**
 * Over-budget alerts for the current month and the one before it (late
 * statements fill in last month after it ended). One per category per month
 * (`over_budget:<category>:<YYYY-MM>`), plus `over_budget:total:<YYYY-MM>`
 * when an overall monthly budget is set and exceeded.
 */
export function budgetAlerts(opts: {
  txns: readonly Txn[];
  currency: string;
  today: string;
  budgets: readonly BudgetInput[];
  monthlyBudget?: number | null;
  monthlyRollover?: Rollover;
}): AlertCandidate[] {
  const { currency, today } = opts;
  const fmt = (n: number) => formatMoney(n, currency);
  const cur = monthOf(today);
  const out: AlertCandidate[] = [];
  for (const month of [addMonths(cur, -1), cur]) {
    for (const l of budgetLines(opts.txns, currency, month, opts.budgets)) {
      if (l.status !== "over" || l.budget <= 0) continue;
      const label = l.label.toLowerCase();
      const what = l.rolledOver !== 0 ? `${fmt(l.available)} budget (with rollover)` : `${fmt(l.budget)} budget`;
      out.push({
        kind: "over_budget",
        dedupeKey: `over_budget:${l.category}:${month}`,
        title: `Over your ${label} budget`,
        body: `You've spent ${fmt(l.spent)} on ${label} in ${monthLabel(month)}, ${fmt(l.spent - l.available)} over your ${what}.`,
        category: l.category,
        amount: l.spent,
        baseline: l.available,
        periodStart: monthStart(month),
      });
    }
    const total = overallBudgetLine(opts.txns, currency, month, opts.monthlyBudget, opts.monthlyRollover);
    if (total && total.status === "over") {
      const spent = total.spent;
      const mb = total.available;
      out.push({
        kind: "over_budget",
        dedupeKey: `over_budget:total:${month}`,
        title: `Over your monthly budget`,
        body: `You've spent ${fmt(spent)} in ${monthLabel(month)}, ${fmt(spent - mb)} over your ${fmt(mb)} monthly budget${total.rolledOver !== 0 ? " (with rollover)" : ""}.`,
        amount: spent,
        baseline: round2(mb),
        periodStart: monthStart(month),
      });
    }
  }
  return out;
}
