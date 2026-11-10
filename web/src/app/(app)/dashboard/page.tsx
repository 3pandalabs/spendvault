"use client";

import { ArrowRight, Inbox, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertIcon } from "@/components/bits";
import { BarChart, Delta, HBarList, ShareStrip } from "@/components/charts";
import { EmptyState, LoadError, PageHeader, Panel, PanelTitle, Skeleton, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { getDashboard } from "@/lib/api";
import { categoryColor, categoryLabel } from "@/lib/categories";
import { fmtDay, fmtMonth, fmtMonthShort, fmtTimestamp, money, monthRange } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Dashboard } from "@/lib/types";

export default function DashboardPage() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const dash = useAsync(() => getDashboard(month), `dash:${month ?? ""}`);
  const d = dash.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={d ? `${fmtMonth(d.month)} across all your cards and accounts` : "Your spending across every card and account"}
        actions={
          d && d.availableMonths.length > 0 ? (
            <select
              aria-label="Month"
              className={`${selectClass} w-48`}
              value={d.month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {(d.availableMonths.includes(d.month) ? d.availableMonths : [d.month, ...d.availableMonths]).map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m)}
                </option>
              ))}
            </select>
          ) : null
        }
      />
      {dash.error ? (
        <LoadError error={dash.error} onRetry={dash.reload} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : d.availableMonths.length === 0 && d.totals.txnCount === 0 ? (
        <NoData />
      ) : (
        <DashboardBody d={d} />
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}

function NoData() {
  const { me } = useSession();
  return (
    <EmptyState
      icon={<Inbox />}
      title="No transactions yet"
      body={
        me.setup.hasDocuments
          ? "We've received your files and are still reading them. This usually takes under a minute. Check Documents for progress."
          : "Send us a bank or card statement to get started. The quickest way is a Gmail filter that forwards new statements automatically."
      }
      action={
        <>
          <Link href="/setup">
            <Button>
              Set up forwarding <ArrowRight />
            </Button>
          </Link>
          <Link href="/documents">
            <Button variant="outline">{me.setup.hasDocuments ? "See documents" : "Upload a statement"}</Button>
          </Link>
        </>
      }
    />
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const router = useRouter();
  const cur = d.currency;
  const t = d.totals;
  const range = monthRange(d.month);
  const dailyAvg = d.daily.length ? t.spend / d.daily.length : 0;
  const nonZeroDays = d.daily.filter((x) => x.amount > 0).map((x) => x.amount);
  const median = nonZeroDays.length ? [...nonZeroDays].sort((a, b) => a - b)[Math.floor(nonZeroDays.length / 2)] : 0;
  const spikeAt = Math.max(median * 3, dailyAvg * 2.5);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="sm:col-span-1">
          <p className="text-sm text-fg-muted">Spent in {fmtMonthShort(d.month)}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular">{money(t.spend, cur)}</p>
          <p className="mt-1 text-xs text-fg-muted">{t.txnCount.toLocaleString("en-IN")} transactions</p>
        </Panel>
        <Panel>
          <p className="text-sm text-fg-muted">vs last month</p>
          <p className="mt-1 text-xl font-semibold tabular">{money(t.previousMonthSpend, cur)}</p>
          <Delta value={t.spend} base={t.previousMonthSpend} className="mt-1" suffix="this month" />
        </Panel>
        <Panel>
          <p className="text-sm text-fg-muted">vs 3-month average</p>
          <p className="mt-1 text-xl font-semibold tabular">{money(t.avg3MonthSpend, cur)}</p>
          <Delta value={t.spend} base={t.avg3MonthSpend} className="mt-1" suffix="this month" />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Category breakdown */}
        <Panel className="lg:col-span-3">
          <PanelTitle
            aside={
              <Link href={`/transactions?from=${range.from}&to=${range.to}`} className="text-sm text-accent hover:underline">
                All transactions
              </Link>
            }
          >
            Where it went
          </PanelTitle>
          {d.byCategory.length === 0 ? (
            <p className="text-sm text-fg-muted">No spending this month.</p>
          ) : (
            <>
              <ShareStrip rows={d.byCategory.map((c) => ({ key: c.category, share: c.share }))} />
              <div className="mt-4">
                <HBarList
                  currency={cur}
                  rows={d.byCategory.map((c) => ({
                    key: c.category,
                    label: c.label || categoryLabel(c.category),
                    amount: c.amount,
                    color: categoryColor(c.category),
                    meta: `${Math.round(c.share * 100)}%`,
                    aside: <Delta value={c.amount} base={c.avg3} suffix="vs avg" />,
                  }))}
                />
              </div>
            </>
          )}
        </Panel>

        {/* Alerts */}
        <Panel className="lg:col-span-2">
          <PanelTitle
            aside={
              <Link href="/alerts" className="text-sm text-accent hover:underline">
                See all
              </Link>
            }
          >
            Recent alerts
          </PanelTitle>
          {d.recentAlerts.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing unusual. We&apos;ll flag spikes, new fees and price hikes here.</p>
          ) : (
            <ul className="space-y-3">
              {d.recentAlerts.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <AlertIcon kind={a.kind} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="line-clamp-2 text-sm text-fg-muted">{a.body}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{fmtTimestamp(a.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Daily */}
      <Panel>
        <PanelTitle aside={<span className="text-xs text-fg-muted">Red bars are unusually big days</span>}>
          Daily spend · {fmtMonth(d.month)}
        </PanelTitle>
        <BarChart
          caption={`Daily spend in ${fmtMonth(d.month)}`}
          currency={cur}
          tickEvery={5}
          data={d.daily.map((x) => ({
            key: x.date,
            label: fmtDay(x.date),
            tick: String(Number(x.date.slice(8))),
            value: x.amount,
          }))}
          highlight={(x) => spikeAt > 0 && x.value > spikeAt}
          refLine={dailyAvg}
          refLabel="Daily average"
          onSelect={(date) => {
            router.push(`/transactions?from=${date}&to=${date}`);
          }}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Trend */}
        <Panel>
          <PanelTitle>Last 12 months</PanelTitle>
          {d.trend.length === 0 ? (
            <p className="text-sm text-fg-muted">Not enough history yet.</p>
          ) : (
            <BarChart
              caption="Monthly spend, last 12 months"
              currency={cur}
              data={d.trend.map((x) => ({ key: x.month, label: fmtMonth(x.month), tick: fmtMonthShort(x.month).slice(0, 3), value: x.spend }))}
              tickEvery={d.trend.length > 8 ? 2 : 1}
              selected={d.month}
              color="#818cf8"
              highlight={(x) => x.key === d.month}
              refLine={t.avg3MonthSpend || undefined}
              refLabel="3-month average"
            />
          )}
        </Panel>

        {/* Top merchants */}
        <Panel>
          <PanelTitle>Top merchants</PanelTitle>
          {d.topMerchants.length === 0 ? (
            <p className="text-sm text-fg-muted">No merchants this month.</p>
          ) : (
            <ol className="divide-y divide-line">
              {d.topMerchants.map((m, i) => (
                <li key={`${m.merchant}-${i}`} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/transactions?q=${encodeURIComponent(m.merchant)}&from=${range.from}&to=${range.to}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(m.category) }} aria-hidden />
                    <span className="truncate text-sm">{m.merchant}</span>
                    <span className="shrink-0 text-xs text-fg-muted">×{m.count}</span>
                  </Link>
                  <span className="shrink-0 text-sm font-medium tabular">{money(m.amount, cur)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {/* By account */}
      <Panel>
        <PanelTitle
          aside={
            <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              <RefreshCw className="size-3.5" /> Add statements
            </Link>
          }
        >
          By card and account
        </PanelTitle>
        {d.byAccount.length === 0 ? (
          <p className="text-sm text-fg-muted">No account spending this month.</p>
        ) : (
          <HBarList
            currency={cur}
            rows={d.byAccount.map((a, i) => ({
              key: a.accountId || `acct-${i}`,
              label: a.label,
              amount: a.amount,
              color: ["#4338ca", "#0c8599", "#d6336c", "#e8590c", "#2f9e44", "#9c36b5"][i % 6],
            }))}
          />
        )}
        {t.income > 0 ? (
          <p className="mt-4 text-sm text-fg-muted">
            Money in this month (income and refunds): <span className="font-medium text-fg tabular">{money(t.income, cur)}</span>
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
