// Recurring-charge (subscription) detection. Pure.

import { daysBetween, isSpendDebit, median, merchantKey, round2, threshold, type Txn } from "./util.js";

export type Cadence = "weekly" | "monthly" | "yearly";

export type Recurring = {
  merchantKey: string;
  merchant: string;
  category: string;
  cadence: Cadence;
  charges: Txn[]; // oldest first
  latestAmount: number;
  /** Typical amount before the latest price (null when the price never changed). */
  previousTypical: number | null;
  /** First charge at the latest price (when the hike started). */
  latestPriceSince: string;
  lastChargedOn: string;
  occurrences: number;
  monthlyAmount: number;
  annualCost: number;
  priceChanged: boolean;
  active: boolean;
};

const WINDOWS: Record<Cadence, [number, number]> = {
  weekly: [3, 11], // 7 ± 4
  monthly: [24, 35], // 28–31 ± 4
  yearly: [350, 380], // 365 ± 15
};
const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };
/** A subscription is "active" if its last charge is within this many days of today. */
const ACTIVE_GRACE: Record<Cadence, number> = { weekly: 21, monthly: 45, yearly: 400 };

const within = (x: number, ref: number, pct: number) => ref > 0 && Math.abs(x - ref) <= ref * pct;

function cadenceOf(intervals: number[]): Cadence | null {
  if (intervals.length === 0) return null;
  const m = median(intervals);
  for (const c of ["weekly", "monthly", "yearly"] as Cadence[]) {
    const [lo, hi] = WINDOWS[c];
    if (m < lo || m > hi) continue;
    const ok = intervals.filter((i) => i >= lo && i <= hi).length;
    if (ok / intervals.length >= 0.75) return c;
  }
  return null;
}

/**
 * Debits grouped by merchant are recurring when:
 *  - intervals cluster around 7 / 28–31 / 365 days (±4, ±15 for yearly; ≥75% of
 *    intervals in the window), with ≥3 charges — or 2 for yearly, or 2 monthly
 *    charges in the `subscriptions` category;
 *  - amounts are within ±15% of their median, OR form one price step: every
 *    charge before the latest price is within ±15% of its own median and the
 *    latest price is above it by at most 60% (a price hike, not a new thing).
 * `priceChanged` = latest ≥ 10% and ≥ ₹50 (scaled for USD) above the previous typical.
 */
export function detectRecurring(txns: readonly Txn[], currency: string, today: string): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.supersededBy || t.currency !== currency || !isSpendDebit(t)) continue;
    const k = merchantKey(t.merchant);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const charges = [...list].sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
    if (charges.length < 2) continue;
    const intervals = charges.slice(1).map((t, i) => daysBetween(charges[i].postedOn, t.postedOn));
    const cadence = cadenceOf(intervals);
    if (!cadence) continue;
    const category = mostCommon(charges.map((c) => c.category));
    const minCount = cadence === "yearly" || (cadence === "monthly" && category === "subscriptions") ? 2 : 3;
    if (charges.length < minCount) continue;

    const amounts = charges.map((c) => c.amount);
    const latest = amounts[amounts.length - 1];
    // Trailing run at the latest price (±2%).
    let runStart = amounts.length - 1;
    while (runStart > 0 && within(amounts[runStart - 1], latest, 0.02)) runStart--;
    const priors = amounts.slice(0, runStart);
    const previousTypical = priors.length ? median(priors) : null;

    const allMed = median(amounts);
    const stable = amounts.every((a) => within(a, allMed, 0.15));
    const step =
      previousTypical !== null &&
      priors.every((a) => within(a, previousTypical, 0.15)) &&
      latest > previousTypical &&
      latest <= previousTypical * 1.6;
    if (!stable && !step) continue;

    const priceChanged =
      previousTypical !== null && latest >= previousTypical * 1.1 && latest - previousTypical >= threshold(50, currency);
    const last = charges[charges.length - 1];
    const monthlyAmount = round2(latest * PER_MONTH[cadence]);
    out.push({
      merchantKey: key,
      merchant: last.merchant,
      category,
      cadence,
      charges,
      latestAmount: latest,
      previousTypical: previousTypical === null ? null : round2(previousTypical),
      latestPriceSince: charges[runStart].postedOn,
      lastChargedOn: last.postedOn,
      occurrences: charges.length,
      monthlyAmount,
      annualCost: round2(monthlyAmount * 12),
      priceChanged,
      active: daysBetween(last.postedOn, today) <= ACTIVE_GRACE[cadence],
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount || a.merchant.localeCompare(b.merchant));
}

/**
 * Categories where a recurring charge is a "subscription" the user could cancel
 * or downgrade. Rent, EMIs, metered utilities, fuel or a monthly dinner at the
 * same place recur too, but are not listed as subscriptions or price hikes
 * (they still count as recurring for duplicate detection).
 */
export const SUBSCRIPTION_LIKE: ReadonlySet<string> = new Set(["subscriptions", "telecom", "entertainment", "insurance", "education"]);
export const isSubscriptionLike = (r: Recurring) => SUBSCRIPTION_LIKE.has(r.category);

export function mostCommon(xs: readonly string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
