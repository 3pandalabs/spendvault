// Refund tracking: a purchase the user marked as returned waits for a matching
// credit from the same merchant. Pure.
//
// Match: a credit (any category; banks label refunds as payments or credits),
// same currency, posted from 2 days before the return date up to 60 days
// after, from a merchant that fuzzy-matches (receipts/match.ts), amount
// between 50% of the expected refund and the expected refund + tolerance
// (partial refunds and restocking fees happen). Closest amount, then earliest
// date wins; a credit already used by another watch is skipped.
// No credit 14 days after the return → "refund_missing" alert (once per watch).

import { amountTolerance, MERCHANT_SIGNAL, receiptMerchantScore } from "../receipts/match.js";
import type { AlertCandidate } from "./spikes.js";
import { dayLabel, daysBetween, formatMoney, round2, type Txn } from "./util.js";

export const REFUND_WAIT_DAYS = 14;
const MATCH_FROM_DAYS = -2;
const MATCH_TO_DAYS = 60;

export type RefundWatchInput = {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  returnedOn: string;
  refundTransactionId: string | null;
  /** The purchase itself (never its own refund). */
  transactionId: string | null;
};

export type RefundStatus = "refunded" | "waiting" | "overdue";

export function findRefund(w: RefundWatchInput, txns: readonly Txn[], claimed: ReadonlySet<string> = new Set()): Txn | null {
  const tol = amountTolerance(w.amount);
  const cands = txns.filter((t) => {
    if (t.direction !== "credit" || t.supersededBy || t.currency !== w.currency || claimed.has(t.id) || t.id === w.transactionId) return false;
    const d = daysBetween(w.returnedOn, t.postedOn);
    if (d < MATCH_FROM_DAYS || d > MATCH_TO_DAYS) return false;
    if (t.amount > w.amount + tol || t.amount < w.amount * 0.5) return false;
    return receiptMerchantScore(w.merchant, t) >= MERCHANT_SIGNAL;
  });
  cands.sort((a, b) => Math.abs(a.amount - w.amount) - Math.abs(b.amount - w.amount) || a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
  return cands[0] ?? null;
}

export function refundStatus(w: Pick<RefundWatchInput, "returnedOn" | "refundTransactionId">, today: string): RefundStatus {
  if (w.refundTransactionId) return "refunded";
  return daysBetween(w.returnedOn, today) >= REFUND_WAIT_DAYS ? "overdue" : "waiting";
}

/** Resolve every open watch against the user's credits (one credit per watch). Returns watchId → credit. */
export function resolveRefunds(watches: readonly RefundWatchInput[], txns: readonly Txn[]): Map<string, Txn> {
  const claimed = new Set(watches.map((w) => w.refundTransactionId).filter((x): x is string => Boolean(x)));
  const out = new Map<string, Txn>();
  for (const w of [...watches].sort((a, b) => a.returnedOn.localeCompare(b.returnedOn) || a.id.localeCompare(b.id))) {
    if (w.refundTransactionId) continue;
    const hit = findRefund(w, txns, claimed);
    if (hit) {
      claimed.add(hit.id);
      out.set(w.id, hit);
    }
  }
  return out;
}

export function refundAlerts(watches: readonly RefundWatchInput[], today: string): AlertCandidate[] {
  return watches
    .filter((w) => refundStatus(w, today) === "overdue" && daysBetween(w.returnedOn, today) <= 120)
    .map((w) => ({
      kind: "refund_missing" as const,
      dedupeKey: `refund_missing:${w.id}`,
      title: `No refund yet from ${w.merchant}`,
      body:
        `You marked a ${formatMoney(w.amount, w.currency)} ${w.merchant} purchase as returned on ${dayLabel(w.returnedOn)}, ` +
        `and no matching refund has shown up in ${daysBetween(w.returnedOn, today)} days. Check the return was received, then ask the merchant or your card issuer.`,
      merchant: w.merchant,
      amount: round2(w.amount),
      periodStart: w.returnedOn,
      data: { refundWatchId: w.id },
    }));
}
