// Bank fee classification + duplicate-charge detection. Pure.

import { daysBetween, merchantKey, threshold, type Txn } from "./util.js";

export type FeeType = "late_fee" | "interest" | "forex" | "annual_fee" | "cash_advance" | "gst_on_fees" | "other";

export const FEE_LABELS: Record<FeeType, string> = {
  late_fee: "Late payment fees",
  interest: "Interest & finance charges",
  forex: "Forex markup",
  annual_fee: "Annual & membership fees",
  cash_advance: "Cash advance fees",
  gst_on_fees: "GST on fees",
  other: "Other bank charges",
};

/** Short lowercase names used inside alert copy ("late fee ₹750, GST ₹135"). */
export const FEE_SHORT: Record<FeeType, string> = {
  late_fee: "late fee",
  interest: "interest",
  forex: "forex markup",
  annual_fee: "annual fee",
  cash_advance: "cash advance fee",
  gst_on_fees: "GST",
  other: "other charges",
};

// Ordered: first match wins. GST first ("GST on late fee" is GST, not a late fee).
const FEE_RULES: Array<[FeeType, RegExp]> = [
  ["gst_on_fees", /\b(i|c|s)?gst\b|service\s*tax/i],
  ["late_fee", /late\s*(payment)?\s*(fee|charge)|penal|overdue/i],
  ["cash_advance", /cash\s*(advance|withdrawal)\s*(fee|charge)|atm\s*(fee|charge)/i],
  ["forex", /forex|cross\s*currency|mark\s*-?\s*up|foreign\s*(currency|txn|transaction)|fx\s*(fee|charge)|international\s*(txn|transaction)/i],
  ["annual_fee", /annual\s*fee|joining\s*fee|membership\s*fee|renewal\s*fee|\bamc\b/i],
  ["interest", /interest|finance\s*charge/i],
];

export function classifyFee(description: string): FeeType {
  return FEE_RULES.find(([, re]) => re.test(description))?.[0] ?? "other";
}

export const isFee = (t: Txn) => t.direction === "debit" && t.category === "fees_charges";

export type Duplicate = { merchant: string; amount: number; a: Txn; b: Txn };

/**
 * Possible double charges: same merchant + same amount + same account within
 * 2 days, both spend debits, merchant not a known recurring charge. Skips
 * amounts under ₹200 (two chais are not a double charge), transport (tolls and
 * metro repeat the same fare), and alert-vs-statement pairs (that's one
 * purchase seen twice that superseding didn't link, not a double charge).
 * Each transaction appears in at most one pair.
 */
export function detectDuplicates(txns: readonly Txn[], currency: string, recurringMerchants: ReadonlySet<string>): Duplicate[] {
  const cands = txns
    .filter(
      (t) =>
        !t.supersededBy &&
        t.currency === currency &&
        t.direction === "debit" &&
        !["card_payment", "income", "transfers", "investments", "transport"].includes(t.category) &&
        t.amount >= threshold(200, currency) &&
        !recurringMerchants.has(merchantKey(t.merchant)),
    )
    .sort((x, y) => x.postedOn.localeCompare(y.postedOn) || x.id.localeCompare(y.id));
  const used = new Set<string>();
  const out: Duplicate[] = [];
  for (let i = 0; i < cands.length; i++) {
    const a = cands[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < cands.length; j++) {
      const b = cands[j];
      if (daysBetween(a.postedOn, b.postedOn) > 2) break;
      if (used.has(b.id)) continue;
      if (
        merchantKey(a.merchant) === merchantKey(b.merchant) &&
        Math.abs(a.amount - b.amount) < 0.005 &&
        a.accountId === b.accountId &&
        !(a.sourceKind !== b.sourceKind && (a.sourceKind === "alert" || b.sourceKind === "alert"))
      ) {
        used.add(a.id);
        used.add(b.id);
        out.push({ merchant: a.merchant, amount: a.amount, a, b });
        break;
      }
    }
  }
  return out;
}
