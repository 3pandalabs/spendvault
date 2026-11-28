"use client";

import { CheckCircle2, Download, FileText, KeyRound, Mail, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SOURCE_META } from "@/components/bits";
import { delay, Eyebrow } from "@/components/app-ui";
import { CopyButton, EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner } from "@/components/common";
import { UploadZone } from "@/components/UploadZone";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteDocument, errorMessage, listDocuments, retryDocument } from "@/lib/api";
import { fmtBytes, fmtDate, fmtTimestamp, money } from "@/lib/format";
import { useAsync, usePoll } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Document, DocumentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "all" | "statements" | "receipts" | "attention";
const VIEWS: Array<{ key: View; label: string; test: (d: Document) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "statements", label: "Statements & alerts", test: (d) => d.kind !== "receipt" },
  { key: "receipts", label: "Receipts", test: (d) => d.kind === "receipt" },
  { key: "attention", label: "Needs you", test: (d) => needsAttention(d) },
];

/**
 * A bank "your statement is ready" email that carried no PDF/CSV: the API
 * reads the body, finds no transactions and marks it ignored. All we can do
 * is say where to get the file.
 */
const isNoFileEmail = (d: Document) =>
  d.status === "ignored" && d.source === "email" && d.kind !== "receipt" && (d.mimeType.startsWith("text/") || d.mimeType === "message/rfc822");
const needsAttention = (d: Document) => ["needs_password", "failed", "pending_extraction"].includes(d.status) || isNoFileEmail(d);

const STATUS: Record<DocumentStatus, [string, BadgeVariant]> = {
  received: ["Received", "info"],
  processing: ["Reading…", "info"],
  parsed: ["Done", "good"],
  needs_password: ["Needs password", "warn"],
  failed: ["Couldn't read", "bad"],
  ignored: ["Skipped", "muted"],
  pending_extraction: ["Needs total", "warn"],
};

const busyStatus = (s: DocumentStatus) => s === "received" || s === "processing";

export default function DocumentsPage() {
  const { me } = useSession();
  const [view, setView] = useState<View>("all");
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
  const shown = items.filter(VIEWS.find((v) => v.key === view)!.test);
  const attention = items.filter(needsAttention).length;
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
        eyebrow="Inbox"
        title="Everything you've sent us"
        subtitle="Statements, purchase alerts and receipts from Gmail forwarding, uploads, your phone's Share button and WhatsApp, and where each one is."
        actions={
          <Link href="/setup">
            <Button variant="outline">Set up forwarding</Button>
          </Link>
        }
      />
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <UploadZone
          onUploaded={(docs) => {
            setPatched((p) => ({ ...p, ...Object.fromEntries(docs.map((d) => [d.id, d])) }));
            first.reload();
          }}
        />
        <div className="spa-tile rounded-2xl p-4">
          <Eyebrow className="flex items-center gap-1.5">
            <Mail className="size-3.5" /> Your private address
          </Eyebrow>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-zinc-950/60 px-2.5 py-1.5 text-xs break-all">{me.forwardingAddress}</code>
            <CopyButton value={me.forwardingAddress} />
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Forward statements, purchase alerts and e-receipts here.{" "}
            {me.setup.forwardingConfirmed ? (
              "Gmail forwarding is on."
            ) : (
              <Link href="/setup" className="text-accent-strong hover:underline">
                Set up a Gmail filter
              </Link>
            )}
          </p>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-fg-muted">
            <Download className="mt-0.5 size-3.5 shrink-0" />
            No statement email? Most banks let you download a CSV of recent activity from their website. Upload it here.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            Received {anyBusy ? <Spinner className="text-fg-muted" /> : null}
          </h2>
          <div role="tablist" aria-label="Filter the inbox" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap",
                  view === v.key ? "bg-white/10 font-medium text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {v.label}
                {v.key === "attention" && attention ? (
                  <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-zinc-950 tabular">{attention}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        {first.error ? (
          <LoadError error={first.error} onRetry={first.reload} />
        ) : !first.data ? (
          <Loading />
        ) : shown.length === 0 && items.length > 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="Nothing in this view" body={cursor ? "Load older items to look further back." : "Everything else is in the other tabs."} />
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
              {shown.map((d, i) => (
                <DocRow key={d.id} d={d} index={i} onChange={(u) => setPatched((p) => ({ ...p, [d.id]: u }))} />
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

function DocRow({ d, index, onChange }: { d: Document; index: number; onChange: (d: Document | null) => void }) {
  const { me } = useSession();
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
    <li className="spa-tile spa-in rounded-2xl p-4" style={delay(Math.min(index, 10) * 0.03)}>
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
              d.kind === "alert" ? "Purchase alert" : d.kind === "statement" ? "Statement" : d.kind === "receipt" ? "Receipt" : null,
              period,
              d.source === "email" && d.emailFrom ? `from ${d.emailFrom}` : null,
              fmtBytes(d.sizeBytes),
              fmtTimestamp(d.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {d.kind === "receipt" ? (
            <p className="mt-1 text-sm">
              <Link href="/receipts" className="text-accent-strong hover:underline">
                {d.status === "pending_extraction" ? "Saved. Enter the total in Receipts" : "Open in Receipts"}
              </Link>
            </p>
          ) : d.status === "parsed" ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                {d.txnCount} transaction{d.txnCount === 1 ? "" : "s"}
              </span>
              {d.statementTotal != null ? <span className="text-fg-muted">Statement total {money(d.statementTotal, me.baseCurrency)}</span> : null}
              {d.reconciled ? (
                <span className="inline-flex items-center gap-1 text-down">
                  <CheckCircle2 className="size-3.5" /> Totals match
                </span>
              ) : d.reconciled === false ? (
                <span className="text-amber-300" title="The transactions we read don't add up to the statement total. Some lines may be missing.">
                  Totals don&apos;t match
                </span>
              ) : null}
            </p>
          ) : null}
          {isNoFileEmail(d) ? (
            <div className="mt-2 rounded-xl border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-sky-100">
              <p className="font-medium">This email had no statement file attached.</p>
              <p className="mt-0.5 text-sky-100/80">
                Many banks (Chase, Amex, Capital One, Citi, Bank of America and others) only email &ldquo;your statement is ready&rdquo;. Sign in to
                your bank, download the statement PDF or a CSV of the activity, and upload it above. Purchase alerts keep you current between
                statements:{" "}
                <Link href="/setup#alerts" className="font-medium text-sky-200 underline">
                  set them up
                </Link>
                .
              </p>
            </div>
          ) : d.error && (d.status === "failed" || d.status === "ignored") ? (
            <p className="mt-1 text-sm text-fg-muted">{d.error}</p>
          ) : null}

          {d.status === "needs_password" ? (
            <form
              className="mt-3 space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password) retry(true);
              }}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
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
              <label className="flex items-center gap-2 text-sm text-amber-200">
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
              <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm">
                <span className="font-medium text-red-200">Delete this document?</span>
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
