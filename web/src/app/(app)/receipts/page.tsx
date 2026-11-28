"use client";

import { Copy, Link2, Mail, ReceiptText, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { delay, Eyebrow } from "@/components/app-ui";
import { SOURCE_META } from "@/components/bits";
import { CopyButton, EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner } from "@/components/common";
import { AddReceiptButton, duplicateReceiptIds, ReceiptBadges, ReceiptDropZone } from "@/components/receipts";
import { Badge } from "@/components/ui/badge";
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
