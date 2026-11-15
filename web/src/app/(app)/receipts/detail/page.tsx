"use client";

import { ArrowLeft, Check, Link2, Link2Off, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryChip } from "@/components/bits";
import { EmptyState, ErrorText, Field, LoadError, Loading, PageHeader, Panel, PanelTitle, Spinner } from "@/components/common";
import { ReceiptBadges, ReceiptImage, ReceiptItemsTable, ReceiptSummaryLine } from "@/components/receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmReceipt,
  deleteReceipt,
  errorMessage,
  extractReceipt,
  getReceipt,
  linkReceipt,
  receiptCandidates,
  unlinkReceipt,
  updateReceipt,
  updateReceiptItem,
} from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAction, useAsync, usePoll } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { ReceiptDetail } from "@/lib/types";

export default function ReceiptDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Detail />
    </Suspense>
  );
}

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const res = useAsync(() => getReceipt(id), id ? `receipt:${id}` : null);
  usePoll(res.reload, 4000, res.data?.status === "processing");

  if (!id) return <EmptyState title="No receipt selected" action={<BackLink />} />;
  if (res.error) return <LoadError error={res.error} onRetry={res.reload} />;
  if (!res.data) return <Loading />;
  return <ReceiptView r={res.data} onChange={res.setData} reload={res.reload} />;
}

function BackLink() {
  return (
    <Link href="/receipts" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-zinc-100">
      <ArrowLeft className="size-4" /> Receipts
    </Link>
  );
}

