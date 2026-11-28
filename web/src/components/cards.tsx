"use client";

// Credit card dues + utilization (GET /cards). Styles: app/(app)/app.css.

import { AlertTriangle, CreditCard } from "lucide-react";
import Link from "next/link";
import { delay, InfoTip, ProgressBar } from "@/components/app-ui";
import { Panel, PanelTitle } from "@/components/common";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { getCards } from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { CardDue } from "@/lib/types";

export function dueText(c: CardDue): { text: string; variant: BadgeVariant } {
  switch (c.status) {
    case "paid":
      return { text: "Paid", variant: "good" };
    case "nothing_due":
      return { text: "Nothing due", variant: "muted" };
    case "overdue":
      return { text: `Overdue ${Math.abs(c.daysUntilDue ?? 0)} day${Math.abs(c.daysUntilDue ?? 0) === 1 ? "" : "s"}`, variant: "bad" };
    case "due_soon":
      return { text: c.daysUntilDue === 0 ? "Due today" : c.daysUntilDue === 1 ? "Due tomorrow" : `Due in ${c.daysUntilDue} days`, variant: "warn" };
    case "upcoming":
      return { text: `Due in ${c.daysUntilDue} days`, variant: "muted" };
    default:
      return { text: "Due date unknown", variant: "outline" };
  }
}

/** Banner for cards due within 5 days or overdue (dashboard top). */
export function DueBanner({ dues }: { dues: CardDue[] }) {
  const urgent = dues.filter((d) => d.status === "due_soon" || d.status === "overdue");
  if (!urgent.length) return null;
  return (
    <div className="spa-in spa-alert rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-100">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Card payment{urgent.length === 1 ? "" : "s"} coming up
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {urgent.map((c) => (
          <li key={c.accountId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 break-words">
              {c.label}: <span className="font-medium">{dueText(c).text.toLowerCase()}</span>
              {c.dueDate ? ` (${fmtDate(c.dueDate)})` : ""}
            </span>
            <span className="text-xs text-fg-muted tabular">
              {c.minimumDue != null ? `min ${moneyExact(c.minimumDue, c.currency)}` : ""}
              {c.minimumDue != null && c.statementBalance != null ? " · " : ""}
              {c.statementBalance != null ? `balance ${moneyExact(c.statementBalance, c.currency)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CardsPanel() {
  const cards = useAsync(getCards, "cards");
  const items = cards.data?.items ?? [];
  if (!items.length) return null;
  return (
    <Panel className="spa-in" style={delay(0.05)}>
      <PanelTitle
        aside={
          <InfoTip label="About utilization">
            Utilization is your statement balance divided by the credit limit. Keeping it under about 30% is generally better for credit scores. Reminders come 5 days and 1 day before each due date.
          </InfoTip>
        }
      >
        <span className="inline-flex items-center gap-2">
          <CreditCard className="size-4 text-amber-300" aria-hidden /> Cards
        </span>
      </PanelTitle>
      <ul className="space-y-3">
        {items.map((c) => {
          const due = dueText(c);
          const u = c.utilization;
          return (
            <li key={c.accountId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={`/transactions?accountId=${c.accountId}`} className="min-w-0 break-words font-medium hover:underline">
                  {c.label}
                </Link>
                <Badge variant={due.variant}>{due.text}</Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-fg-muted">Due date</dt>
                  <dd>{fmtDate(c.dueDate)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Minimum</dt>
                  <dd className="tabular">{moneyExact(c.minimumDue, c.currency)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Statement balance</dt>
                  <dd className="tabular">{moneyExact(c.statementBalance, c.currency)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Credit limit</dt>
                  <dd className="tabular">{moneyExact(c.creditLimit, c.currency)}</dd>
                </div>
              </dl>
              {u != null ? (
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-fg-muted">Utilization</span>
                    <span className="tabular">{Math.round(u * 100)}%</span>
                  </div>
                  <ProgressBar value={u} status={u >= 0.7 ? "over" : u >= 0.3 ? "near" : "ok"} label={`${c.label} utilization`} />
                </div>
              ) : null}
              {c.paidSinceStatement > 0 && c.status !== "paid" ? (
                <p className="mt-2 text-xs text-fg-muted">{moneyExact(c.paidSinceStatement, c.currency)} paid since this statement.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-fg-muted">From each card&apos;s latest statement. A payment counts once it shows up on a statement or purchase alert.</p>
    </Panel>
  );
}
