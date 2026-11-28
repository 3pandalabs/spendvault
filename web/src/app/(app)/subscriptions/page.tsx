"use client";

import { CalendarClock, ExternalLink, Repeat, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { delay, Eyebrow, INSIGHT_TABS, InfoTip, SubTabs } from "@/components/app-ui";
import { CategoryChip } from "@/components/bits";
import { EmptyState, LoadError, PageHeader, Panel, PanelTitle, Skeleton } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSubscriptions } from "@/lib/api";
import { fmtCount, fmtDate, fmtDay, money, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { SubscriptionItem, Subscriptions } from "@/lib/types";

const CADENCE: Record<SubscriptionItem["cadence"], string> = { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly" };

export default function SubscriptionsPage() {
  const subs = useAsync(getSubscriptions, "subscriptions");
  return (
    <>
      <PageHeader eyebrow="Insights" title="Subscriptions" subtitle="Everything that charges you on repeat, and when it charges next." />
      <SubTabs label="Insights" items={INSIGHT_TABS} />
      {subs.error ? (
        <LoadError error={subs.error} onRetry={subs.reload} />
      ) : !subs.data ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <Body s={subs.data} />
      )}
    </>
  );
}

function Body({ s }: { s: Subscriptions }) {
  const cur = s.currency;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  if (s.items.length === 0) {
    return (
      <EmptyState
        icon={<Repeat />}
        title="No subscriptions found yet"
        body="We spot a subscription after it has charged you two or three times at a regular interval. Add a few months of statements to find them sooner."
        action={
          <Link href="/documents">
            <Button className="spa-shine">Add statements</Button>
          </Link>
        }
      />
    );
  }
  const soon = [...s.items].filter((x) => x.nextExpectedOn >= today).sort((a, b) => a.nextExpectedOn.localeCompare(b.nextExpectedOn)).slice(0, 4);
  const hikes = s.items.filter((x) => x.priceChanged);
  const fresh = s.items.filter((x) => x.isNew);
  return (
    <div className="space-y-4">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <Eyebrow>Subscriptions cost you</Eyebrow>
          <InfoTip label="How we find subscriptions">
            A subscription is a charge from the same merchant at a regular interval (weekly, monthly or yearly) with a similar amount, in categories
            like streaming, apps, phone and insurance. Yearly plans count as 1/12 a month. Rent and loan payments repeat too but aren&apos;t listed here.
          </InfoTip>
        </div>
        <p className="spa-display mt-2 text-4xl font-extrabold tabular sm:text-5xl">
          <span className="spa-shimmer">{money(s.monthlyTotal, cur)}</span>
          <span className="text-lg font-normal text-zinc-400"> / month</span>
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {money(s.yearlyTotal, cur)} a year across {fmtCount(s.items.length)} subscription{s.items.length === 1 ? "" : "s"}
          {hikes.length ? ` · ${hikes.length} went up in price` : ""}
          {fresh.length ? ` · ${fresh.length} new` : ""}
        </p>
      </section>

      {soon.length > 0 ? (
        <Panel className="spa-in" style={delay(0.05)}>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="size-4 text-amber-300" aria-hidden /> Coming up
            </span>
          </PanelTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {soon.map((x) => (
              <li key={`${x.merchant}-${x.cadence}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{x.merchant}</p>
                  <p className="text-xs text-fg-muted">{fmtDay(x.nextExpectedOn)}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular">{moneyExact(x.amount, cur)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="spa-in" style={delay(0.1)}>
        <PanelTitle aside={<span className="text-sm text-fg-muted tabular">{money(s.yearlyTotal, cur)} / year</span>}>
          <span className="inline-flex items-center gap-2">
            <Repeat className="size-4" aria-hidden /> All subscriptions
          </span>
        </PanelTitle>
        <ul className="divide-y divide-line">
          {s.items.map((x) => (
            <li key={`${x.merchant}-${x.cadence}`} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/transactions?q=${encodeURIComponent(x.merchant)}`} className="font-medium hover:underline">
                    {x.merchant}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <CategoryChip category={x.category} className="text-xs text-fg-muted" />
                    {x.isNew ? <Badge variant="good">New</Badge> : null}
                    {x.priceChanged ? (
                      <Badge variant="warn">
                        <TrendingUp className="size-3" aria-hidden />
                        {x.previousAmount != null ? `Up from ${moneyExact(x.previousAmount, cur)}` : "Price went up"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular">{moneyExact(x.amount, cur)}</p>
                  <p className="text-xs text-fg-muted">{CADENCE[x.cadence]}</p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-fg-muted">Per month</dt>
                  <dd className="tabular">{money(x.monthlyAmount, cur)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Per year</dt>
                  <dd className="tabular">{money(x.annualCost, cur)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Next charge</dt>
                  <dd>{fmtDate(x.nextExpectedOn)}</dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-fg-muted">
                {x.occurrences} charges since {fmtDate(x.firstChargedOn)} · last {fmtDate(x.lastChargedOn)}
              </p>
              {x.cancel ? (
                <div className="mt-2 text-xs">
                  <a
                    href={x.cancel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline"
                  >
                    How to cancel {x.cancel.name} <ExternalLink className="size-3" aria-hidden />
                  </a>
                  {x.cancel.note ? <p className="mt-0.5 text-fg-muted">{x.cancel.note}</p> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="text-xs text-fg-muted">
        New subscriptions and price increases also show up in{" "}
        <Link href="/alerts" className="text-accent-strong hover:underline">
          Alerts
        </Link>
        . Next-charge dates are estimates from your past charges. We link to each service&apos;s own account page. SpendVault never cancels anything for you.
      </p>
    </div>
  );
}