function ReceiptView({ r, onChange, reload }: { r: ReceiptDetail; onChange: (r: ReceiptDetail) => void; reload: () => void }) {
  const { me } = useSession();
  const router = useRouter();
  const act = useAction();
  const needsTotal = r.total == null;
  const canExtract = me.llmEnabled && r.hasImage && r.status !== "extracted" && r.status !== "processing";

  return (
    <>
      <div className="mb-3">
        <BackLink />
      </div>
      <PageHeader
        title={r.merchant || "Receipt"}
        subtitle={[r.purchasedOn ? fmtDate(r.purchasedOn) : null, r.total != null ? moneyExact(r.total, r.currency) : null].filter(Boolean).join(" · ") || undefined}
        actions={<ReceiptBadges r={r} />}
      />
      {r.error ? <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">{r.error}</p> : null}
      {r.status === "pending_extraction" && !me.llmEnabled ? (
        <p className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-fg-muted">
          Saved and encrypted. Automatic reading isn&apos;t on yet, so type the total below and we&apos;ll match it to your statement.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel>
            <PanelTitle>Matched transaction</PanelTitle>
            <MatchPanel r={r} onChange={onChange} />
          </Panel>

          <Panel>
            <PanelTitle aside={r.itemsReconciled === false ? <span className="text-xs text-amber-300">Items don&apos;t add up to the total</span> : null}>
              Items
            </PanelTitle>
            {r.items.length && r.total != null ? (
              <div className="mb-3">
                <ReceiptSummaryLine amount={r.transaction?.amount ?? r.total} currency={r.currency} merchant={r.merchant} items={r.items} />
              </div>
            ) : null}
            <ReceiptItemsTable items={r.items} currency={r.currency} onCategory={async (it, category) => onChange(await updateReceiptItem(r.id, it.id, category))} />
            {r.items.length ? (
              <p className="mt-2 text-xs text-fg-muted">
                Item categories count toward your dashboard&apos;s category breakdown once the receipt is matched and its items add up.
              </p>
            ) : null}
          </Panel>

          <Panel>
            <PanelTitle>{needsTotal ? "Enter the total" : "Details"}</PanelTitle>
            <DetailsForm key={`${r.total}|${r.merchant}|${r.purchasedOn}|${r.tax}`} r={r} onChange={onChange} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelTitle>Original</PanelTitle>
            <ReceiptImage receipt={r} />
          </Panel>
          <div className="flex flex-wrap gap-2">
            {canExtract ? (
              <Button
                variant="outline"
                disabled={act.busy}
                onClick={() => act.run(async () => onChange(await extractReceipt(r.id)), errorMessage).then((ok) => ok && reload())}
              >
                <Sparkles /> Read with AI
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={act.busy}
              onClick={() => {
                if (!window.confirm("Delete this receipt and its image? The card transaction stays.")) return;
                void act.run(async () => {
                  await deleteReceipt(r.id);
                  router.replace("/receipts");
                }, errorMessage);
              }}
            >
              <Trash2 /> Delete receipt
            </Button>
          </div>
          <ErrorText>{act.error}</ErrorText>
        </div>
      </div>
    </>
  );
}

function MatchPanel({ r, onChange }: { r: ReceiptDetail; onChange: (r: ReceiptDetail) => void }) {
  const act = useAction();
  const [showCandidates, setShowCandidates] = useState(false);
  const t = r.transaction;

  if (t) {
    return (
      <div className="space-y-3">
        <Link href={`/transactions/detail?id=${t.id}`} className="block rounded-lg bg-bg-subtle p-3 hover:bg-white/10">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium">{t.merchant}</p>
            <span className="text-sm font-medium tabular">{moneyExact(t.amount, t.currency)}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {fmtDate(t.postedOn)} · {t.descriptionRaw}
          </p>
          <div className="mt-1">
            <CategoryChip category={t.category} className="text-xs" />
          </div>
        </Link>
        <div className="flex flex-wrap gap-2">
          {r.matchStatus === "auto" ? (
            <Button size="sm" disabled={act.busy} onClick={() => act.run(async () => onChange(await confirmReceipt(r.id)), errorMessage)}>
              <Check /> That&apos;s right
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={act.busy} onClick={() => act.run(async () => onChange(await unlinkReceipt(r.id)), errorMessage)}>
            <Link2Off /> Not this one
          </Button>
        </div>
        <ErrorText>{act.error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        {r.total == null
          ? "Enter the total and we'll look for the matching charge."
          : "No matching charge yet. It usually appears when the statement for that card or account arrives."}
      </p>
      {r.total != null ? (
        showCandidates ? (
          <Candidates r={r} onChange={onChange} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowCandidates(true)}>
            <Link2 /> Pick the transaction
          </Button>
        )
      ) : null}
    </div>
  );
}

function Candidates({ r, onChange }: { r: ReceiptDetail; onChange: (r: ReceiptDetail) => void }) {
  const cands = useAsync(() => receiptCandidates(r.id), `cands:${r.id}:${r.total}:${r.purchasedOn}`);
  const act = useAction();
  if (cands.error) return <LoadError error={cands.error} onRetry={cands.reload} />;
  if (!cands.data) return <Loading />;
  if (!cands.data.items.length) return <p className="text-sm text-fg-muted">No transactions close to this amount and date yet.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-lg border border-white/10">
        {cands.data.items.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{t.merchant}</p>
              <p className="text-xs text-fg-muted">
                {fmtDate(t.postedOn)} · {moneyExact(t.amount, t.currency)}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={act.busy} onClick={() => act.run(async () => onChange(await linkReceipt(r.id, t.id)), errorMessage)}>
              Link
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText>{act.error}</ErrorText>
    </div>
  );
}

function DetailsForm({ r, onChange }: { r: ReceiptDetail; onChange: (r: ReceiptDetail) => void }) {
  const [merchant, setMerchant] = useState(r.merchant ?? "");
  const [date, setDate] = useState(r.purchasedOn ?? "");
  const [total, setTotal] = useState(r.total != null ? String(r.total) : "");
  const [tax, setTax] = useState(r.tax != null ? String(r.tax) : "");
  const act = useAction();
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const t = Number(total);
    if (!total || !Number.isFinite(t) || t <= 0) return act.setError("Enter the total amount paid.");
    const x = tax === "" ? null : Number(tax);
    if (x !== null && (!Number.isFinite(x) || x < 0)) return act.setError("Tax must be a number.");
    const ok = await act.run(
      async () => onChange(await updateReceipt(r.id, { merchant: merchant.trim() || null, purchasedOn: date || null, total: t, tax: x })),
      errorMessage,
    );
    setSaved(ok);
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <Field label="Shop" htmlFor="rc-merchant">
        <Input id="rc-merchant" value={merchant} maxLength={120} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. DMart" />
      </Field>
      <Field label="Date" htmlFor="rc-date">
        <Input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={`Total paid (${r.currency})`} htmlFor="rc-total">
        <Input id="rc-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
      </Field>
      <Field label="Tax (optional)" htmlFor="rc-tax">
        <Input id="rc-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="GST" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={act.busy}>
          {act.busy ? <Spinner /> : null} Save
        </Button>
        {saved ? <span className="text-sm text-down">Saved</span> : null}
        <ErrorText>{act.error}</ErrorText>
      </div>
    </form>
  );
}
