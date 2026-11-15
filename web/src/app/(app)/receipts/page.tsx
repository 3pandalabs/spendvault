"use client";

import { ReceiptText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SOURCE_META } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner } from "@/components/common";
import { AddReceiptButton, ReceiptBadges } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { errorMessage, listReceipts, rematchReceipts } from "@/lib/api";
import { fmtDate, fmtTimestamp, moneyExact } from "@/lib/format";
import { useAsync, usePoll } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Receipt } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "matched" | "unmatched";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unmatched", label: "Not matched" },
  { key: "matched", label: "Matched" },
];

export default function ReceiptsPage() {
  const { me } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const first = useAsync(() => listReceipts({ match: filter, limit: 50 }), `receipts:${filter}`);
  const [more, setMore] = useState<{ key: Filter; items: Receipt[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [rematch, setRematch] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  const extra = more?.key === filter ? more : null;
  const items = [...(first.data?.items ?? []), ...(extra?.items ?? [])];
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);
  usePoll(first.reload, 5000, items.some((r) => r.status === "processing"));

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
      setMore(null);
      first.reload();
    } catch (e) {
      setRematch({ busy: false, msg: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Snap or forward receipts. We match each one to the card or bank charge and show what you actually bought."
        actions={
          <AddReceiptButton
            onUploaded={() => {
              setMore(null);
              first.reload();
            }}
          />
        }
      />

      {!me.llmEnabled ? (
        <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          Automatic receipt reading isn&apos;t switched on yet. Receipts are saved securely; open one and type its total so we can match it, or
          wait and we&apos;ll read it once reading is on.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Filter receipts" className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                filter === f.key ? "bg-white/10 font-medium text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
              )}
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
              ? "Take a photo of a bill, upload an e-bill PDF, share a screenshot from your phone, or forward an order email to your SpendVault address."
              : "Matches appear once the statement with that charge arrives."
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((r) => (
              <ReceiptRow key={r.id} r={r} />
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

function ReceiptRow({ r }: { r: Receipt }) {
  const src = SOURCE_META[r.source];
  const Icon = src.icon;
  return (
    <li>
      <Link
        href={`/receipts/detail?id=${r.id}`}
        className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm hover:bg-white/[0.06]"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-muted" title={src.label}>
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{src.label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{r.merchant || r.filename || "Receipt"}</p>
            <span className="text-sm font-medium tabular">{r.total != null ? moneyExact(r.total, r.currency) : "Total needed"}</span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {[r.purchasedOn ? fmtDate(r.purchasedOn) : null, r.itemCount ? `${r.itemCount} item${r.itemCount === 1 ? "" : "s"}` : null, `added ${fmtTimestamp(r.createdAt)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2">
            <ReceiptBadges r={r} />
          </div>
        </div>
      </Link>
    </li>
  );
}
