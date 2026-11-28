"use client";

// Transaction tools shared by the transaction and receipt detail pages:
// tags (incl. tax tags), refund tracking ("I returned this"), split editor.

import { Plus, RotateCcw, Tag, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { ErrorText, Spinner, selectClass } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmount } from "@/components/app-ui";
import { clearSplits, closeRefund, deleteRefund, errorMessage, markReturned, setSplits } from "@/lib/api";
import { CATEGORY_KEYS, categoryColor, categoryLabel } from "@/lib/categories";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { TAX_TAGS, type CategoryKey, type RefundWatch, type SplitPart } from "@/lib/types";
import { cn } from "@/lib/utils";

const TAX_LABEL = new Map<string, string>(TAX_TAGS.map((t) => [t.tag, t.label]));

/** Same normalization as the API (lowercase, a-z0-9-_), so chips match what's saved. */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export function TagChip({ tag, onRemove, className }: { tag: string; onRemove?: () => void; className?: string }) {
  const tax = TAX_LABEL.get(tag);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium",
        tax ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/15 bg-white/5 text-zinc-300",
        className,
      )}
    >
      <span className="truncate">{tax ?? `#${tag}`}</span>
      {onRemove ? (
        <button type="button" aria-label={`Remove tag ${tag}`} onClick={onRemove} className="rounded-full hover:text-zinc-50">
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Tags editor: chips + add box + quick toggles for the three tax tags. `onSave` gets the full new list. */
export function TagEditor({ tags, onSave, compact }: { tags: string[]; onSave: (tags: string[]) => Promise<void>; compact?: boolean }) {
  const [draft, setDraft] = useState("");
  const act = useAction();
  const save = (next: string[]) => act.run(() => onSave(next), errorMessage);
  const add = () => {
    const t = normalizeTag(draft);
    if (!t) return;
    setDraft("");
    if (!tags.includes(t)) void save([...tags, t].slice(0, 10));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TAX_TAGS.map((t) => {
          const on = tags.includes(t.tag);
          return (
            <button
              key={t.tag}
              type="button"
              aria-pressed={on}
              disabled={act.busy}
              onClick={() => save(on ? tags.filter((x) => x !== t.tag) : [...tags, t.tag].slice(0, 10))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                on ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100" : "border-white/15 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {on ? "✓ " : ""}
              {t.label}
            </button>
          );
        })}
      </div>
      {!compact ? (
        <>
          {tags.filter((t) => !TAX_LABEL.has(t)).length ? (
            <div className="flex flex-wrap gap-1.5">
              {tags
                .filter((t) => !TAX_LABEL.has(t))
                .map((t) => (
                  <TagChip key={t} tag={t} onRemove={() => save(tags.filter((x) => x !== t))} />
                ))}
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Tag className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input aria-label="Add a tag" placeholder="Add a tag, e.g. vacation" className="pl-8" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" disabled={act.busy || !normalizeTag(draft)}>
              {act.busy ? <Spinner /> : <Plus />} Add
            </Button>
          </form>
        </>
      ) : null}
      <ErrorText>{act.error}</ErrorText>
    </div>
  );
}

const REFUND_STATUS: Record<RefundWatch["status"], { label: string; variant: "good" | "warn" | "bad" | "muted" }> = {
  waiting: { label: "Waiting for refund", variant: "warn" },
  overdue: { label: "No refund yet", variant: "bad" },
  refunded: { label: "Refunded", variant: "good" },
  closed: { label: "Stopped waiting", variant: "muted" },
};

/** "I returned this" + the refund's status. */
export function RefundBox({
  refund,
  target,
  onChange,
}: {
  refund: RefundWatch | null | undefined;
  target: { transactionId?: string; receiptId?: string };
  onChange: (r: RefundWatch | null) => void;
}) {
  const act = useAction();
  if (!refund) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">Sent it back? Mark it returned and we&apos;ll watch for the refund, and remind you if it hasn&apos;t shown up in 14 days.</p>
        <Button size="sm" variant="outline" disabled={act.busy} onClick={() => act.run(async () => onChange(await markReturned(target)), errorMessage)}>
          {act.busy ? <Spinner /> : <RotateCcw />} I returned this
        </Button>
        <ErrorText>{act.error}</ErrorText>
      </div>
    );
  }
  const s = REFUND_STATUS[refund.status];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="text-sm text-fg-muted">
          {moneyExact(refund.amount, refund.currency)} returned {fmtDate(refund.returnedOn)}
        </span>
      </div>
      {refund.status === "refunded" ? (
        <p className="text-sm text-down">
          {refund.refundAmount != null ? moneyExact(refund.refundAmount, refund.currency) : "Refund"} came back
          {refund.refundedOn ? ` on ${fmtDate(refund.refundedOn)}` : ""}.
        </p>
      ) : refund.status === "overdue" ? (
        <p className="text-sm text-fg-muted">It&apos;s been over 14 days. Check the return was received, then ask the merchant or your card issuer.</p>
      ) : refund.status === "waiting" ? (
        <p className="text-sm text-fg-muted">We&apos;ll match the credit from {refund.merchant} when it shows up on a statement or alert.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {refund.status === "waiting" || refund.status === "overdue" ? (
          <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => act.run(async () => onChange(await closeRefund(refund.id)), errorMessage)}>
            Stop waiting
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={act.busy}
          onClick={() =>
            act.run(async () => {
              await deleteRefund(refund.id);
              onChange(null);
            }, errorMessage)
          }
        >
          <Undo2 /> Undo
        </Button>
      </div>
      <ErrorText>{act.error}</ErrorText>
    </div>
  );
}

type Row = { category: CategoryKey; amount: string };

/** Split one charge across categories. Parts must add up to the amount. */
export function SplitEditor({
  transactionId,
  amount,
  currency,
  category,
  splits,
  onSaved,
}: {
  transactionId: string;
  amount: number;
  currency: string;
  category: CategoryKey;
  splits: SplitPart[];
  onSaved: (parts: SplitPart[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const act = useAction();

  const start = () => {
    setRows(
      splits.length
        ? splits.map((p) => ({ category: p.category, amount: String(p.amount) }))
        : [
            { category, amount: String(Math.round(amount * 50) / 100) },
            { category: category === "shopping" ? "groceries" : "shopping", amount: String(Math.round((amount - Math.round(amount * 50) / 100) * 100) / 100) },
          ],
    );
    act.setError(null);
    setEditing(true);
  };
  const sum = rows.reduce((s, r) => s + (parseAmount(r.amount) ?? 0), 0);
  const remaining = Math.round((amount - sum) * 100) / 100;

  if (!editing) {
    return (
      <div className="space-y-3">
        {splits.length ? (
          <ul className="space-y-1.5">
            {splits.map((p, i) => (
              <li key={`${p.category}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(p.category) }} aria-hidden />
                  <span className="truncate">{categoryLabel(p.category)}</span>
                </span>
                <span className="tabular">{moneyExact(p.amount, currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">One charge, several things? Split it across categories (say groceries and household) so your breakdown is right.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={start}>
            {splits.length ? "Edit split" : "Split this charge"}
          </Button>
          {splits.length ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={act.busy}
              onClick={() =>
                act.run(async () => {
                  await clearSplits(transactionId);
                  onSaved([]);
                }, errorMessage)
              }
            >
              <Trash2 /> Remove split
            </Button>
          ) : null}
        </div>
        <ErrorText>{act.error}</ErrorText>
      </div>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const parts = rows.map((r) => ({ category: r.category, amount: parseAmount(r.amount) ?? 0 }));
        void act.run(async () => {
          const res = await setSplits(transactionId, parts);
          onSaved(res.parts);
          setEditing(false);
        }, errorMessage);
      }}
    >
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            aria-label={`Category for part ${i + 1}`}
            className={`${selectClass} min-w-0 flex-1`}
            value={r.category}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value as CategoryKey } : x)))}
          >
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(k)}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Amount for part ${i + 1}`}
            inputMode="decimal"
            className="w-24 shrink-0 sm:w-28"
            value={r.amount}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
          />
          <button
            type="button"
            aria-label={`Remove part ${i + 1}`}
            disabled={rows.length <= 2}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="shrink-0 rounded-full p-1.5 text-fg-muted hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-accent-strong hover:underline disabled:opacity-40"
          disabled={rows.length >= 10}
          onClick={() => setRows([...rows, { category: "other", amount: remaining > 0 ? String(remaining) : "" }])}
        >
          <Plus className="size-3.5" /> Add part
        </button>
        <span className={cn("tabular", Math.abs(remaining) > 0.005 ? "text-amber-300" : "text-down")}>
          {Math.abs(remaining) > 0.005 ? `${moneyExact(remaining, currency)} left to assign` : "Adds up"}
        </span>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={act.busy || Math.abs(remaining) > 0.005}>
          {act.busy ? <Spinner /> : null} Save split
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      <ErrorText>{act.error}</ErrorText>
    </form>
  );
}
