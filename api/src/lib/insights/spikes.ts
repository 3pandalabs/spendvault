// Spike detection → alert candidates. Pure; the sweep persists them.
// Copy is plain English and specific. Thresholds are in rupees and scaled for
// USD by util.threshold (₹1,000 → $25).

import type { AlertKind } from "../../db/schema.js";
import { classifyFee, FEE_SHORT, isFee, type FeeType } from "./fees.js";
import { detectDuplicates } from "./fees.js";
import { detectRecurring, isSubscriptionLike, type Recurring } from "./recurring.js";
import {
  addDays,
  addMonths,
  categoryLabel,
  dayLabel,
  daysBetween,
  formatMoney,
  isSpendDebit,
  median,
  merchantKey,
  monthLabel,
  monthName,
  monthOf,
  monthStart,
  round2,
  scaledMad,
  spendEntries,
  sumBy,
  threshold,
  usable,
  type SpendEntry,
  type Txn,
} from "./util.js";

export type AlertCandidate = {
  kind: AlertKind;
  dedupeKey: string;
  title: string;
  body: string;
  category?: string;
  merchant?: string;
  amount?: number;
  baseline?: number;
  periodStart?: string;
  data?: Record<string, unknown>;
};

export type SpikeInput = {
  txns: readonly Txn[];
  currency: string;
  today: string; // YYYY-MM-DD, Asia/Kolkata
  /** Precomputed recurring charges (optional; computed from txns otherwise). */
  recurring?: Recurring[];
};

/** Scheduled big payments: never a "daily spike" (rent day is not a surprise). */
const DAILY_EXCLUDED = new Set(["rent", "emi_loans", "insurance", "education"]);

export function detectSpikes(input: SpikeInput): AlertCandidate[] {
  const txns = usable(input.txns, input.currency);
  const recurring = input.recurring ?? detectRecurring(txns, input.currency, input.today);
  const ctx = { ...input, txns, recurring, entries: spendEntries(txns) };
  const largeNew = largeNewMerchants(ctx);
  // A day explained by one flagged new-merchant charge gets one alert, not two.
  const flagged = new Set(largeNew.map((a) => String(a.data?.transactionId)));
  return [
    ...categorySpikes(ctx),
    ...dailySpikes({ ...ctx, entries: ctx.entries.filter((e) => !flagged.has(e.txn.id)) }),
    ...largeNew,
    ...priceHikes(ctx),
    ...feeAlerts(ctx),
    ...duplicateAlerts(ctx),
  ];
}

type Ctx = { txns: Txn[]; currency: string; today: string; recurring: Recurring[]; entries: SpendEntry[] };

const pct = (cur: number, base: number) => Math.round(((cur - base) / base) * 100);

// ------------------------------------------------------------- category_spike

/**
 * For each of the latest two months with data (the latest alone would miss a
 * previous month whose statement arrives after the new month has started):
 * baseline = median of that category over the previous up-to-6 months in which
 * the user has ANY data (a month with no spend in the category counts as 0);
 * spread = scaled MAD, floored at 15% of the median. Flag when
 * current > median + 2.5×spread AND current − median ≥ ₹1,000, and the
 * category had spend in ≥ 2 of those prior months. The in-progress month is
 * NOT pro-rated: month-to-date must already beat the full-month threshold.
 */
