"use client";

import { BellOff, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { AlertIcon, ALERT_ICON } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { dismissAlert, errorMessage, listAlerts, recomputeAlerts } from "@/lib/api";
import { categoryLabel } from "@/lib/categories";
import { fmtMonth, fmtTimestamp, money, pct, pctChange } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function AlertsPage() {
  const { me } = useSession();
  const [showDismissed, setShowDismissed] = useState(false);
  const alerts = useAsync(() => listAlerts({ includeDismissed: showDismissed, limit: 50 }), `alerts:${showDismissed}`);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkNow() {
    setChecking(true);
    setNotice(null);
    setError(null);
    try {
      const r = await recomputeAlerts();
      setNotice(r.created ? `${r.created} new alert${r.created === 1 ? "" : "s"}.` : "Nothing new. Your spending looks normal.");
      alerts.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }

  async function dismiss(id: string) {
    setDismissed((d) => ({ ...d, [id]: new Date().toISOString() }));
    try {
      await dismissAlert(id);
    } catch (e) {
      setDismissed((d) => {
        const { [id]: _, ...rest } = d;
        void _;
        return rest;
      });
      setError(errorMessage(e));
    }
  }

  const items = (alerts.data?.items ?? [])
    .map((a) => (dismissed[a.id] && !a.dismissedAt ? { ...a, dismissedAt: dismissed[a.id] } : a))
    .filter((a) => showDismissed || !a.dismissedAt);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Spending spikes, new fees, price hikes and possible double charges."
        actions={
          <Button variant="outline" onClick={checkNow} disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw />} Check now
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" className="size-4 accent-accent" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
          Show dismissed
        </label>
        {me.alertEmails ? <p className="text-xs text-fg-muted">We also email you new alerts. Turn that off in Settings.</p> : null}
      </div>
      {notice ? <p className="mb-3 rounded-lg bg-accent-soft p-3 text-sm" role="status">{notice}</p> : null}
      <ErrorText>{error}</ErrorText>

      {alerts.error ? (
        <LoadError error={alerts.error} onRetry={alerts.reload} />
      ) : alerts.loading && !alerts.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BellOff />}
          title="No alerts"
          body="We check your spending after every new statement. When a category or a day runs well above your usual, it shows up here."
          action={
            <Button variant="outline" onClick={checkNow} disabled={checking}>
              Check now
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <AlertCard key={a.id} a={a} cur={me.baseCurrency} onDismiss={() => dismiss(a.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

function AlertCard({ a, cur, onDismiss }: { a: Alert; cur: string; onDismiss: () => void }) {
  const change = a.amount != null && a.baseline ? pctChange(a.amount, a.baseline) : null;
  return (
    <li className={cn("flex gap-3 rounded-2xl border border-line bg-white p-4", a.dismissedAt && "opacity-60")}>
      <AlertIcon kind={a.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{ALERT_ICON[a.kind]?.label ?? a.kind}</p>
            <p className="font-medium">{a.title}</p>
          </div>
          {!a.dismissedAt ? (
            <button aria-label="Dismiss alert" className="rounded-full p-1.5 text-fg-muted hover:bg-bg-subtle hover:text-fg" onClick={onDismiss}>
              <X className="size-4" />
            </button>
          ) : (
            <span className="text-xs text-fg-muted">Dismissed</span>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-muted">{a.body}</p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          {a.amount != null ? (
            <div>
              <dt className="inline">Amount </dt>
              <dd className="inline font-medium text-fg tabular">{money(a.amount, cur)}</dd>
            </div>
          ) : null}
          {a.baseline != null ? (
            <div>
              <dt className="inline">Usual </dt>
              <dd className="inline font-medium text-fg tabular">{money(a.baseline, cur)}</dd>
              {change != null ? <span className="ml-1 text-up">({pct(change)})</span> : null}
            </div>
          ) : null}
          {a.category ? <div>{categoryLabel(a.category)}</div> : null}
          {a.merchant ? <div>{a.merchant}</div> : null}
          {a.periodStart ? <div>{a.periodStart.length >= 7 ? fmtMonth(a.periodStart.slice(0, 7)) : a.periodStart}</div> : null}
          <div>{fmtTimestamp(a.createdAt)}</div>
        </dl>
      </div>
    </li>
  );
}
