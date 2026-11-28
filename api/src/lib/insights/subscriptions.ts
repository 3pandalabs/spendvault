// Subscriptions view (GET /subscriptions) + "new subscription" alerts. Pure.
//
// Builds on recurring.ts (same merchant, regular interval, similar amount).
// A subscription here is an ACTIVE recurring charge in a subscription-like
// category (recurring.SUBSCRIPTION_LIKE): rent, EMIs and utilities recur too
// but are bills, not things you'd cancel.

import { cancelInfoFor, type CancelInfo } from "./cancelLinks.js";
import { detectRecurring, isSubscriptionLike, type Cadence, type Recurring } from "./recurring.js";
import { dayLabel, daysBetween, formatMoney, isSpendDebit, merchantKey, round2, usable, type Txn } from "./util.js";
import type { AlertCandidate } from "./spikes.js";

/** A subscription whose first charge is this recent is "new". */
export const NEW_SUBSCRIPTION_DAYS = 75;
/** New-subscription alerts need this much history before the first charge (else every first upload would alert). */
const HISTORY_BEFORE_DAYS = 30;

export type Subscription = {
  merchant: string;
  category: string;
  cadence: Cadence;
  amount: number; // latest charge
  monthlyAmount: number;
  annualCost: number;
  firstChargedOn: string;
  lastChargedOn: string;
  nextExpectedOn: string;
  occurrences: number;
  priceChanged: boolean;
  previousAmount: number | null;
  isNew: boolean;
  /** Official account/help page to cancel it (cancelLinks.ts), when we know the service. */
  cancel: CancelInfo | null;
};

export type SubscriptionsData = {
  currency: string;
  monthlyTotal: number;
  yearlyTotal: number;
  items: Subscription[];
};

export function subscriptionView(r: Recurring, today: string): Subscription {
  return {
    merchant: r.merchant,
    category: r.category,
    cadence: r.cadence,
    amount: round2(r.latestAmount),
    monthlyAmount: r.monthlyAmount,
    annualCost: r.annualCost,
    firstChargedOn: r.firstChargedOn,
    lastChargedOn: r.lastChargedOn,
    nextExpectedOn: r.nextExpectedOn,
    occurrences: r.occurrences,
    priceChanged: r.priceChanged,
    previousAmount: r.priceChanged ? r.previousTypical : null,
    isNew: daysBetween(r.firstChargedOn, today) <= NEW_SUBSCRIPTION_DAYS,
    cancel: cancelInfoFor(`${r.merchant} ${r.charges[r.charges.length - 1]?.descriptionRaw ?? ""}`),
  };
}

export function computeSubscriptions(opts: { txns: readonly Txn[]; currency: string; today: string; recurring?: Recurring[] }): SubscriptionsData {
  const recurring = opts.recurring ?? detectRecurring(usable(opts.txns, opts.currency), opts.currency, opts.today);
  const items = recurring
    .filter((r) => r.active && isSubscriptionLike(r))
    .map((r) => subscriptionView(r, opts.today))
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount || a.merchant.localeCompare(b.merchant));
  const monthlyTotal = round2(items.reduce((s, x) => s + x.monthlyAmount, 0));
  return { currency: opts.currency, monthlyTotal, yearlyTotal: round2(monthlyTotal * 12), items };
}

/**
 * "New subscription" alerts, one per merchant ever (dedupe `new_subscription:<merchant>`):
 *  - a detected subscription whose first charge is within NEW_SUBSCRIPTION_DAYS, or
 *  - a single debit in the `subscriptions` category within the last 35 days from a
 *    merchant never charged before (a free trial that just converted).
 * Both need ≥ 30 days of the user's history before that first charge, so a
 * first upload doesn't flag every subscription as new.
 */
export function newSubscriptionAlerts(ctx: { txns: readonly Txn[]; currency: string; today: string; recurring: Recurring[] }): AlertCandidate[] {
  const txns = usable(ctx.txns, ctx.currency);
  if (txns.length === 0) return [];
  const historyStart = txns.reduce((m, t) => (t.postedOn < m ? t.postedOn : m), txns[0].postedOn);
  const enoughHistory = (first: string) => daysBetween(historyStart, first) >= HISTORY_BEFORE_DAYS;
  const fmt = (n: number) => formatMoney(n, ctx.currency);
  const out: AlertCandidate[] = [];
  const seen = new Set<string>();

  for (const r of ctx.recurring) {
    if (!r.active || !isSubscriptionLike(r)) continue;
    if (daysBetween(r.firstChargedOn, ctx.today) > NEW_SUBSCRIPTION_DAYS || !enoughHistory(r.firstChargedOn)) continue;
    seen.add(r.merchantKey);
    const every = r.cadence === "monthly" ? "a month" : r.cadence === "yearly" ? "a year" : "a week";
    out.push({
      kind: "new_subscription",
      dedupeKey: `new_subscription:${r.merchantKey}`,
      title: `New subscription: ${r.merchant}`,
      body:
        `${r.merchant} started charging you ${fmt(r.latestAmount)} ${every} on ${dayLabel(r.firstChargedOn)} ` +
        `(${fmt(r.annualCost)} a year). If you didn't mean to keep it, cancel before ${dayLabel(r.nextExpectedOn)}.`,
      category: r.category,
      merchant: r.merchant,
      amount: round2(r.latestAmount),
      periodStart: r.firstChargedOn,
      data: { cadence: r.cadence, nextExpectedOn: r.nextExpectedOn },
    });
  }

  const recurringKeys = new Set(ctx.recurring.map((r) => r.merchantKey));
  const byMerchant = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!isSpendDebit(t)) continue;
    const k = merchantKey(t.merchant);
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]);
  }
  for (const [k, list] of byMerchant) {
    if (seen.has(k) || recurringKeys.has(k) || list.length !== 1) continue;
    const t = list[0];
    if (t.category !== "subscriptions" || t.postedOn > ctx.today || daysBetween(t.postedOn, ctx.today) > 35 || !enoughHistory(t.postedOn)) continue;
    out.push({
      kind: "new_subscription",
      dedupeKey: `new_subscription:${k}`,
      title: `New subscription? ${t.merchant}`,
      body:
        `A first charge of ${fmt(t.amount)} from ${t.merchant} on ${dayLabel(t.postedOn)}. ` +
        `If it's a free trial that turned paid, cancel it before the next charge.`,
      category: t.category,
      merchant: t.merchant,
      amount: round2(t.amount),
      periodStart: t.postedOn,
      data: { transactionId: t.id },
    });
  }
  return out;
}
