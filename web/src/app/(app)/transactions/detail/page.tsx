"use client";

import { ArrowLeft, NotebookPen, ReceiptText, RotateCcw, ScanLine, SplitSquareHorizontal, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Eyebrow, ReceiptPill } from "@/components/app-ui";
import { CategoryChip } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, Loading, Panel, PanelTitle, Spinner } from "@/components/common";
import { RefundBox, SplitEditor, TagEditor } from "@/components/tools";
import { AddReceiptButton, ItemStrip, ReceiptBadges, ReceiptItemsTable, ReceiptSummaryLine } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { errorMessage, getTransaction, updateReceiptItem, updateTransaction } from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import type { TransactionDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function TransactionDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Detail />
    </Suspense>
  );
}

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const res = useAsync(() => getTransaction(id), id ? `txn:${id}` : null);
  if (!id) return <EmptyState title="No transaction selected" />;
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />;
  if (!res.data) return <Loading />;
  return <View t={res.data} onChange={res.setData} />;
}

function View({ t, onChange }: { t: TransactionDetail; onChange: (t: TransactionDetail) => void }) {
  const router = useRouter();
  const r = t.receipt;
  const credit = t.direction === "credit";
  const source = t.sourceKind === "alert" ? "purchase alert" : t.sourceKind === "csv" ? "CSV export" : "statement";
  return (
    <>
      <div className="mb-3">
        <Link href="/transactions" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-zinc-100">
          <ArrowLeft className="size-4" /> Transactions
        </Link>
      </div>

      <section className="spa-tile spa-glow spa-in mb-4 rounded-2xl p-5 sm:p-6">
        <Eyebrow>{fmtDate(t.postedOn)}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="spa-display flex flex-wrap items-center gap-2 text-2xl font-bold sm:text-3xl">
              <span className="min-w-0 break-words">{t.merchant}</span>
              {r ? <ReceiptPill /> : null}
            </h1>
            <div className="mt-2">
              <CategoryChip category={t.category} />
            </div>
          </div>
          <p className={cn("spa-display text-3xl font-extrabold tabular sm:text-4xl", credit && "text-down")}>
            {credit ? "+" : ""}
            {moneyExact(t.amount, t.currency)}
          </p>
        </div>
        <p className="mt-4 break-words text-sm text-fg-muted">{t.descriptionRaw}</p>
        <p className="mt-1 text-xs text-fg-muted">
          From a {source}
          {t.categoryLocked ? " · category set by you" : ""}
        </p>
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <Tags className="size-4 text-amber-300" aria-hidden /> Tags
            </span>
          </PanelTitle>
          <TagEditor
            tags={t.tags ?? []}
            onSave={async (tags) => {
              const u = await updateTransaction(t.id, { tags });
              onChange({ ...t, tags: u.tags ?? tags });
            }}
          />
          <p className="mt-2 text-xs text-fg-muted">Tax tags feed the year-end tax export in Settings. They&apos;re labels for you, not tax advice.</p>
        </Panel>
        <Panel>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <NotebookPen className="size-4 text-amber-300" aria-hidden /> Note
            </span>
          </PanelTitle>
          <NoteEditor key={t.note ?? ""} t={t} onChange={onChange} />
        </Panel>
        {!credit ? (
          <Panel>
            <PanelTitle>
              <span className="inline-flex items-center gap-2">
                <SplitSquareHorizontal className="size-4 text-amber-300" aria-hidden /> Split
              </span>
            </PanelTitle>
            <SplitEditor
              transactionId={t.id}
              amount={t.amount}
              currency={t.currency}
              category={t.category}
              splits={t.splits ?? []}
              onSaved={(parts) => onChange({ ...t, splits: parts, hasSplit: parts.length > 0 })}
            />
            <p className="mt-2 text-xs text-fg-muted">Splits change the Overview&apos;s category breakdown. Budgets and alerts still use the whole charge.</p>
          </Panel>
        ) : null}
        {!credit ? (
          <Panel>
            <PanelTitle>
              <span className="inline-flex items-center gap-2">
                <RotateCcw className="size-4 text-amber-300" aria-hidden /> Return &amp; refund
              </span>
            </PanelTitle>
            <RefundBox refund={t.refund} target={{ transactionId: t.id }} onChange={(refund) => onChange({ ...t, refund })} />
          </Panel>
        ) : null}
      </div>

      {r ? (
        <div className="spa-ring spa-in">
          <section className="bg-zinc-950/95 p-4 sm:p-5">
            <PanelTitle aside={<ReceiptBadges r={r} />}>
              <span className="inline-flex items-center gap-2">
                <ScanLine className="size-4 text-emerald-300" aria-hidden /> What was in this charge
              </span>
            </PanelTitle>
            <div className="space-y-3">
              <ReceiptSummaryLine amount={t.amount} currency={t.currency} merchant={r.merchant ?? t.merchant} items={r.items} />
              <ItemStrip items={r.items} amount={t.amount} />
              <ReceiptItemsTable
                items={r.items}
                currency={r.currency}
                onCategory={async (it, category) => {
                  const updated = await updateReceiptItem(r.id, it.id, category);
                  onChange({ ...t, receipt: updated });
                }}
              />
              <p className="text-xs text-fg-muted">Change an item&apos;s category and the dashboard&apos;s breakdown follows.</p>
              <Link href={`/receipts/detail?id=${r.id}`}>
                <Button size="sm" variant="outline">
                  <ReceiptText /> Open receipt
                </Button>
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <Panel>
          <PanelTitle>Receipt</PanelTitle>
          {credit ? (
            <p className="text-sm text-fg-muted">Money in doesn&apos;t need a receipt.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">
                No receipt for this charge yet. Snap or upload it and we&apos;ll match it when the amount and date line up, then show what was bought.
              </p>
              <div className="flex justify-start">
                <AddReceiptButton onUploaded={() => router.push("/receipts")} />
              </div>
              <p className="text-xs text-fg-muted">
                Or forward the e-receipt email to your SpendVault address. See{" "}
                <Link href="/receipts" className="text-accent-strong hover:underline">
                  Receipts
                </Link>
                .
              </p>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function NoteEditor({ t, onChange }: { t: TransactionDetail; onChange: (t: TransactionDetail) => void }) {
  const [note, setNote] = useState(t.note ?? "");
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const dirty = note.trim() !== (t.note ?? "");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const ok = await act.run(async () => {
          const u = await updateTransaction(t.id, { note: note.trim() || null });
          onChange({ ...t, note: u.note ?? null });
        }, errorMessage);
        setSaved(ok);
      }}
    >
      <textarea
        aria-label="Note"
        maxLength={500}
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        placeholder="e.g. Split with Sam, half is theirs"
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-fg placeholder:text-zinc-500 focus-visible:border-amber-400/50 focus-visible:outline-none"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={act.busy || !dirty}>
          {act.busy ? <Spinner /> : null} Save note
        </Button>
        <span className="text-xs text-fg-muted tabular">{note.length}/500</span>
        {saved ? <span className="text-sm text-down">Saved</span> : null}
      </div>
      <ErrorText>{act.error}</ErrorText>
    </form>
  );
}
