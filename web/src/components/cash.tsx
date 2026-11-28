"use client";

// "Add cash spend": hand-typed transactions (sourceKind "manual", ROUTES.md
// POST /transactions). Mobile-first: amount first, big tap targets, one column
// on phones. Also edits/deletes an existing manual transaction.

import { Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addManualTransaction, deleteManualTransaction, errorMessage, listAccounts, listCategories, updateManualTransaction } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { CategoryKey, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { parseAmount } from "./app-ui";
import { ErrorText, Field, selectClass, Spinner } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Today in the browser's time zone, YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString("en-CA");

const AUTO = "";

export function CashSpendForm({ initial, onDone, onCancel, compact }: { initial?: Transaction; onDone: (t: Transaction) => void; onCancel?: () => void; compact?: boolean }) {
  const { me } = useSession();
  const cats = useAsync(listCategories, "categories");
  const accts = useAsync(listAccounts, "accounts");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [postedOn, setPostedOn] = useState(initial?.postedOn ?? localToday());
  const [category, setCategory] = useState<string>(initial?.category ?? AUTO);
  const [accountId, setAccountId] = useState<string>(initial?.accountId ?? "");
  const [direction, setDirection] = useState<"debit" | "credit">(initial?.direction ?? "debit");
  const [note, setNote] = useState(initial?.note ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashAcct = accts.data?.items.find((a) => a.kind === "cash");
  const otherAccts = (accts.data?.items ?? []).filter((a) => a.kind !== "cash");
  const categoryOptions = useMemo(() => cats.data?.items ?? [], [cats.data]);
  const value = parseAmount(amount);
  const sym = me.baseCurrency === "INR" ? "₹" : "$";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || value <= 0) return setError("Enter an amount.");
    if (!merchant.trim()) return setError("Add where you spent it.");
    setBusy(true);
    setError(null);
    const body = {
      postedOn,
      amount: value,
      merchant: merchant.trim(),
      direction,
      ...(category ? { category: category as CategoryKey } : {}),
      accountId: accountId || (cashAcct?.id ?? null),
      note: note.trim() || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      const t = initial ? await updateManualTransaction(initial.id, body) : await addManualTransaction(body);
      onDone(t);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2" role="radiogroup" aria-label="Money out or in">
        {(["debit", "credit"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => setDirection(d)}
            className={cn("h-9 flex-1 rounded-lg border text-sm", direction === d ? "border-amber-400/60 bg-amber-400/10 text-amber-200" : "border-white/10 text-zinc-400 hover:text-zinc-200")}
          >
            {d === "debit" ? "Spent" : "Received"}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3", compact ? "" : "sm:grid-cols-2")}>
        <Field label="Amount" htmlFor="cash-amount">
          <Input id="cash-amount" inputMode="decimal" autoFocus={!initial} placeholder={`${sym}0.00`} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg font-semibold" />
        </Field>
        <Field label="Where" htmlFor="cash-merchant">
          <Input id="cash-merchant" placeholder="e.g. Farmers market" value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={80} className="h-12" autoComplete="off" />
        </Field>
        <Field label="Date" htmlFor="cash-date">
          <Input id="cash-date" type="date" value={postedOn} max={localToday()} onChange={(e) => setPostedOn(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="cash-category" hint={category === AUTO ? "We'll pick one from the name. You can change it later." : undefined}>
          <select id="cash-category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value={AUTO}>Pick for me</option>
            {categoryOptions.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid from" htmlFor="cash-account">
          <select id="cash-account" className={selectClass} value={accountId || cashAcct?.id || ""} onChange={(e) => setAccountId(e.target.value)}>
            <option value={cashAcct?.id ?? ""}>Cash</option>
            {otherAccts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label || `${a.institutionName ?? "Account"}${a.last4 ? ` ••${a.last4}` : ""}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags (optional)" htmlFor="cash-tags">
          <Input id="cash-tags" placeholder="e.g. trip, gift" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor="cash-note" className={compact ? "" : "sm:col-span-2"}>
          <Input id="cash-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={busy} className="flex-1 sm:flex-none">
          {busy ? <Spinner /> : initial ? <Pencil /> : <Plus />} {initial ? "Save changes" : "Add cash spend"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {!initial ? (
        <p className="text-xs text-fg-muted">
          Already count ATM withdrawals as spending (Cash withdrawal)? Re-categorize them as Transfers so the same money isn&apos;t counted twice.
        </p>
      ) : null}
    </form>
  );
}

/** Detail-page controls for a manual transaction: edit in place or delete. */
export function ManualControls({ t, onChange, onDeleted }: { t: Transaction; onChange: (t: Transaction) => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (editing) return <CashSpendForm initial={t} onDone={(n) => (onChange(n), setEditing(false))} onCancel={() => setEditing(false)} />;
  return (
    <div className="space-y-2">
      <p className="text-sm text-fg-muted">You added this by hand, so you can change or remove it.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil /> Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Delete this transaction?")) return;
            setBusy(true);
            setError(null);
            try {
              await deleteManualTransaction(t.id);
              onDeleted();
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Trash2 />} Delete
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** "Added by hand" pill for transaction rows. */
export function CashPill({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-amber-200 uppercase", className)}
      title="Added by hand"
    >
      <Banknote className="size-3" aria-hidden /> Cash
    </span>
  );
}

/** Small link-card used on Overview/empty states. */
export function AddCashLink({ className }: { className?: string }) {
  return (
    <Link href="/transactions?add=cash" className={cn("inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline", className)}>
      <Banknote className="size-4" aria-hidden /> Add cash spend
    </Link>
  );
}
