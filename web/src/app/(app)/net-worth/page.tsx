"use client";

import { Building2, CreditCard, Landmark, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { delay, Eyebrow, InfoTip, parseAmount } from "@/components/app-ui";
import { ErrorText, LoadError, PageHeader, Panel, PanelTitle, selectClass, Skeleton, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addNetWorthItem, deleteNetWorthItem, errorMessage, getNetWorth, setAccountInNetWorth, updateNetWorthItem } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { NetWorth, NetWorthItem, NetWorthItemType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES: Array<{ key: NetWorthItemType; label: string; kind: "asset" | "liability" }> = [
  { key: "cash", label: "Cash & savings", kind: "asset" },
  { key: "investment", label: "Investments", kind: "asset" },
  { key: "retirement", label: "Retirement (401k, IRA, PF)", kind: "asset" },
  { key: "property", label: "Home & property", kind: "asset" },
  { key: "vehicle", label: "Vehicle", kind: "asset" },
  { key: "other", label: "Other asset", kind: "asset" },
  { key: "mortgage", label: "Mortgage", kind: "liability" },
  { key: "loan", label: "Loan (car, student, personal)", kind: "liability" },
  { key: "credit_card", label: "Card not in SpendVault", kind: "liability" },
];
const typeLabel = (t: string) => TYPES.find((x) => x.key === t)?.label ?? t;

export default function NetWorthPage() {
  const nw = useAsync(getNetWorth, "net-worth");
  return (
    <>
      <PageHeader eyebrow="More" title="Net worth" subtitle="What you own minus what you owe, from your statements plus anything you add." />
      {nw.error ? (
        <LoadError error={nw.error} onRetry={nw.reload} />
      ) : !nw.data ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : (
        <Body n={nw.data} reload={nw.reload} />
      )}
    </>
  );
}

function Body({ n, reload }: { n: NetWorth; reload: () => void }) {
  const cur = n.currency;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const assets = n.items.filter((i) => i.kind === "asset");
  const liabilities = n.items.filter((i) => i.kind === "liability");
  const statementAccounts = n.accounts.filter((a) => a.side !== null);
  return (
    <div className="space-y-4">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <Eyebrow>Net worth</Eyebrow>
          <InfoTip label="How net worth is worked out">
            Assets (bank balances + what you add) minus liabilities (card balances + loans you add). Bank and card balances come from the closing
            balance on each account&apos;s latest statement, so they&apos;re as fresh as that statement. Only {cur} accounts count.
          </InfoTip>
        </div>
        <p className={cn("spa-display mt-2 text-4xl font-extrabold tabular sm:text-5xl", n.netWorth < 0 && "text-red-300")}>
          {n.netWorth >= 0 ? <span className="spa-shimmer">{money(n.netWorth, cur)}</span> : money(n.netWorth, cur)}
        </p>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
            <p className="text-xs text-fg-muted">Assets</p>
            <p className="font-semibold text-down tabular">{money(n.assets, cur)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
            <p className="text-xs text-fg-muted">Liabilities</p>
            <p className="font-semibold text-red-300 tabular">{money(n.liabilities, cur)}</p>
          </div>
        </div>
        {n.asOf ? <p className="mt-2 text-xs text-fg-muted">Statement balances as of {fmtDate(n.asOf)} or later.</p> : null}
      </section>

      <ErrorText>{error}</ErrorText>

      <Panel className="spa-in" style={delay(0.05)}>
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <Landmark className="size-4" aria-hidden /> From your statements
          </span>
        </PanelTitle>
        {statementAccounts.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No card or bank accounts yet.{" "}
            <Link href="/documents" className="text-accent-strong hover:underline">
              Add a statement
            </Link>{" "}
            and its closing balance shows up here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {statementAccounts.map((a) => {
              const Icon = a.kind === "credit_card" ? CreditCard : Building2;
              return (
                <li key={a.accountId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    <div className="min-w-0">
                      <p className={cn("truncate text-sm font-medium", !a.counted && "text-fg-muted")}>{a.label}</p>
                      <p className="text-xs text-fg-muted">
                        {a.balance == null
                          ? "No closing balance read yet"
                          : a.currency !== cur
                            ? `${a.currency} account, not counted`
                            : `${a.side === "liability" ? "Owed" : "Balance"} · ${a.asOf ? fmtDate(a.asOf) : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={cn("text-sm font-semibold tabular", a.side === "liability" ? "text-red-300" : "text-down", !a.counted && "opacity-50")}>
                      {a.balance == null ? "—" : `${a.side === "liability" ? "−" : ""}${money(a.balance, a.currency)}`}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.includeInNetWorth}
                      aria-label={`Count ${a.label} in net worth`}
                      title={a.includeInNetWorth ? "Counted in net worth" : "Not counted"}
                      disabled={busy === a.accountId}
                      onClick={() => act(a.accountId, () => setAccountInNetWorth(a.accountId, !a.includeInNetWorth))}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                        a.includeInNetWorth ? "bg-amber-400" : "bg-white/15",
                      )}
                    >
                      <span className={cn("inline-block size-4 rounded-full transition-transform", a.includeInNetWorth ? "translate-x-4 bg-zinc-950" : "translate-x-0.5 bg-zinc-300")} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <ItemsPanel title="Assets you add" items={assets} currency={cur} busy={busy} act={act} />
        <ItemsPanel title="Debts you add" items={liabilities} currency={cur} busy={busy} act={act} />
      </div>

      <AddItem currency={cur} busy={busy === "add"} onAdd={(b) => act("add", () => addNetWorthItem(b))} />
    </div>
  );
}

function ItemsPanel({
  title,
  items,
  currency,
  busy,
  act,
}: {
  title: string;
  items: NetWorthItem[];
  currency: string;
  busy: string | null;
  act: (key: string, fn: () => Promise<unknown>) => void;
}) {
  return (
    <Panel>
      <PanelTitle>{title}</PanelTitle>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing added yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} currency={currency} busy={busy === i.id} act={act} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ItemRow({ item: i, currency, busy, act }: { item: NetWorthItem; currency: string; busy: boolean; act: (key: string, fn: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(i.amount));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{i.name}</p>
        <p className="text-xs text-fg-muted">
          {typeLabel(i.type)} · updated {fmtDate(i.updatedAt.slice(0, 10))}
        </p>
      </div>
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = parseAmount(raw);
            if (v !== null) act(i.id, () => updateNetWorthItem(i.id, { amount: v }));
            setEditing(false);
          }}
        >
          <Input inputMode="decimal" aria-label={`${i.name} amount`} value={raw} onChange={(e) => setRaw(e.target.value)} className="h-8 w-28" />
          <Button size="sm" type="submit">
            Save
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <button type="button" className="text-sm font-semibold tabular hover:underline" onClick={() => setEditing(true)} title="Update the amount">
            {money(i.amount, currency)}
          </button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${i.name}`} disabled={busy} onClick={() => act(i.id, () => deleteNetWorthItem(i.id))}>
            {busy ? <Spinner /> : <Trash2 />}
          </Button>
        </div>
      )}
    </li>
  );
}

function AddItem({ currency, busy, onAdd }: { currency: string; busy: boolean; onAdd: (b: Omit<NetWorthItem, "id" | "updatedAt">) => void }) {
  const [type, setType] = useState<NetWorthItemType>("investment");
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const t = TYPES.find((x) => x.key === type)!;
  const amount = parseAmount(raw);
  return (
    <Panel>
      <PanelTitle>Add an asset or debt</PanelTitle>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || amount === null) return;
          onAdd({ kind: t.kind, type, name: name.trim(), amount });
          setName("");
          setRaw("");
        }}
      >
        <select aria-label="Type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as NetWorthItemType)}>
          <optgroup label="Assets">
            {TYPES.filter((x) => x.kind === "asset").map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Debts">
            {TYPES.filter((x) => x.kind === "liability").map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </optgroup>
        </select>
        <Input aria-label="Name" placeholder={t.kind === "asset" ? "e.g. Vanguard brokerage" : "e.g. Car loan"} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Input inputMode="decimal" aria-label="Amount" placeholder={currency === "INR" ? "₹5,00,000" : "$12,000"} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <Button type="submit" disabled={busy || !name.trim() || amount === null}>
          {busy ? <Spinner /> : <Plus />} Add
        </Button>
      </form>
      <p className="mt-2 text-xs text-fg-muted">Amounts you type are stored as you enter them. Update them whenever you like; nothing is linked to your bank.</p>
    </Panel>
  );
}
