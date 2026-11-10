"use client";

import { CheckCircle2, FileText, KeyRound, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SOURCE_META } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner } from "@/components/common";
import { UploadZone } from "@/components/UploadZone";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteDocument, errorMessage, listDocuments, retryDocument } from "@/lib/api";
import { fmtBytes, fmtDate, fmtTimestamp, money } from "@/lib/format";
import { useAsync, usePoll } from "@/lib/hooks";
import type { Document, DocumentStatus } from "@/lib/types";

const STATUS: Record<DocumentStatus, [string, BadgeVariant]> = {
  received: ["Received", "info"],
  processing: ["Reading…", "info"],
  parsed: ["Done", "good"],
  needs_password: ["Needs password", "warn"],
  failed: ["Couldn't read", "bad"],
  ignored: ["Skipped", "muted"],
};

const busyStatus = (s: DocumentStatus) => s === "received" || s === "processing";

export default function DocumentsPage() {
  const first = useAsync(() => listDocuments({ limit: 50 }), "docs");
  const [older, setOlder] = useState<{ items: Document[]; cursor: string | null } | null>(null);
  const [patched, setPatched] = useState<Record<string, Document | null>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // Newest first; first page refreshes on poll, older pages are appended once.
  const seen = new Set<string>();
  const items = [...(first.data?.items ?? []), ...(older?.items ?? [])]
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .map((d) => (d.id in patched ? patched[d.id] : d))
    .filter((d): d is Document => d !== null);
  const cursor = older ? older.cursor : (first.data?.nextCursor ?? null);
  const anyBusy = items.some((d) => busyStatus(d.status));

  usePoll(
    () => {
      setPatched((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v === null)));
      first.reload();
    },
    5000,
    anyBusy,
  );

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listDocuments({ limit: 50, cursor });
      setOlder({ items: [...(older?.items ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Everything you've sent us: forwarded emails, uploads, shares and WhatsApp files."
        actions={
          <Link href="/setup">
            <Button variant="outline">Set up forwarding</Button>
          </Link>
        }
      />
      <UploadZone
        onUploaded={(docs) => {
          setPatched((p) => ({ ...p, ...Object.fromEntries(docs.map((d) => [d.id, d])) }));
          first.reload();
        }}
      />

      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          Inbox {anyBusy ? <Spinner className="text-fg-muted" /> : null}
        </h2>
        {first.error ? (
          <LoadError error={first.error} onRetry={first.reload} />
        ) : !first.data ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="Nothing here yet"
            body="Upload a statement above, or set up Gmail forwarding so new statements arrive on their own."
            action={
              <Link href="/setup">
                <Button>Set up forwarding</Button>
              </Link>
            }
          />
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((d) => (
                <DocRow key={d.id} d={d} onChange={(u) => setPatched((p) => ({ ...p, [d.id]: u }))} />
              ))}
            </ul>
            <div className="mt-4 flex flex-col items-center gap-2">
              {cursor ? (
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <Spinner /> : null} Load older
                </Button>
              ) : null}
              <ErrorText>{moreError}</ErrorText>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function DocRow({ d, onChange }: { d: Document; onChange: (d: Document | null) => void }) {
  const src = SOURCE_META[d.source] ?? SOURCE_META.upload;
  const Icon = src.icon;
  const [status, variant] = STATUS[d.status] ?? [d.status, "muted"];
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTxns, setDeleteTxns] = useState(true);
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry(withPassword: boolean) {
    setBusy("retry");
    setError(null);
    try {
      const u = await retryDocument(d.id, withPassword ? { password, savePassword } : {});
      setPassword("");
      onChange(u);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await deleteDocument(d.id, deleteTxns);
      onChange(null);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const title = d.filename || d.emailSubject || "Untitled";
  const period =
    d.periodStart && d.periodEnd ? `${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}` : d.periodEnd ? fmtDate(d.periodEnd) : null;

  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <div className="flex gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-muted" title={src.label}>
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{src.label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 truncate font-medium" title={title}>
              {title}
            </p>
            <Badge variant={variant}>
              {busyStatus(d.status) ? <Spinner className="size-3" /> : null}
              {status}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {[
              d.institutionName,
              d.kind === "alert" ? "Transaction alert" : d.kind === "statement" ? "Statement" : null,
              period,
              d.source === "email" && d.emailFrom ? `from ${d.emailFrom}` : null,
              fmtBytes(d.sizeBytes),
              fmtTimestamp(d.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {d.status === "parsed" ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                {d.txnCount} transaction{d.txnCount === 1 ? "" : "s"}
              </span>
              {d.statementTotal != null ? <span className="text-fg-muted">Statement total {money(d.statementTotal)}</span> : null}
              {d.reconciled ? (
                <span className="inline-flex items-center gap-1 text-down">
                  <CheckCircle2 className="size-3.5" /> Totals match
                </span>
              ) : d.reconciled === false ? (
                <span className="text-amber-700" title="The transactions we read don't add up to the statement total. Some lines may be missing.">
                  Totals don&apos;t match
                </span>
              ) : null}
            </p>
          ) : null}
          {d.error && (d.status === "failed" || d.status === "ignored") ? <p className="mt-1 text-sm text-fg-muted">{d.error}</p> : null}

          {d.status === "needs_password" ? (
            <form
              className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password) retry(true);
              }}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <KeyRound className="size-4" /> This PDF is password-protected
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  aria-label="PDF password"
                  placeholder="PDF password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button type="submit" disabled={!password || busy !== null}>
                  {busy === "retry" ? <Spinner /> : null} Unlock
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-amber-900">
                <input type="checkbox" className="size-4 accent-accent" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
                Save password (encrypted) for future statements from this bank
              </label>
            </form>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {d.status === "failed" && d.hasOriginal ? (
              <Button size="sm" variant="outline" onClick={() => retry(false)} disabled={busy !== null}>
                {busy === "retry" ? <Spinner /> : <RotateCw />} Retry
              </Button>
            ) : null}
            {!confirmDelete ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                <Trash2 /> Delete
              </Button>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-3 rounded-xl bg-rose-50 p-3 text-sm">
                <span className="font-medium text-rose-900">Delete this document?</span>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-red-600" checked={deleteTxns} onChange={(e) => setDeleteTxns(e.target.checked)} />
                  Also delete its {d.txnCount ? `${d.txnCount} ` : ""}transactions
                </label>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={remove} disabled={busy !== null}>
                    {busy === "delete" ? <Spinner /> : null} Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      </div>
    </li>
  );
}
