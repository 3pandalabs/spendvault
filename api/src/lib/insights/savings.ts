// Money-saving suggestions (GET /savings). Pure.
//
// No-double-count rule for estimatedMonthlySavings (= sum of tip savings):
//  - each subscription is "saved" at most once: a service dropped by an overlap
//    tip gets no price-hike tip;
//  - a category nudge subtracts the subscription/duplicate savings already
//    claimed in that category (and the subscriptions category gets no nudge);
//  - fees_charges gets no category nudge (fee tips cover it), and GST on fees
//    is folded proportionally into the fee tips instead of being its own tip;
//  - the card-rewards tip is computed on the category spend left AFTER the
//    nudge: min(3-month average, the nudge's 6-month-average target);
//  - a duplicate charge is a one-off refund, counted as amount / 12 per month.

import { classifyFee, detectDuplicates, FEE_LABELS, isFee, type FeeType } from "./fees.js";
import { detectRecurring, isSubscriptionLike, type Recurring } from "./recurring.js";
import {
  addMonths,
  categoryLabel,
  dayLabel,
  daysBetween,
  formatMoney,
  isEssential,
  isSpendCategory,
  monthOf,
  round2,
  spendEntries,
  sumBy,
  threshold,
  usable,
  type Txn,
} from "./util.js";

export type Tip = { id: string; kind: "subscription" | "fee" | "category" | "card" | "duplicate"; title: string; body: string; monthlySaving: number };

export type SavingsData = {
  estimatedMonthlySavings: number;
  subscriptions: Array<{
    merchant: string;
    category: string;
    monthlyAmount: number;
    cadence: "monthly" | "yearly" | "weekly";
    lastChargedOn: string;
    occurrences: number;
    annualCost: number;
    priceChanged: boolean;
  }>;
  fees: { totalLast12Months: number; items: Array<{ type: FeeType; label: string; amount: number; count: number }> };
  duplicates: Array<{ merchant: string; amount: number; dates: string[]; transactionIds: string[] }>;
  tips: Tip[];
};

const SERVICE_TYPES: Array<{ key: string; noun: string; match: RegExp }> = [
  { key: "music", noun: "music", match: /spotify|apple\s*music|gaana|saavn|wynk|youtube\s*(music|premium)|amazon\s*music/i },
  { key: "video", noun: "video streaming", match: /netflix|prime\s*video|amazon\s*prime|hotstar|jiocinema|sonyliv|zee5|disney|hulu|peacock|\bmax\b|paramount/i },
];

/** Discretionary categories that get nudges / card tips (fees and buckets excluded). */
const NUDGE_EXCLUDED = new Set(["fees_charges", "cash", "other", "subscriptions"]);

