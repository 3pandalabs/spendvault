// Card payment dues + utilization (GET /cards) and "due in N days" reminders. Pure.
//
// Input is each credit card's LATEST parsed statement (balance, minimum due,
// due date, credit limit) plus the card's credits after that statement
// closed. A card counts as paid once card-payment credits since the statement
// reach the minimum due (or the statement balance when no minimum was read).

import type { AlertCandidate } from "./spikes.js";
import { dayLabel, daysBetween, formatMoney, round2, type Txn } from "./util.js";

export type CardStatementInput = {
  accountId: string;
  label: string;
  currency: string;
  documentId: string;
  periodEnd: string | null;
  statementBalance: number | null;
  minimumDue: number | null;
  dueDate: string | null;
  creditLimit: number | null;
};

export type CardDueStatus = "paid" | "overdue" | "due_soon" | "upcoming" | "nothing_due" | "unknown";

export type CardDue = {
  accountId: string;
  label: string;
  currency: string;
  documentId: string;
  statementBalance: number | null;
  minimumDue: number | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  creditLimit: number | null;
  /** statementBalance / creditLimit, 0..n (can exceed 1). null without both. */
  utilization: number | null;
  paidSinceStatement: number;
  status: CardDueStatus;
};

/** Reminders fire this many days before the due date (and on the day before). */
export const DUE_SOON_DAYS = 5;

/** Card payments (or any credit categorized card_payment / income-free payment wording) on `accountId` after `since`. */
export function paymentsSince(txns: readonly Txn[], accountId: string, since: string | null): number {
  const pay = txns.filter(
    (t) =>
      t.accountId === accountId &&
      t.direction === "credit" &&
      !t.supersededBy &&
      (t.category === "card_payment" || /payment|thank you|autopay/i.test(t.descriptionRaw)) &&
      (!since || t.postedOn > since),
  );
  return round2(pay.reduce((s, t) => s + t.amount, 0));
}

export function cardDue(c: CardStatementInput, txns: readonly Txn[], today: string): CardDue {
  const paid = paymentsSince(txns, c.accountId, c.periodEnd);
  const bal = c.statementBalance;
  const need = c.minimumDue ?? bal;
  const days = c.dueDate ? daysBetween(today, c.dueDate) : null;
  let status: CardDueStatus;
  if (bal !== null && bal <= 0) status = "nothing_due";
  else if (need !== null && need > 0 && paid >= need - 0.005) status = "paid";
  else if (days === null) status = "unknown";
  else if (days < 0) status = "overdue";
  else if (days <= DUE_SOON_DAYS) status = "due_soon";
  else status = "upcoming";
  const utilization = bal !== null && c.creditLimit && c.creditLimit > 0 ? Math.round((Math.max(0, bal) / c.creditLimit) * 1000) / 1000 : null;
  return {
    accountId: c.accountId,
    label: c.label,
    currency: c.currency,
    documentId: c.documentId,
    statementBalance: bal,
    minimumDue: c.minimumDue,
    dueDate: c.dueDate,
    daysUntilDue: days,
    creditLimit: c.creditLimit,
    utilization,
    paidSinceStatement: paid,
    status,
  };
}

/** Sorted: overdue, then soonest due first; unknown dates last. */
export function cardDues(cards: readonly CardStatementInput[], txns: readonly Txn[], today: string): CardDue[] {
  const rank: Record<CardDueStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, unknown: 3, paid: 4, nothing_due: 5 };
  return cards
    .map((c) => cardDue(c, txns, today))
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.label.localeCompare(b.label));
}

/**
 * Two reminders per statement due date: stage 5 (2–5 days before) and stage 1
 * (the day before or the day itself). Dedupe `card_due:<account>:<due>:<stage>`,
 * so each reminder is raised (and emailed, via the daily alert digest) once.
 * A statement that arrives late skips straight to the stage that applies.
 */
export function cardDueAlerts(dues: readonly CardDue[], today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const d of dues) {
    if (d.status !== "due_soon" || d.dueDate === null || d.daysUntilDue === null) continue;
    const stage = d.daysUntilDue <= 1 ? 1 : 5;
    const when = d.daysUntilDue === 0 ? "today" : d.daysUntilDue === 1 ? "tomorrow" : `in ${d.daysUntilDue} days`;
    const fmt = (n: number) => formatMoney(n, d.currency);
    const amounts = [
      d.minimumDue !== null ? `minimum ${fmt(d.minimumDue)}` : null,
      d.statementBalance !== null ? `statement balance ${fmt(d.statementBalance)}` : null,
    ].filter(Boolean);
    out.push({
      kind: "card_due",
      dedupeKey: `card_due:${d.accountId}:${d.dueDate}:${stage}`,
      title: `${d.label} payment due ${when}`,
      body:
        `Your ${d.label} payment is due on ${dayLabel(d.dueDate)}${amounts.length ? ` (${amounts.join(", ")})` : ""}. ` +
        `Paying the full statement balance by then avoids interest; paying at least the minimum avoids a late fee.`,
      amount: d.minimumDue ?? d.statementBalance ?? undefined,
      baseline: d.statementBalance ?? undefined,
      periodStart: d.dueDate,
      data: { accountId: d.accountId, dueDate: d.dueDate, stage, documentId: d.documentId },
    });
    void today;
  }
  return out;
}