export function categorySpikes(ctx: Ctx): AlertCandidate[] {
  const dataMonths = [...new Set(ctx.txns.map((t) => monthOf(t.postedOn)))].sort();
  const byCatMonth = sumBy(ctx.entries, (e) => `${e.category}|${monthOf(e.date)}`);
  const cats = [...new Set(ctx.entries.map((e) => e.category))];
  const out: AlertCandidate[] = [];
  for (const month of dataMonths.slice(-2)) {
    const priorMonths = dataMonths.filter((m) => m < month && m >= addMonths(month, -6)).slice(-6);
    if (priorMonths.length < 2) continue;
    const inProgress = month === monthOf(ctx.today);
    for (const cat of cats) {
      const current = Math.max(0, byCatMonth.get(`${cat}|${month}`) ?? 0);
      const prior = priorMonths.map((m) => Math.max(0, byCatMonth.get(`${cat}|${m}`) ?? 0));
      if (prior.filter((v) => v > 0).length < 2) continue;
      const base = median(prior);
      const spread = Math.max(scaledMad(prior), 0.15 * base);
      if (!(current > base + 2.5 * spread && current - base >= threshold(1000, ctx.currency))) continue;
      const label = categoryLabel(cat);
      const up = base > 0 ? `up ${pct(current, base)}%` : "well above normal";
      out.push({
        kind: "category_spike",
        dedupeKey: `category_spike:${cat}:${month}`,
        title: `${label} is ${up} in ${monthName(month)}`,
        body:
          `You've spent ${formatMoney(current, ctx.currency)} on ${label.toLowerCase()} in ${monthLabel(month)}` +
          `${inProgress ? " so far" : ""}, against a typical ${formatMoney(base, ctx.currency)} a month ` +
          `over the previous ${priorMonths.length} months.`,
        category: cat,
        amount: round2(current),
        baseline: round2(base),
        periodStart: monthStart(month),
        data: { priorMonths: priorMonths.length, inProgress },
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- daily_spike

/**
 * A day in the last 14 whose spend > max(3 × median daily spend of the prior
 * 90 days, median + 4 × scaled MAD) and ≥ ₹2,000. Prior days are zero-filled
 * but only from the user's first transaction (no history ≠ zero spend), and
 * at least 30 prior days are required. Rent/EMI/insurance/education are left
 * out of daily totals: those are scheduled, not surprising.
 */
export function dailySpikes(ctx: Ctx): AlertCandidate[] {
  const entries = ctx.entries.filter((e) => !DAILY_EXCLUDED.has(e.category));
  if (ctx.txns.length === 0) return [];
  const firstDay = ctx.txns.reduce((m, t) => (t.postedOn < m ? t.postedOn : m), ctx.txns[0].postedOn);
  const byDay = sumBy(entries, (e) => e.date);
  const out: AlertCandidate[] = [];
  for (let back = 13; back >= 0; back--) {
    const day = addDays(ctx.today, -back);
    const total = byDay.get(day) ?? 0;
    if (total < threshold(2000, ctx.currency)) continue;
    const prior: number[] = [];
    for (let d = 1; d <= 90; d++) {
      const p = addDays(day, -d);
      if (p < firstDay) break;
      prior.push(Math.max(0, byDay.get(p) ?? 0));
    }
    if (prior.length < 30) continue;
    const base = median(prior);
    const limit = Math.max(3 * base, base + 4 * scaledMad(prior));
    if (total <= limit) continue;
    const top = [...sumBy(entries.filter((e) => e.date === day && e.amount > 0), (e) => e.merchant).entries()].sort((a, b) => b[1] - a[1])[0];
    const times = base > 0 ? ` — about ${Math.round(total / base)}× your usual ${formatMoney(base, ctx.currency)} a day` : "";
    out.push({
      kind: "daily_spike",
      dedupeKey: `daily_spike:${day}`,
      title: `Unusually high spending on ${dayLabel(day, false)}`,
      body:
        `You spent ${formatMoney(total, ctx.currency)} on ${dayLabel(day)}${times}.` +
        (top ? ` Biggest: ${top[0]} ${formatMoney(top[1], ctx.currency)}.` : ""),
      merchant: top?.[0],
      amount: round2(total),
      baseline: round2(base),
      periodStart: day,
    });
  }
  return out;
}

// ------------------------------------------------------------- large_new_merchant

/**
 * A spend debit in the last 30 days, ≥ ₹5,000 and ≥ 3 × the user's median
 * spend transaction, at a merchant not seen (any direction) in the 180 days
 * before it. Needs ≥ 60 days of history before the charge, otherwise every
 * merchant of a brand-new user would look "new".
 */
export function largeNewMerchants(ctx: Ctx): AlertCandidate[] {
  if (ctx.txns.length === 0) return [];
  const spend = ctx.txns.filter(isSpendDebit);
  const medTxn = median(spend.map((t) => t.amount));
  const firstDay = ctx.txns.reduce((m, t) => (t.postedOn < m ? t.postedOn : m), ctx.txns[0].postedOn);
  const seen = new Map<string, string[]>();
  for (const t of ctx.txns) seen.set(merchantKey(t.merchant), [...(seen.get(merchantKey(t.merchant)) ?? []), t.postedOn]);
  const out: AlertCandidate[] = [];
  for (const t of spend) {
    if (daysBetween(t.postedOn, ctx.today) > 30 || daysBetween(t.postedOn, ctx.today) < 0) continue;
    if (t.amount < threshold(5000, ctx.currency) || t.amount < 3 * medTxn) continue;
    if (daysBetween(firstDay, t.postedOn) < 60) continue;
    const from = addDays(t.postedOn, -180);
    const before = (seen.get(merchantKey(t.merchant)) ?? []).filter((d) => d >= from && d < t.postedOn);
    if (before.length) continue;
    out.push({
      kind: "large_new_merchant",
      dedupeKey: `large_new_merchant:${t.id}`,
      title: `${formatMoney(t.amount, ctx.currency)} at ${t.merchant}, a new merchant`,
      body:
        `A ${formatMoney(t.amount, ctx.currency)} charge at ${t.merchant} on ${dayLabel(t.postedOn)} is your first payment there ` +
        `in at least 6 months. If you don't recognise it, contact your bank right away.`,
      category: t.category,
      merchant: t.merchant,
      amount: round2(t.amount),
      baseline: round2(medTxn),
      periodStart: t.postedOn,
      data: { transactionId: t.id },
    });
  }
  return out;
}

// ------------------------------------------------------------- price_hike

export function priceHikes(ctx: Ctx): AlertCandidate[] {
  return ctx.recurring
    .filter((r) => isSubscriptionLike(r) && r.priceChanged && r.previousTypical !== null && daysBetween(r.latestPriceSince, ctx.today) <= 60)
    .map((r) => {
      const prev = r.previousTypical!;
      const yearly = (r.latestAmount - prev) * (r.cadence === "weekly" ? 52 : r.cadence === "monthly" ? 12 : 1);
      return {
        kind: "price_hike" as const,
        dedupeKey: `price_hike:${r.merchantKey}:${monthOf(r.latestPriceSince)}`,
        title: `${r.merchant} went up to ${formatMoney(r.latestAmount, ctx.currency)}`,
        body:
          `${r.merchant} charged ${formatMoney(r.latestAmount, ctx.currency)} on ${dayLabel(r.latestPriceSince)}, up from a typical ` +
          `${formatMoney(prev, ctx.currency)} (+${pct(r.latestAmount, prev)}%). That's ${formatMoney(yearly, ctx.currency)} more a year.`,
        category: r.category,
        merchant: r.merchant,
        amount: round2(r.latestAmount),
        baseline: round2(prev),
        periodStart: r.latestPriceSince,
        data: { cadence: r.cadence },
      };
    });
}

// ------------------------------------------------------------- fee

/**
 * Months (of the last 45 days) with any fees_charges debit ≥ ₹100. The body
 * lists every fee in that month, grouped by type, largest first.
 */
export function feeAlerts(ctx: Ctx): AlertCandidate[] {
  const fees = ctx.txns.filter(isFee);
  const recentMonths = new Set(
    fees
      .filter((t) => t.amount >= threshold(100, ctx.currency) && daysBetween(t.postedOn, ctx.today) <= 45 && t.postedOn <= ctx.today)
      .map((t) => monthOf(t.postedOn)),
  );
  return [...recentMonths].sort().map((month) => {
    const inMonth = fees.filter((t) => monthOf(t.postedOn) === month);
    const byType = new Map<FeeType, number>();
    for (const t of inMonth) byType.set(classifyFee(t.descriptionRaw), (byType.get(classifyFee(t.descriptionRaw)) ?? 0) + t.amount);
    const total = inMonth.reduce((s, t) => s + t.amount, 0);
    const parts = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FEE_SHORT[k]} ${formatMoney(v, ctx.currency)}`);
    const advice = byType.has("late_fee") || byType.has("interest")
      ? " Paying the full amount due on time avoids most of these."
      : byType.has("forex")
        ? " A zero-forex card avoids markup on foreign spends."
        : "";
    return {
      kind: "fee" as const,
      dedupeKey: `fee:${month}`,
      title: `${formatMoney(total, ctx.currency)} in fees and interest in ${monthName(month)}`,
      body: `${formatMoney(total, ctx.currency)} in fees and interest in ${monthLabel(month)}: ${parts.join(", ")}.${advice}`,
      category: "fees_charges",
      amount: round2(total),
      periodStart: monthStart(month),
      data: { types: Object.fromEntries([...byType.entries()].map(([k, v]) => [k, round2(v)])) },
    };
  });
}

// ------------------------------------------------------------- duplicate

export function duplicateAlerts(ctx: Ctx): AlertCandidate[] {
  const recurringKeys = new Set(ctx.recurring.map((r) => r.merchantKey));
  return detectDuplicates(ctx.txns, ctx.currency, recurringKeys)
    .filter((d) => daysBetween(d.b.postedOn, ctx.today) <= 30)
    .map((d) => {
      const sameDay = d.a.postedOn === d.b.postedOn;
      const when = sameDay ? `on ${dayLabel(d.a.postedOn)}` : `on ${dayLabel(d.a.postedOn, false)} and ${dayLabel(d.b.postedOn)}`;
      return {
        kind: "duplicate" as const,
        dedupeKey: `duplicate:${d.a.id}:${d.b.id}`,
        title: `Possible double charge at ${d.merchant}`,
        body:
          `Two charges of ${formatMoney(d.amount, ctx.currency)} at ${d.merchant} ${when} on the same account. ` +
          `If you only paid once, ask the merchant or your bank for a refund.`,
        category: d.a.category,
        merchant: d.merchant,
        amount: round2(d.amount),
        periodStart: d.a.postedOn,
        data: { transactionIds: [d.a.id, d.b.id] },
      };
    });
}
