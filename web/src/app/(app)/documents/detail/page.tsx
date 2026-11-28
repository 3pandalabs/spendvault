"use client";

import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eyebrow, InfoTip } from "@/components/app-ui";
import { CategoryChip, ReconciledBadge } from "@/components/bits";
import { EmptyState, LoadError, Loading, Panel, PanelTitle } from "@/components/common";
import { Button } from "@/components/ui/button";
import { getDocument, listTransactions } from "@/lib/api";
import { fmtCount, fmtDate, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Document } from "@/lib/types";

export default function StatementDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Detail />
    </Suspense>
  );
}

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const doc = useAsync(() => getDocument(id), id ? `doc:${id}` : null);
  if (!id) return <EmptyState title="No statement selected" />;
  if (doc.error) return <LoadError error={doc.error} onRetry={doc.reload} />;
  if (!doc.data) return <Loading />;
  return <View d={doc.data} />;
}

function View({ d }: { d: Document }) {
  const router = useRouter();
  const { me } = useSession();
  const cur = me.baseCurrency;
  const txns = useAsync(() => listTransactions({ documentId: d.id, limit: 500 }), `doc-txns:${d.id}`);
  const title = d.filename || d.emailSubject || "Statement";
  const period = d.periodStart && d.periodEnd ? `${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}` : d.periodEnd ? fmtDate(d.periodEnd) : null;
  const debits = d.extractedDebits;
  const credits = d.extractedCredits ?? null;
  const hasEnds = d.openingBalance != null && d.closingBalance != null;

  return (
    <div className="space-y-4">
      <button className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={() => router.back()}>
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <Eyebrow>{d.institutionName ?? "Statement"}</Eyebrow>
        <p className="spa-display mt-2 truncate text-2xl font-bold" title={title}>
          {title}
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {[period, `${fmtCount(d.txnCount)} transaction${d.txnCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3">
          <ReconciledBadge d={d} currency={cur} className="text-sm" />
        </div>
      </section>

      <Panel>
        <PanelTitle
          aside={
            <InfoTip label="What reconciled means">
              We add up every line we read and check it against the balances printed on the statement. Cards: previous balance + charges − payments
              and credits should equal the new balance. Bank accounts: opening balance − money out + money in should equal the closing balance. A
              difference usually means a few lines were missed or misread; check them against your statement.
            </InfoTip>
          }
        >
          Reconciliation
        </PanelTitle>
        {!hasEnds ? (
          <p className="text-sm text-fg-muted">
            This statement didn&apos;t show both an opening and a closing balance we could read, so we can&apos;t check it line by line.
            {d.statementTotal != null ? ` Statement total: ${moneyExact(d.statementTotal, cur)}.` : ""}
          </p>
        ) : (
          <dl className="max-w-sm space-y-1.5 text-sm tabular">
            <Row label="Opening / previous balance" value={moneyExact(d.openingBalance, cur)} />
            <Row label="Charges and money out we read" value={debits != null ? moneyExact(debits, cur) : "—"} />
            <Row label="Payments and money in we read" value={credits != null ? moneyExact(credits, cur) : "—"} />
            <Row label="Closing / new balance on the statement" value={moneyExact(d.closingBalance, cur)} strong />
            {d.reconcileDifference != null && d.reconciled === false ? (
              <Row label="Unaccounted for" value={moneyExact(Math.abs(d.reconcileDifference), cur)} warn />
            ) : null}
          </dl>
        )}
        {d.reconciled === false ? (
          <p className="mt-3 text-sm text-amber-200">
            Not reconciled. A few transactions may be missing. Compare the list below with your statement, or upload the CSV export from your bank for this
            period.
          </p>
        ) : null}
      </Panel>

      <Panel>
        <PanelTitle
          aside={
            <Link href={`/transactions?documentId=${d.id}`} className="text-sm text-accent-strong hover:underline">
              Open in Transactions
            </Link>
          }
        >
          Transactions on this statement
        </PanelTitle>
        {txns.error ? (
          <LoadError error={txns.error} onRetry={txns.reload} />
        ) : !txns.data ? (
          <Loading />
        ) : txns.data.items.length === 0 ? (
          <EmptyState icon={<FileText />} title="No transactions" />
        ) : (
          <ul className="divide-y divide-line">
            {txns.data.items.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/transactions/detail?id=${t.id}`} className="block truncate text-sm font-medium hover:underline">
                    {t.merchant}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <span>{fmtDate(t.postedOn)}</span>
                    <CategoryChip category={t.category} className="text-xs" />
                  </div>
                </div>
                <span className={t.direction === "credit" ? "shrink-0 text-sm font-medium text-down tabular" : "shrink-0 text-sm font-medium tabular"}>
                  {t.direction === "credit" ? "+" : ""}
                  {moneyExact(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Link href="/documents">
        <Button variant="outline">Back to Inbox</Button>
      </Link>
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-semibold" : ""} ${warn ? "text-amber-200" : ""}`}>
      <dt className={strong || warn ? "" : "text-fg-muted"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
