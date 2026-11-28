// Manual (hand-typed) transactions, 0005. Pure module (no env/db).
//
// A manual row is `source_kind = 'manual'`, `document_id` NULL and a
// `manual:<uuid>` fingerprint, so:
//  - statement/alert superseding never touches it (it only looks at the kinds
//    in SUPERSEDABLE_KINDS / COVERING_KINDS below),
//  - a statement line can never collide with it on (user, fingerprint),
//  - "Delete statement and its transactions" never deletes it (matched by document id),
//  - the duplicate-charge detector skips it (insights/fees.ts).
// It still counts everywhere else: dashboard, budgets, alerts, exports.

import { randomUUID } from "node:crypto";

export const MANUAL = "manual" as const;

/** Rows a later statement line may mark as superseded. */
export const SUPERSEDABLE_KINDS: readonly string[] = ["alert"];
/** Rows that may supersede an alert row. */
export const COVERING_KINDS: readonly string[] = ["statement", "csv"];

export const isManual = (t: { sourceKind: string }) => t.sourceKind === MANUAL;

export const manualFingerprint = (id: string = randomUUID()) => `${MANUAL}:${id}`;

/** The auto-created "Cash" account (one per user via the accounts unique index). */
export const CASH_ACCOUNT = { institution: "cash", kind: "cash", last4: "", label: "Cash" } as const;

export const MAX_MERCHANT = 80;

/** Fields a PATCH may change on a manual row only (statement rows keep what the bank said). */
export const MANUAL_ONLY_FIELDS = ["postedOn", "amount", "merchant", "direction", "accountId"] as const;

/** Trims and collapses spaces; empty → null. */
export function cleanMerchant(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim().slice(0, MAX_MERCHANT);
  return s || null;
}

/** A manual date must be a real calendar day, not after `today` + 1 (time zones), not before 2000. */
export function validManualDate(d: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return false;
  const max = new Date(`${today}T00:00:00Z`).getTime() + 86_400_000;
  return d >= "2000-01-01" && t.getTime() <= max;
}
