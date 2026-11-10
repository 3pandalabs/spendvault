// Reconciliation + fingerprints. Pure module.
import { createHash } from "node:crypto";
import { normalizeDescription } from "./text.js";
import type { AccountKind, ParsedTxn } from "./types.js";

export type Reconciliation = { statementTotal: number | null; extractedDebits: number; extractedCredits: number; reconciled: boolean | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Card: previous + debits − credits ≈ total due. Bank: opening − debits +
 * credits ≈ closing. Tolerance max(1, 0.5% of the total). null when the
 * statement didn't give us both ends.
 */
export function reconcile(args: {
  accountKind: AccountKind;
  previousBalance?: number | null;
  totalDue?: number | null;
  closingBalance?: number | null;
  txns: ParsedTxn[];
}): Reconciliation {
  const debits = r2(args.txns.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0));
  const credits = r2(args.txns.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0));
  const isBank = args.accountKind === "bank";
  const statementTotal = (isBank ? args.closingBalance ?? args.totalDue : args.totalDue ?? args.closingBalance) ?? null;
  let reconciled: boolean | null = null;
  const prev = args.previousBalance;
  if (prev != null && statementTotal != null && args.txns.length) {
    const expected = isBank ? prev - debits + credits : prev + debits - credits;
    reconciled = Math.abs(expected - statementTotal) <= Math.max(1, Math.abs(statementTotal) * 0.005);
  }
  return { statementTotal: statementTotal == null ? null : r2(statementTotal), extractedDebits: debits, extractedCredits: credits, reconciled };
}

/**
 * Stable per-user dedupe key. `occurrence` disambiguates identical lines in
 * one document (two ₹180 coffees on the same day must both survive), while
 * re-processing the same statement maps every line back onto its old key.
 * Alert rows get their own namespace: an alert and the statement line for the
 * same purchase can be byte-identical, and the statement row must still be
 * inserted (it supersedes the alert instead of colliding with it).
 */
export function fingerprints(accountId: string | null, txns: ParsedTxn[], namespace: "alert" | "statement" = "statement"): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const base = `${namespace === "alert" ? "alert|" : ""}${accountId ?? ""}|${t.postedOn}|${t.amount.toFixed(2)}|${t.direction}|${normalizeDescription(t.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return createHash("sha256").update(`${base}|${n}`).digest("hex");
  });
}
