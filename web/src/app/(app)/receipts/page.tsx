"use client";

import { CalendarClock, Copy, Link2, Mail, ReceiptText, RefreshCw, Share2, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { delay, Eyebrow } from "@/components/app-ui";
import { SOURCE_META } from "@/components/bits";
import { CopyButton, EmptyState, ErrorText, LoadError, Loading, PageHeader, Panel, PanelTitle, Skeleton, Spinner } from "@/components/common";
import { AddReceiptButton, duplicateReceiptIds, ReceiptBadges, ReceiptDropZone } from "@/components/receipts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage, getPriceTracks, getReturns, listReceipts, rematchReceipts } from "@/lib/api";
import { fmtDate, fmtDay, fmtTimestamp, moneyExact } from "@/lib/format";
import { useAsync, usePoll } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { PriceTrack, Receipt, RefundWatch } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "matched" | "unmatched";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unmatched", label: "Not matched" },
  { key: "matched", label: "Matched" },
];

const noop = () => () => undefined;

/** ?match= from dashboard prompts, read without a Suspense boundary. */
function useInitialFilter(): Filter {
  const raw = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("match"), () => null);
  return raw === "matched" || raw === "unmatched" ? raw : "all";
}

export default function ReceiptsPage() {
  const { me } = useSession();
  const initial = useInitialFilter();
  const [picked, setPicked] = useState<Filter | null>(null);
  const filter = picked ?? initial;
  const first = useAsync(() => listReceipts({ match: filter, limit: 50 }), `receipts:${filter}`);
  const [more, setMore] = useState<{ key: Filter; items: Receipt[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [rematch, setRematch] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  const extra = more?.key === filter ? more : null;
  const items = [...(first.data?.items ?? []), ...(extra?.items ?? [])];
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);
  const dupes = duplicateReceiptIds(items);
  usePoll(first.reload, 5000, items.some((r) => r.status === "processing"));

  const refresh = () => {
    setMore(null);
    first.reload();
  };

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listReceipts({ match: filter, limit: 50, cursor });
      setMore({ key: filter, items: [...(extra?.items ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function runRematch() {
    setRematch({ busy: true, msg: null });
    try {
      const r = await rematchReceipts();
      setRematch({ busy: false, msg: r.matched ? `Matched ${r.matched} receipt${r.matched === 1 ? "" : "s"}.` : "No new matches yet." });
      refresh();
    } catch (e) {
      setRematch({ busy: false, msg: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Receipts"
        title={
          <>
            What&apos;s <span className="spa-shimmer">inside</span> each charge
          </>
        }
        subtitle="Snap, upload or forward receipts. We read the line items, match each receipt to its card or bank charge, and split that charge by what you bought."
        actions={<AddReceiptButton onUploaded={refresh} />}
      />

      {!me.llmEnabled ? (
        <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          Automatic receipt reading isn&apos;t switched on yet. Receipts are saved securely; open one and type its total so we can match it, or
          wait and we&apos;ll read it once reading is on.
        </p>
      ) : null}

      <WaysIn address={me.forwardingAddress} onUploaded={refresh} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ReturnsPanel />
        <PricePanel />
      </div>

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Filter receipts" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setPicked(f.key)}
              className={cn("rounded-lg px-3 py-1.5 text-sm", filter === f.key ? "bg-white/10 font-medium text-zinc-100" : "text-zinc-400 hover:text-zinc-200")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {rematch.msg ? <span className="text-sm text-fg-muted">{rematch.msg}</span> : null}
          <Button size="sm" variant="ghost" onClick={runRematch} disabled={rematch.busy}>
            {rematch.busy ? <Spinner /> : <RefreshCw />} Match again
          </Button>
        </div>
      </div>

      {first.error ? (
        <LoadError error={first.error} onRetry={first.reload} />
      ) : first.loading && !first.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title={filter === "all" ? "No receipts yet" : filter === "matched" ? "No matched receipts" : "Nothing waiting for a match"}
          body={
            filter === "all"
              ? "Take a photo of a receipt, upload an e-bill PDF, share a screenshot from your phone, or forward an order email to your SpendVault address."
              : "Matches appear once the statement or purchase alert with that charge arrives."
          }
        />
      ) : (
        <>
          <ul className="grid gap-2 md:grid-cols-2">
            {items.map((r, i) => (
              <ReceiptRow key={r.id} r={r} duplicate={dupes.has(r.id)} index={i} />
            ))}
          </ul>
          <div className="mt-4 flex flex-col items-center gap-2">
            {cursor ? (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Spinner /> : null} Load more
              </Button>
            ) : null}
            <ErrorText>{moreError}</ErrorText>
          </div>
        </>
      )}
    </>
  );
}

function WaysIn({ address, onUploaded }: { address: string; onUploaded: () => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
      <ReceiptDropZone onUploaded={onUploaded} />
      <div className="spa-tile rounded-2xl p-4">
        <Eyebrow className="flex items-center gap-1.5">
          <Mail className="size-3.5" /> Forward e-receipts
        </Eyebrow>
        <p className="mt-2 text-sm text-fg-muted">Order confirmations and e-receipts (Amazon, Target, Uber, DoorDash…) sent here become receipts:</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-lg bg-zinc-950/60 px-2.5 py-1.5 text-xs break-all">{address}</code>
          <CopyButton value={address} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
          <Share2 className="size-3.5 shrink-0" /> On Android, Share a photo or screenshot to SpendVault.{" "}
          <Link href="/setup#receipts" className="text-accent-strong hover:underline">
            More ways
          </Link>
        </p>
      </div>
    </div>
  );
}

function ReceiptRow({ r, duplicate, index }: { r: Receipt; duplicate: boolean; index: number }) {
  const src = SOURCE_META[r.source] ?? SOURCE_META.upload;
  const Icon = src.icon;
  return (
    <li className="spa-in" style={delay(Math.min(index, 10) * 0.03)}>
      <Link href={`/receipts/detail?id=${r.id}`} className="spa-tile flex h-full gap-3 rounded-2xl p-4">
        <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300" title={src.label}>
          <ReceiptText className="size-5" aria-hidden />
          <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-zinc-950 bg-zinc-800 text-zinc-300">
            <Icon className="size-3" aria-hidden />
          </span>
          <span className="sr-only">{src.label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{r.merchant || r.filename || "Receipt"}</p>
            <span className="shrink-0 text-sm font-semibold tabular">{r.total != null ? moneyExact(r.total, r.currency) : "Total needed"}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {[r.purchasedOn ? fmtDate(r.purchasedOn) : null, r.itemCount ? `${r.itemCount} item${r.itemCount === 1 ? "" : "s"}` : null, `added ${fmtTimestamp(r.createdAt)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ReceiptBadges r={r} />
            {r.transactionId ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                <Link2 className="size-3" aria-hidden /> linked to a charge
              </span>
            ) : null}
            {duplicate ? (
              <Badge variant="warn" title="Same shop, total and date as another receipt. Delete one if it was uploaded twice.">
                <Copy className="size-3" /> Possible duplicate
              </Badge>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

const REFUND_LABEL: Record<RefundWatch["status"], [string, "warn" | "bad" | "good" | "muted"]> = {
  waiting: ["Waiting", "warn"],
  overdue: ["No refund yet", "bad"],
  refunded: ["Refunded", "good"],
  closed: ["Stopped", "muted"],
};

function ReturnsPanel() {
  const res = useAsync(getReturns, "receipt-returns");
  const d = res.data;
  const refunds = (d?.refunds ?? []).filter((w) => w.status === "waiting" || w.status === "overdue");
  const empty = d && !d.returnWindows.length && !d.warranties.length && !refunds.length;
  return (
    <Panel className="spa-in">
      <PanelTitle>
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="size-4 text-amber-300" aria-hidden /> Returns &amp; warranties
        </span>
      </PanelTitle>
      {res.error ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !d ? (
        <Skeleton className="h-24" />
      ) : empty ? (
        <p className="text-sm text-fg-muted">
          Nothing open. Receipts from stores like Amazon, Target, Walmart or Best Buy show their typical return window here, and you can add a warranty
          date or mark something returned on any receipt.
        </p>
      ) : (
        <div className="space-y-4">
          {d.returnWindows.length ? (
            <ul className="divide-y divide-line">
              {d.returnWindows.slice(0, 6).map((x) => (
                <li key={x.receiptId}>
                  <Link href={`/receipts/detail?id=${x.receiptId}`} className="flex items-center justify-between gap-3 py-2 hover:opacity-90">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{x.merchant ?? "Receipt"}</p>
                      <p className="text-xs text-fg-muted">
                        {x.total != null ? `${moneyExact(x.total, x.currency)} · ` : ""}returns until {x.window.closesOn ? fmtDay(x.window.closesOn) : "—"}
                        {x.window.source === "typical" ? " (typical)" : ""}
                      </p>
                    </div>
                    <Badge variant={(x.window.daysLeft ?? 99) <= 3 ? "bad" : "good"}>
                      {x.window.daysLeft === 0 ? "Today" : `${x.window.daysLeft}d left`}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {refunds.length ? (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Refunds you&apos;re waiting for</p>
              <ul className="divide-y divide-line">
                {refunds.map((w) => {
                  const [label, variant] = REFUND_LABEL[w.status];
                  const href = w.transactionId ? `/transactions/detail?id=${w.transactionId}` : w.receiptId ? `/receipts/detail?id=${w.receiptId}` : "/receipts";
                  return (
                    <li key={w.id}>
                      <Link href={href} className="flex items-center justify-between gap-3 py-2 hover:opacity-90">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{w.merchant}</p>
                          <p className="text-xs text-fg-muted">
                            {moneyExact(w.amount, w.currency)} · returned {fmtDay(w.returnedOn)}
                          </p>
                        </div>
                        <Badge variant={variant}>{label}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {d.warranties.length ? (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">Warranties</p>
              <ul className="divide-y divide-line">
                {d.warranties.slice(0, 5).map((x) => (
                  <li key={x.receiptId}>
                    <Link href={`/receipts/detail?id=${x.receiptId}`} className="flex items-center justify-between gap-3 py-2 hover:opacity-90">
                      <p className="min-w-0 truncate text-sm">{x.merchant ?? "Receipt"}</p>
                      <span className="shrink-0 text-xs text-fg-muted">until {fmtDate(x.warrantyUntil)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-fg-muted">Return windows are typical store policies; check your receipt for the exact one.</p>
        </div>
      )}
    </Panel>
  );
}

function Sparkline({ t }: { t: PriceTrack }) {
  const pts = t.points;
  if (pts.length < 2) return null;
  const lo = t.minPrice;
  const span = t.maxPrice - lo || 1;
  const path = pts.map((p, i) => `${(i / (pts.length - 1)) * 60},${18 - ((p.unitPrice - lo) / span) * 16}`).join(" ");
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-14 shrink-0" aria-hidden>
      <polyline points={path} fill="none" stroke={t.changePct > 0 ? "#f87171" : t.changePct < 0 ? "#34d399" : "#a1a1aa"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PricePanel() {
  const res = useAsync(() => getPriceTracks({ limit: 8 }), "price-tracks");
  const items = res.data?.items ?? [];
  return (
    <Panel className="spa-in" style={delay(0.05)}>
      <PanelTitle>
        <span className="inline-flex items-center gap-2">
          <TrendingUp className="size-4 text-amber-300" aria-hidden /> Price tracker
        </span>
      </PanelTitle>
      {res.error ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Skeleton className="h-24" />
      ) : !items.length ? (
        <p className="text-sm text-fg-muted">
          When you buy the same item again (eggs, milk, your usual coffee beans), we track what you paid each time. Keep adding receipts and price changes show up here.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((t) => {
            const up = t.changePct > 0;
            const flat = Math.round(t.changePct) === 0;
            return (
              <li key={`${t.key}-${t.currency}`} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={t.name}>
                    {t.headline}
                  </p>
                  <p className="text-xs text-fg-muted tabular">
                    {moneyExact(t.firstPrice, t.currency)} → {moneyExact(t.latestPrice, t.currency)} · {t.points.length} purchases
                  </p>
                </div>
                <Sparkline t={t} />
                <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold tabular", flat ? "text-fg-muted" : up ? "text-up" : "text-down")}>
                  {flat ? null : up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
                  {up ? "+" : ""}
                  {Math.round(t.changePct)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
