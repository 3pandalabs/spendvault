"use client";

import { ArrowRight, Bell, Camera, Gauge, Inbox, Landmark, Mail, ReceiptText, RefreshCw, ScanLine, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { delay, Eyebrow, InfoTip, ProgressBar, ReceiptPill } from "@/components/app-ui";
import { AlertIcon } from "@/components/bits";
import { BarChart, Delta, HBarList, ShareStrip } from "@/components/charts";
import { EmptyState, LoadError, PageHeader, Panel, PanelTitle, Skeleton, selectClass } from "@/components/common";
import { AddReceiptButton } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { getDashboard, listTransactions } from "@/lib/api";
import { ACCOUNT_COLORS, categoryColor, categoryLabel } from "@/lib/categories";
import { fmtCount, fmtDay, fmtMonth, fmtMonthShort, fmtTimestamp, money, moneyExact, monthRange } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Alert, Dashboard, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

// Charges where a receipt usually exists and adds item-level detail.
const RECEIPT_WORTHY = new Set(["groceries", "shopping", "dining", "health", "food_delivery", "entertainment", "other"]);
// "Bigger" charge worth a receipt, in the user's base currency.
const MISSING_RECEIPT_MIN: Record<string, number> = { USD: 20, INR: 1000 };

export default function DashboardPage() {
  const { me } = useSession();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const inHousehold = Boolean(me.features?.household && me.household);
  // "all" = everyone in the household, a user id = one member, "me" = personal view.
  const [view, setView] = useState<string>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "household" ? "all" : "me",
  );
  const scope = inHousehold && view !== "me" ? { scope: "household" as const, member: view === "all" ? undefined : view } : undefined;
  const dash = useAsync(() => getDashboard(month, scope), `dash:${month ?? ""}:${scope ? view : "me"}`);
  const d = dash.data;
  const first = me.displayName?.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={first ? `Hi ${first}` : "Overview"}
        subtitle={d ? `${fmtMonth(d.month)} across every card and account` : "Your spending across every card and account"}
        actions={
          <div className="flex flex-wrap gap-2">
            {inHousehold ? (
              <select aria-label="Whose spending" className={`${selectClass} w-44`} value={view} onChange={(e) => setView(e.target.value)}>
                <option value="me">Just me</option>
                <option value="all">Household</option>
                {(d?.members ?? [])
                  .filter((m) => !m.isMe)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
              </select>
            ) : null}
            {d && d.availableMonths.length > 0 ? (
              <select aria-label="Month" className={`${selectClass} w-48`} value={d.month} onChange={(e) => setMonth(e.target.value)}>
                {(d.availableMonths.includes(d.month) ? d.availableMonths : [d.month, ...d.availableMonths]).map((m) => (
                  <option key={m} value={m}>
                    {fmtMonth(m)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        }
      />
      {dash.error ? (
        <LoadError error={dash.error} onRetry={dash.reload} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : d.availableMonths.length === 0 && d.totals.txnCount === 0 ? (
        <NoData onReceipt={dash.reload} />
      ) : (
        <DashboardBody d={d} reload={dash.reload} />
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-44 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

function NoData({ onReceipt }: { onReceipt: () => void }) {
  const { me } = useSession();
  return (
    <div className="space-y-4">
      <EmptyState
        icon={<Inbox />}
        title="No transactions yet"
        body={
          me.setup.hasDocuments
            ? "We've received your files and are still reading them. This usually takes under a minute. Check the Inbox for progress."
            : "Send us a bank or card statement to get started. The quickest way is a Gmail filter that forwards new statements and purchase alerts automatically."
        }
        action={
          <>
            <Link href="/setup">
              <Button className="spa-shine">
                Set up forwarding <ArrowRight />
              </Button>
            </Link>
            <Link href="/documents">
              <Button variant="outline">{me.setup.hasDocuments ? "Open Inbox" : "Upload a statement"}</Button>
            </Link>
          </>
        }
      />
      <ReceiptsPitch onUploaded={onReceipt} />
    </div>
  );
}

/** What receipts add, with the user's own currency in the example. */
function ReceiptsPitch({ onUploaded }: { onUploaded: () => void }) {
  const { me } = useSession();
  const cur = me.baseCurrency;
  const [big, a, b] = cur === "INR" ? [4200, 2900, 1300] : [40, 25, 15];
  return (
    <div className="spa-ring">
      <div className="bg-zinc-950/95 p-5 sm:p-6">
        <Eyebrow>Receipts</Eyebrow>
        <p className="spa-display mt-2 text-xl font-bold sm:text-2xl">
          See <span className="spa-shimmer">what&apos;s inside</span> every charge
        </p>
        <p className="mt-2 max-w-xl text-sm text-fg-muted">
          Your card statement says &ldquo;{money(big, cur)} at Target&rdquo;. Snap the receipt and SpendVault matches it to that charge, so you see{" "}
          {money(a, cur)} of it was groceries and {money(b, cur)} a phone case, and your category totals follow.
        </p>
        <div className="mt-4">
          <AddReceiptButton onUploaded={onUploaded} />
        </div>
      </div>
    </div>
  );
}

function DashboardBody({ d, reload }: { d: Dashboard; reload: () => void }) {
  const router = useRouter();
  const cur = d.currency;
  const t = d.totals;
  const range = monthRange(d.month);
  const txns = useAsync(() => listTransactions({ from: range.from, to: range.to, limit: 200 }), `dash-txns:${d.month}`);
  const dailyAvg = d.daily.length ? t.spend / d.daily.length : 0;
  const nonZeroDays = d.daily.filter((x) => x.amount > 0).map((x) => x.amount);
  const median = nonZeroDays.length ? [...nonZeroDays].sort((a, b) => a - b)[Math.floor(nonZeroDays.length / 2)] : 0;
  const spikeAt = Math.max(median * 3, dailyAvg * 2.5);
  const itemized = d.receipts?.itemized;
  const coverage = itemized && t.spend > 0 ? Math.min(1, itemized.amount / t.spend) : 0;

  const monthTxns = txns.data?.items ?? [];
  const minMissing = MISSING_RECEIPT_MIN[cur] ?? 20;
  const missing = monthTxns.filter((x) => x.direction === "debit" && !x.receiptId && RECEIPT_WORTHY.has(x.category) && x.amount >= minMissing);

  return (
    <div className="space-y-4">
      {/* Headline */}
      <section className="spa-tile spa-glow spa-in overflow-hidden rounded-2xl p-5 sm:p-6">
        <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-end">
          <div className="min-w-0">
            <Eyebrow>Spent in {fmtMonth(d.month)}</Eyebrow>
            <p className="spa-display mt-2 text-4xl font-extrabold tabular sm:text-5xl">{money(t.spend, cur)}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {fmtCount(t.txnCount)} transactions
              {t.income > 0 ? (
                <>
                  {" · "}
                  <span className="text-down">{money(t.income, cur)} in</span>
                </>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              <Delta value={t.spend} base={t.previousMonthSpend} suffix={t.previousMonthSpend ? `vs ${money(t.previousMonthSpend, cur)} last month` : "for last month"} />
              <Delta value={t.spend} base={t.avg3MonthSpend} suffix={t.avg3MonthSpend ? `vs ${money(t.avg3MonthSpend, cur)} 3-month avg` : "for a 3-month average"} />
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-white/10 bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <ScanLine className="size-4 text-emerald-300" aria-hidden /> Receipt-backed
              </span>
              <span className="font-semibold tabular">{money(itemized?.amount ?? 0, cur)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <div className="spa-grow h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-400" style={{ width: `${Math.max(coverage * 100, coverage ? 3 : 0)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-fg-muted">
              {itemized?.txnCount
                ? `${Math.round(coverage * 100)}% of this month's spend has item-level detail from ${fmtCount(itemized.txnCount)} receipt${itemized.txnCount === 1 ? "" : "s"}.`
                : "Add receipts to see what's inside each charge."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <AddReceiptButton compact onUploaded={reload} />
            </div>
          </div>
        </div>
      </section>

      {/* Planning: safe to spend, budgets, net worth (own view only) */}
      {d.scope === "household" ? (
        <p className="spa-in rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm text-sky-100">
          Household view: spending from {d.members?.length ?? 0} people combined. Budgets, net worth and alerts stay personal.
        </p>
      ) : (
        <PlanningRow d={d} />
      )}

      {/* Prompts: things to do now */}
      <Prompts d={d} missing={missing} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Category breakdown */}
        <Panel className="spa-in" style={delay(0.05)}>
          <PanelTitle
            aside={
              <Link href={`/transactions?from=${range.from}&to=${range.to}`} className="text-sm text-accent-strong hover:underline">
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
                  rows={d.byCategory.slice(0, 8).map((c) => ({
                    key: c.category,
                    label: c.label || categoryLabel(c.category),
                    amount: c.amount,
                    color: categoryColor(c.category),
                    meta: `${Math.round(c.share * 100)}%`,
                    aside: <Delta value={c.amount} base={c.avg3} suffix="vs avg" />,
                  }))}
                />
              </div>
              {itemized?.txnCount ? (
                <p className="mt-3 text-xs text-fg-muted">Charges with a matched receipt are split by what was bought.</p>
              ) : null}
            </>
          )}
        </Panel>

        {/* Item-level, from receipts */}
        <ItemizedPanel d={d} onUploaded={reload} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <RecentTransactions items={monthTxns} loading={txns.loading && !txns.data} error={txns.error} retry={txns.reload} range={range} />
        <AlertsPanel alerts={d.recentAlerts} />
      </div>

      {/* Daily */}
      <Panel>
        <PanelTitle aside={<span className="text-xs text-fg-muted">Red bars are unusually big days</span>}>Daily spend · {fmtMonth(d.month)}</PanelTitle>
        <BarChart
          caption={`Daily spend in ${fmtMonth(d.month)}`}
          currency={cur}
          tickEvery={5}
          data={d.daily.map((x) => ({ key: x.date, label: fmtDay(x.date), tick: String(Number(x.date.slice(8))), value: x.amount }))}
          highlight={(x) => spikeAt > 0 && x.value > spikeAt}
          refLine={dailyAvg}
          refLabel="Daily average"
          onSelect={(date) => router.push(`/transactions?from=${date}&to=${date}`)}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
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
              color="#a78bfa"
              highlight={(x) => x.key === d.month}
              refLine={t.avg3MonthSpend || undefined}
              refLabel="3-month average"
            />
          )}
        </Panel>

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

      <Panel>
        <PanelTitle
          aside={
            <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-accent-strong hover:underline">
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
            rows={d.byAccount.map((a, i) => ({ key: a.accountId || `acct-${i}`, label: a.label, amount: a.amount, color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }))}
          />
        )}
      </Panel>
    </div>
  );
}

function PlanningRow({ d }: { d: Dashboard }) {
  const { me } = useSession();
  const [thisMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const cur = d.currency;
  const s = d.safeToSpend;
  const b = d.budgets;
  const n = d.netWorth;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {/* Safe to spend */}
      <div className="spa-tile spa-in rounded-2xl p-4" style={delay(0.04)}>
        <div className="flex items-start justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Wallet className="size-4 text-emerald-300" aria-hidden /> Safe to spend
          </p>
          <InfoTip label="How safe to spend is worked out">
            {s ? (
              <>
                {s.basis === "budget" ? "Your monthly budget" : s.basis === "category_budgets" ? "Your category budgets added up" : "Your average monthly income (last 3 months)"} (
                {money(s.base, cur)}) minus what you&apos;ve spent this month ({money(s.spent, cur)}) minus subscriptions and bills still expected this
                month ({money(s.upcoming, cur)}). Card payments and transfers never count as spending.
              </>
            ) : (
              <>Your monthly budget (or average income) minus this month&apos;s spending minus subscriptions and bills still expected this month. Set a budget to see it.</>
            )}
          </InfoTip>
        </div>
        {s ? (
          <>
            <p className={cn("spa-display mt-1 text-3xl font-extrabold tabular", s.amount < 0 ? "text-red-300" : "text-emerald-200")}>{money(s.amount, cur)}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {s.amount < 0
                ? `Over by ${money(-s.amount, cur)} this month`
                : `${money(s.perDay, cur)} a day for the next ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`}
              {s.upcomingItems.length ? ` · ${money(s.upcoming, cur)} still to come` : ""}
            </p>
          </>
        ) : d.month !== thisMonth && (me.monthlyBudget || b?.count) ? (
          <p className="mt-2 text-sm text-fg-muted">Shown for the current month. Pick it above to see what&apos;s left.</p>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">
            <Link href="/budgets" className="text-accent-strong hover:underline">
              Set a monthly budget
            </Link>{" "}
            to see what&apos;s left to spend this month.
          </p>
        )}
      </div>

      {/* Budgets */}
      <Link href="/budgets" className="spa-tile spa-in block rounded-2xl p-4" style={delay(0.08)}>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Gauge className="size-4 text-amber-300" aria-hidden /> Budgets
        </p>
        {b && b.count > 0 ? (
          <>
            <p className="mt-1 text-sm">
              {b.over ? <span className="font-semibold text-red-300">{b.over} over</span> : <span className="font-semibold text-emerald-200">On track</span>}
              {b.near ? <span className="text-amber-200"> · {b.near} near</span> : null}
              <span className="text-fg-muted"> · {b.count} set</span>
            </p>
            <ul className="mt-2 space-y-2">
              {b.top.map((l) => (
                <li key={l.category}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{l.label}</span>
                    <span className="shrink-0 tabular text-fg-muted">
                      {money(l.spent, cur)} / {money(l.budget, cur)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <ProgressBar value={l.progress} status={l.status} label={`${l.label} budget used`} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">Set category budgets, with suggestions from your last 3 months.</p>
        )}
      </Link>

      {/* Net worth */}
      <Link href="/net-worth" className="spa-tile spa-in block rounded-2xl p-4" style={delay(0.12)}>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Landmark className="size-4 text-violet-300" aria-hidden /> Net worth
        </p>
        {n ? (
          <>
            <p className={cn("spa-display mt-1 text-3xl font-extrabold tabular", n.netWorth < 0 && "text-red-300")}>{money(n.netWorth, cur)}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {money(n.assets, cur)} assets · {money(n.liabilities, cur)} owed
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">Add savings, investments and loans to see what you&apos;re worth.</p>
        )}
      </Link>
    </div>
  );
}

type Prompt = { key: string; icon: React.ReactNode; tone: string; title: string; body: string; href: string; cta: string; alert?: boolean };

function Prompts({ d, missing }: { d: Dashboard; missing: Transaction[] }) {
  const cur = d.currency;
  const r = d.receipts;
  const spike = d.recentAlerts.find((a) => a.kind === "category_spike" || a.kind === "daily_spike");
  const list: Prompt[] = [];
  if (spike) {
    list.push({
      key: "spike",
      icon: <Bell className="size-4" />,
      tone: "bg-red-400/10 text-red-300",
      title: spike.title,
      body: spike.body,
      href: "/alerts",
      cta: "See alerts",
      alert: true,
    });
  }
  if (r && r.pendingExtraction > 0) {
    list.push({
      key: "pending",
      icon: <Sparkles className="size-4" />,
      tone: "bg-amber-400/10 text-amber-300",
      title: `${fmtCount(r.pendingExtraction)} receipt${r.pendingExtraction === 1 ? " needs" : "s need"} a total`,
      body: "Type the total so we can match it to the card charge.",
      href: "/receipts?match=unmatched",
      cta: "Add totals",
    });
  }
  if (r && r.unmatched - r.pendingExtraction > 0) {
    const n = r.unmatched - r.pendingExtraction;
    list.push({
      key: "unmatched",
      icon: <ReceiptText className="size-4" />,
      tone: "bg-sky-400/10 text-sky-300",
      title: `${fmtCount(n)} receipt${n === 1 ? "" : "s"} not matched yet`,
      body: "They match on their own when the statement with that charge arrives, or pick the charge yourself.",
      href: "/receipts?match=unmatched",
      cta: "Review",
    });
  }
  if (missing.length > 0) {
    const names = [...new Set(missing.map((m) => m.merchant))].slice(0, 3).join(", ");
    list.push({
      key: "missing",
      icon: <Camera className="size-4" />,
      tone: "bg-emerald-400/10 text-emerald-300",
      title: `${fmtCount(missing.length)} bigger charge${missing.length === 1 ? "" : "s"} without a receipt`,
      body: `${names}${missing.length > 3 ? " and more" : ""}. Add receipts (over ${money(MISSING_RECEIPT_MIN[cur] ?? 20, cur)}) to see what was bought.`,
      href: "/receipts",
      cta: "Add receipts",
    });
  }
  if (!list.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {list.map((p, i) => (
        <li key={p.key} className="spa-in" style={delay(0.05 * i)}>
          <Link href={p.href} className={cn("spa-tile flex h-full flex-col rounded-2xl p-4", p.alert && "spa-alert border-red-400/30")}>
            <span className="flex items-start gap-3">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", p.tone)}>{p.icon}</span>
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm font-medium">{p.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{p.body}</span>
              </span>
            </span>
            <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-accent-strong">
              {p.cta} <ArrowRight className="size-3" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ItemizedPanel({ d, onUploaded }: { d: Dashboard; onUploaded: () => void }) {
  const cur = d.currency;
  const it = d.receipts?.itemized;
  if (!it || it.txnCount === 0) return <ReceiptsPitch onUploaded={onUploaded} />;
  const max = it.byCategory[0]?.amount ?? 1;
  return (
    <div className="spa-ring spa-in" style={delay(0.1)}>
      <section className="h-full bg-zinc-950/95 p-4 sm:p-5">
        <PanelTitle
          aside={
            <Link href="/receipts?match=matched" className="text-sm text-accent-strong hover:underline">
              Receipts
            </Link>
          }
        >
          <span className="inline-flex items-center gap-2">
            <ScanLine className="size-4 text-emerald-300" aria-hidden /> What you actually bought
          </span>
        </PanelTitle>
        <p className="-mt-1 mb-4 text-sm text-fg-muted">
          {money(it.amount, cur)} across {fmtCount(it.txnCount)} charge{it.txnCount === 1 ? "" : "s"} with a matched receipt, by item.
        </p>
        <ShareStrip rows={it.byCategory.map((c) => ({ key: c.category, share: it.amount ? c.amount / it.amount : 0 }))} />
        <ul className="mt-4 space-y-2.5">
          {it.byCategory.slice(0, 7).map((c, i) => (
            <li key={c.category}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(c.category) }} aria-hidden />
                  <span className="truncate">{c.label || categoryLabel(c.category)}</span>
                </span>
                <span className="shrink-0 font-medium tabular">{money(c.amount, cur)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div className="spa-grow h-full rounded-full" style={{ width: `${Math.max(2, (c.amount / max) * 100)}%`, background: categoryColor(c.category), ...delay(0.15 + i * 0.05) }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RecentTransactions({
  items,
  loading,
  error,
  retry,
  range,
}: {
  items: Transaction[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  range: { from: string; to: string };
}) {
  const recent = items.slice(0, 8);
  return (
    <Panel className="lg:col-span-3">
      <PanelTitle
        aside={
          <Link href={`/transactions?from=${range.from}&to=${range.to}`} className="text-sm text-accent-strong hover:underline">
            See all
          </Link>
        }
      >
        Recent transactions
      </PanelTitle>
      {error ? (
        <LoadError error={error} onRetry={retry} />
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <p className="text-sm text-fg-muted">No transactions this month.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {recent.map((x) => (
            <li key={x.id}>
              <Link href={`/transactions/detail?id=${x.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.04]">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(x.category) }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{x.merchant}</span>
                    {x.receiptId ? <ReceiptPill /> : null}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {fmtDay(x.postedOn)} · {categoryLabel(x.category)}
                  </span>
                </span>
                <span className={cn("shrink-0 text-sm font-medium tabular", x.direction === "credit" && "text-down")}>
                  {x.direction === "credit" ? "+" : ""}
                  {moneyExact(x.amount, x.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <Panel className="lg:col-span-2">
      <PanelTitle
        aside={
          <Link href="/alerts" className="text-sm text-accent-strong hover:underline">
            Insights
          </Link>
        }
      >
        Alerts
      </PanelTitle>
      {alerts.length === 0 ? (
        <div className="text-sm text-fg-muted">
          <p>Nothing unusual. We&apos;ll flag spikes, new fees and price hikes here.</p>
          <Link href="/setup" className="mt-3 inline-flex items-center gap-1.5 text-accent-strong hover:underline">
            <Mail className="size-3.5" /> Turn on purchase alerts for faster updates
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => (
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
  );
}
