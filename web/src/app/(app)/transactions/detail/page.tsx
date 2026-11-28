"use client";

import { ArrowLeft, ReceiptText, ScanLine } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eyebrow, ReceiptPill } from "@/components/app-ui";
import { CategoryChip } from "@/components/bits";
import { EmptyState, LoadError, Loading, Panel, PanelTitle } from "@/components/common";
import { AddReceiptButton, ItemStrip, ReceiptBadges, ReceiptItemsTable, ReceiptSummaryLine } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { getTransaction, updateReceiptItem } from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
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
