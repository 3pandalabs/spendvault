// Free-trial-to-paid detection. Pure.
//
// A "trial" is a tiny charge (≤ $1 / ₹40, the card-verification or $0.99
// intro price) at a merchant with no other charge in the 60 days before it,
// followed 7–31 days later by a full charge from the same merchant that is
// ≥ 5× the trial and ≥ $3 / ₹120. Alerts only when that full charge is in the
// last 45 days (dedupe per merchant + full-charge date).

import { cancelInfoFor } from "./cancelLinks.js";
import type { AlertCandidate } from "./spikes.js";
import { dayLabel, daysBetween, formatMoney, isSpendDebit, merchantKey, round2, threshold, usable, type Txn } from "./util.js";

export type TrialConversion = {
  merchant: string;
  merchantKey: string;
  trialAmount: number;
  trialOn: string;
  fullAmount: number;
  fullOn: string;
  transactionId: string;
  description: string;
};

export function detectTrialConversions(all: readonly Txn[], currency: string): TrialConversion[] {
  const txns = usable(all, currency).filter(isSpendDebit);
  const small = Math.max(1, threshold(40, currency));
  const fullMin = threshold(120, currency);
  const byMerchant = new Map<string, Txn[]>();
  for (const t of txns) byMerchant.set(merchantKey(t.merchant), [...(byMerchant.get(merchantKey(t.merchant)) ?? []), t]);
  const out: TrialConversion[] = [];
  for (const [key, list] of byMerchant) {
    const sorted = [...list].sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      if (s.amount > small) continue;
      if (sorted.slice(0, i).some((p) => daysBetween(p.postedOn, s.postedOn) <= 60)) continue;
      const full = sorted.slice(i + 1).find((f) => {
        const d = daysBetween(s.postedOn, f.postedOn);
        return d >= 7 && d <= 31 && f.amount >= Math.max(5 * s.amount, fullMin);
      });
      if (!full) continue;
      out.push({
        merchant: full.merchant,
        merchantKey: key,
        trialAmount: round2(s.amount),
        trialOn: s.postedOn,
        fullAmount: round2(full.amount),
        fullOn: full.postedOn,
        transactionId: full.id,
        description: full.descriptionRaw,
      });
      break;
    }
  }
  return out.sort((a, b) => b.fullOn.localeCompare(a.fullOn));
}

export function trialAlerts(txns: readonly Txn[], currency: string, today: string): AlertCandidate[] {
  const fmt = (n: number) => formatMoney(n, currency);
  return detectTrialConversions(txns, currency)
    .filter((c) => c.fullOn <= today && daysBetween(c.fullOn, today) <= 45)
    .map((c) => {
      const cancel = cancelInfoFor(`${c.merchant} ${c.description}`);
      return {
        kind: "trial_converted" as const,
        dedupeKey: `trial_converted:${c.merchantKey}:${c.fullOn}`,
        title: `Trial turned paid: ${c.merchant} ${fmt(c.fullAmount)}`,
        body:
          `${c.merchant} charged ${fmt(c.trialAmount)} on ${dayLabel(c.trialOn)} and then ${fmt(c.fullAmount)} on ${dayLabel(c.fullOn)}, ` +
          `which looks like a free or cheap trial that converted. If you don't want it, cancel before the next charge` +
          (cancel ? ` (${cancel.name}: ${cancel.url}).` : "."),
        merchant: c.merchant,
        amount: c.fullAmount,
        baseline: c.trialAmount,
        periodStart: c.fullOn,
        data: { transactionId: c.transactionId, cancelUrl: cancel?.url ?? null },
      };
    });
}