export function computeSavings(opts: { txns: readonly Txn[]; currency: string; today: string; recurring?: Recurring[] }): SavingsData {
  const { currency, today } = opts;
  const txns = usable(opts.txns, currency).filter((t) => daysBetween(t.postedOn, today) <= 365);
  const fmt = (n: number) => formatMoney(n, currency);
  const recurring = opts.recurring ?? detectRecurring(txns, currency, today);
  const active = recurring.filter((r) => r.active && isSubscriptionLike(r));
  const tips: Tip[] = [];
  const claimedByCategory = new Map<string, number>();
  const claim = (cat: string, n: number) => claimedByCategory.set(cat, (claimedByCategory.get(cat) ?? 0) + n);

  // ---- subscriptions: overlapping services
  const dropped = new Set<string>();
  for (const type of SERVICE_TYPES) {
    const subs = active.filter((r) => type.match.test(r.merchant)).sort((a, b) => b.monthlyAmount - a.monthlyAmount);
    if (subs.length < 2) continue;
    const rest = subs.slice(1);
    const saving = round2(rest.reduce((s, r) => s + r.monthlyAmount, 0));
    rest.forEach((r) => {
      dropped.add(r.merchantKey);
      claim(r.category, r.monthlyAmount);
    });
    const list = subs.map((r) => `${r.merchant} (${fmt(r.monthlyAmount)}/month)`);
    tips.push({
      id: `subscription_overlap:${type.key}`,
      kind: "subscription",
      title: `You pay for ${subs.length} ${type.noun} services`,
      body: `${joinAnd(list)} overlap. Keeping just the one you use most saves about ${fmt(saving)}/month.`,
      monthlySaving: saving,
    });
  }

  // ---- subscriptions: price hikes on services you keep
  for (const r of active) {
    if (!r.priceChanged || r.previousTypical === null || dropped.has(r.merchantKey)) continue;
    const perMonth = r.cadence === "weekly" ? 52 / 12 : r.cadence === "monthly" ? 1 : 1 / 12;
    const saving = round2((r.latestAmount - r.previousTypical) * perMonth);
    claim(r.category, saving);
    tips.push({
      id: `price_hike:${r.merchantKey}`,
      kind: "subscription",
      title: `${r.merchant} now costs ${fmt(r.latestAmount)}`,
      body:
        `${r.merchant} went up from ${fmt(r.previousTypical)} to ${fmt(r.latestAmount)}. Switching to a lower plan, ` +
        `or pausing it in months you don't use it, saves about ${fmt(saving)}/month.`,
      monthlySaving: saving,
    });
  }

  // ---- fees (last 12 months)
  const feeTxns = txns.filter(isFee);
  const feeAgg = new Map<FeeType, { amount: number; count: number }>();
  for (const t of feeTxns) {
    const k = classifyFee(t.descriptionRaw);
    const a = feeAgg.get(k) ?? { amount: 0, count: 0 };
    a.amount += t.amount;
    a.count += 1;
    feeAgg.set(k, a);
  }
  const feeItems = [...feeAgg.entries()]
    .map(([type, a]) => ({ type, label: FEE_LABELS[type], amount: round2(a.amount), count: a.count }))
    .sort((a, b) => b.amount - a.amount);
  const gst = feeAgg.get("gst_on_fees")?.amount ?? 0;
  const taxable = [...feeAgg.entries()].filter(([k]) => k !== "gst_on_fees").reduce((s, [, a]) => s + a.amount, 0);
  const gstRate = taxable > 0 ? gst / taxable : 0;
  const FEE_TIPS: Partial<Record<FeeType, (amt: string) => [string, string]>> = {
    late_fee: (a) => [
      "Turn on autopay for the total amount due",
      `You paid ${a} in late payment fees (with GST) in the last 12 months. Autopay for the full amount due on every card means you never pay one again.`,
    ],
    interest: (a) => [
      "Stop paying card interest",
      `You paid ${a} in interest and finance charges (with GST) in the last 12 months. Paying the full balance each month, or moving a balance you can't clear to a cheaper loan, stops it.`,
    ],
    forex: (a) => [
      "Use a zero-forex card for foreign spends",
      `You paid ${a} in forex markup (with GST) in the last 12 months. A card with no forex markup for international and foreign-currency payments would save most of it.`,
    ],
    annual_fee: (a) => [
      "Ask for an annual-fee waiver",
      `You paid ${a} in annual or membership fees (with GST) in the last 12 months. Issuers often waive it on request or above a spend target; otherwise a lifetime-free card costs nothing.`,
    ],
    cash_advance: (a) => [
      "Avoid cash withdrawals on a credit card",
      `You paid ${a} in cash-advance fees (with GST) in the last 12 months, and interest starts on day one. Withdraw from your bank account instead.`,
    ],
  };
  for (const [type, a] of feeAgg) {
    const build = FEE_TIPS[type];
    if (!build) continue;
    const yearly = a.amount * (1 + gstRate);
    const [title, body] = build(fmt(yearly));
    tips.push({ id: `fee:${type}`, kind: "fee", title, body, monthlySaving: round2(yearly / 12) });
  }

  // ---- duplicates (last 90 days)
  const recurringKeys = new Set(recurring.map((r) => r.merchantKey));
  const dups = detectDuplicates(txns, currency, recurringKeys).filter((d) => daysBetween(d.b.postedOn, today) <= 90);
  for (const d of dups) {
    const saving = round2(d.amount / 12);
    claim(d.a.category, d.amount);
    tips.push({
      id: `duplicate:${d.a.id}`,
      kind: "duplicate",
      title: `Get back a possible double charge at ${d.merchant}`,
      body:
        `${d.merchant} charged ${fmt(d.amount)} twice (${dayLabel(d.a.postedOn, false)} and ${dayLabel(d.b.postedOn)}) on the same account. ` +
        `If you only paid once, ask for a refund of ${fmt(d.amount)}.`,
      monthlySaving: saving,
    });
  }

  // ---- category nudges + card tip (latest complete month vs the 6 before it)
  const entries = spendEntries(txns);
  const catMonth = sumBy(entries, (e) => `${e.category}|${monthOf(e.date)}`);
  const dataMonths = [...new Set(txns.map((t) => monthOf(t.postedOn)))].sort();
  const complete = dataMonths.filter((m) => m < monthOf(today));
  const last = complete[complete.length - 1];
  const nudgeTarget = new Map<string, number>(); // category → the average a nudge brings it back to
  const cats = [...new Set(entries.map((e) => e.category))].filter(
    (c) => isSpendCategory(c) && !isEssential(c) && !NUDGE_EXCLUDED.has(c),
  );
  if (last) {
    const prior = complete.filter((m) => m < last && m >= addMonths(last, -6));
    if (prior.length >= 3) {
      for (const cat of cats) {
        const cur = Math.max(0, catMonth.get(`${cat}|${last}`) ?? 0);
        const avg = prior.reduce((s, m) => s + Math.max(0, catMonth.get(`${cat}|${m}`) ?? 0), 0) / prior.length;
        if (avg <= 0 || cur < avg * 1.25 || cur - avg < threshold(500, currency)) continue;
        const saving = round2(cur - avg - (claimedByCategory.get(cat) ?? 0));
        if (saving < threshold(100, currency)) continue;
        nudgeTarget.set(cat, avg);
        const label = categoryLabel(cat).toLowerCase();
        tips.push({
          id: `category:${cat}`,
          kind: "category",
          title: `Bring ${label} back to normal`,
          body:
            `You spent ${fmt(cur)} on ${label} last month, against a 6-month average of ${fmt(avg)}. ` +
            `Bringing ${label} back to your average saves about ${fmt(saving)}/month.`,
          monthlySaving: saving,
        });
      }
    }
    // Card rewards: the single biggest discretionary category averaging ≥ ₹10,000/month.
    const recent = complete.slice(-3);
    const best = cats
      .map((cat) => ({ cat, avg: recent.reduce((s, m) => s + Math.max(0, catMonth.get(`${cat}|${m}`) ?? 0), 0) / recent.length }))
      .filter((c) => c.avg >= threshold(10_000, currency))
      .sort((a, b) => b.avg - a.avg)[0];
    if (best) {
      const remaining = Math.min(best.avg, nudgeTarget.get(best.cat) ?? Infinity);
      const saving = round2(remaining * 0.05);
      const label = categoryLabel(best.cat).toLowerCase();
      tips.push({
        id: `card:${best.cat}`,
        kind: "card",
        title: `Earn back on ${label}`,
        body:
          `You spend about ${fmt(remaining)} a month on ${label}. A card with 5% back on ${label} would earn ~${fmt(saving)}/month. ` +
          `Check current reward terms before applying, and only if you pay the bill in full every month.`,
        monthlySaving: saving,
      });
    }
  }

  tips.sort((a, b) => b.monthlySaving - a.monthlySaving || a.id.localeCompare(b.id));
  const feeTotal = feeTxns.reduce((s, t) => s + t.amount, 0);
  return {
    estimatedMonthlySavings: round2(tips.reduce((s, t) => s + t.monthlySaving, 0)),
    subscriptions: active.map((r) => ({
      merchant: r.merchant,
      category: r.category,
      monthlyAmount: r.monthlyAmount,
      cadence: r.cadence,
      lastChargedOn: r.lastChargedOn,
      occurrences: r.occurrences,
      annualCost: r.annualCost,
      priceChanged: r.priceChanged,
    })),
    fees: { totalLast12Months: round2(feeTotal), items: feeItems },
    duplicates: dups.map((d) => ({ merchant: d.merchant, amount: round2(d.amount), dates: [d.a.postedOn, d.b.postedOn], transactionIds: [d.a.id, d.b.id] })),
    tips,
  };
}

function joinAnd(xs: string[]): string {
  return xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
