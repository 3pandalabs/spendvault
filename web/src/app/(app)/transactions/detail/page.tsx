"use client";

import { ArrowLeft, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CategoryChip } from "@/components/bits";
import { EmptyState, LoadError, Loading, PageHeader, Panel, PanelTitle } from "@/components/common";
import { ReceiptBadges, ReceiptItemsTable, ReceiptSummaryLine } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { getTransaction, updateReceiptItem } from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { TransactionDetail } from "@/lib/types";

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
  const r = t.receipt;
  const credit = t.direction === "credit";
  return (
    <>
      <div className="mb-3">
        <Link href="/transactions" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-zinc-100">
          <ArrowLeft className="size-4" /> Transactions
        </Link>
      </div>
      <PageHeader
        title={t.merchant}
        subtitle={`${fmtDate(t.postedOn)} · ${credit ? "+" : ""}${moneyExact(t.amount, t.currency)}`}
        actions={<CategoryChip category={t.category} />}
      />
      <Panel className="mb-4">
        <p className="break-words text-sm text-fg-muted">{t.descriptionRaw}</p>
        <p className="mt-1 text-xs text-fg-muted">
          From a {t.sourceKind === "alert" ? "transaction alert" : t.sourceKind === "csv" ? "CSV export" : "statement"}
          {t.categoryLocked ? " · category set by you" : ""}
        </p>
      </Panel>

      <Panel>
        <PanelTitle aside={r ? <ReceiptBadges r={r} /> : null}>Receipt</PanelTitle>
        {r ? (
          <div className="space-y-3">
            <ReceiptSummaryLine amount={t.amount} currency={t.currency} merchant={r.merchant ?? t.merchant} items={r.items} />
            <ReceiptItemsTable
              items={r.items}
              currency={r.currency}
              onCategory={async (it, category) => {
                const updated = await updateReceiptItem(r.id, it.id, category);
                onChange({ ...t, receipt: updated });
              }}
            />
            <Link href={`/receipts/detail?id=${r.id}`}>
              <Button size="sm" variant="outline">
                <ReceiptText /> Open receipt
              </Button>
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={<ReceiptText />}
            title="No receipt for this charge"
            body="Add a photo or e-bill in Receipts. We match it to this transaction automatically when the amount and date line up."
            action={
              <Link href="/receipts">
                <Button variant="outline">Go to Receipts</Button>
              </Link>
            }
          />
        )}
      </Panel>
    </>
  );
}
