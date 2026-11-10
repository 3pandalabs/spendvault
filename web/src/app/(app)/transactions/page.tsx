"use client";

import { ListOrdered, Lock, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryChip } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, Loading, PageHeader, Spinner, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, listAccounts, listTransactions, updateTransaction } from "@/lib/api";
import { CATEGORY_KEYS, categoryColor, categoryLabel } from "@/lib/categories";
import { fmtDate, fmtMonth, moneyExact, monthRange } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Account, CategoryKey, Direction, Transaction, TransactionFilter } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE = 100;

export default function TransactionsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Transactions />
    </Suspense>
  );
}

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

function Transactions() {
  const params = useSearchParams();
  const router = useRouter();
  const filter: TransactionFilter = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    category: params.get("category") ?? undefined,
    accountId: params.get("accountId") ?? undefined,
    q: params.get("q") ?? undefined,
    direction: (params.get("direction") as Direction | null) ?? undefined,
  };
  const filterKey = params.toString();

  const setFilter = (patch: Partial<Record<keyof TransactionFilter, string | undefined>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/transactions${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const accounts = useAsync(listAccounts, "accounts");
  const first = useAsync(() => listTransactions({ ...filter, limit: PAGE }), `txns:${filterKey}`);
  const [more, setMore] = useState<{ key: string; items: Transaction[]; cursor: string | null } | null>(null);
  const [edited, setEdited] = useState<Record<string, Transaction>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const extra = more?.key === filterKey ? more : null;
  const items = [...(first.data?.items ?? []), ...(extra?.items ?? [])].map((t) => edited[t.id] ?? t);
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listTransactions({ ...filter, limit: PAGE, cursor });
      setMore({ key: filterKey, items: [...(extra?.items ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const accountById = new Map((accounts.data?.items ?? []).map((a) => [a.id, a]));
  const monthValue = (() => {
    if (!filter.from || !filter.to) return "";
    const ym = filter.from.slice(0, 7);
    const r = monthRange(ym);
    return r.from === filter.from && r.to === filter.to ? ym : "custom";
  })();
  const hasFilters = Boolean(filterKey);

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every line from your statements and alerts. Fix a category and we'll remember it." />

      {/* Filters */}
      <div className="mb-4 space-y-3 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-3 sm:p-4">
        <SearchBox initial={filter.q ?? ""} onSearch={(q) => setFilter({ q: q || undefined })} key={filter.q ?? ""} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select
            aria-label="Month"
            className={selectClass}
            value={monthValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) setFilter({ from: undefined, to: undefined });
              else if (v !== "custom") setFilter(monthRange(v));
            }}
          >
            <option value="">Any time</option>
            {monthValue === "custom" ? <option value="custom">Custom dates</option> : null}
            {lastMonths(13).map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
          <select
            aria-label="Category"
            className={selectClass}
            value={filter.category ?? ""}
            onChange={(e) => setFilter({ category: e.target.value || undefined })}
          >
            <option value="">All categories</option>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(k)}
              </option>
            ))}
          </select>
          <select
            aria-label="Account"
            className={selectClass}
            value={filter.accountId ?? ""}
            onChange={(e) => setFilter({ accountId: e.target.value || undefined })}
          >
            <option value="">All accounts</option>
            {(accounts.data?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {accountName(a)}
              </option>
            ))}
          </select>
          <select
            aria-label="Direction"
            className={selectClass}
            value={filter.direction ?? ""}
            onChange={(e) => setFilter({ direction: e.target.value || undefined })}
          >
            <option value="">Money in and out</option>
            <option value="debit">Money out</option>
            <option value="credit">Money in</option>
          </select>
        </div>
        <details className="text-sm" open={monthValue === "custom"}>
          <summary className="cursor-pointer text-fg-muted">Custom date range</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">
            <label className="text-xs text-fg-muted">
              From
              <Input type="date" value={filter.from ?? ""} onChange={(e) => setFilter({ from: e.target.value || undefined })} />
            </label>
            <label className="text-xs text-fg-muted">
              To
              <Input type="date" value={filter.to ?? ""} onChange={(e) => setFilter({ to: e.target.value || undefined })} />
            </label>
          </div>
        </details>
        {hasFilters ? (
          <button className="inline-flex items-center gap-1 text-sm text-accent-strong hover:underline" onClick={() => router.replace("/transactions")}>
            <X className="size-3.5" /> Clear filters
          </button>
        ) : null}
      </div>

      {first.error ? (
        <LoadError error={first.error} onRetry={first.reload} />
      ) : first.loading && !first.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListOrdered />}
          title={hasFilters ? "No transactions match" : "No transactions yet"}
          body={hasFilters ? "Try a wider date range or clear the filters." : "Once a statement is read, its transactions show up here."}
          action={
            hasFilters ? (
              <Button variant="outline" onClick={() => router.replace("/transactions")}>
                Clear filters
              </Button>
            ) : (
              <Link href="/setup">
                <Button>Set up statements</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className={cn("overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm", first.loading && "opacity-60")}>
            <div className="hidden grid-cols-[7rem_minmax(0,1fr)_14rem_8rem] gap-3 border-b border-line bg-bg-subtle px-4 py-2 text-xs font-medium text-fg-muted md:grid">
              <span>Date</span>
              <span>Merchant</span>
              <span>Category</span>
              <span className="text-right">Amount</span>
            </div>
            <ul className="divide-y divide-line">
              {items.map((t) => (
                <TxnRow
                  key={t.id}
                  t={t}
                  account={t.accountId ? accountById.get(t.accountId) : undefined}
                  onSaved={(u, all) => {
                    if (all) {
                      setEdited({});
                      setMore(null);
                      first.reload();
                    } else setEdited((e) => ({ ...e, [u.id]: u }));
                  }}
                />
              ))}
            </ul>
          </div>
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-fg-muted">
              Showing {items.length.toLocaleString("en-IN")} transaction{items.length === 1 ? "" : "s"}
            </p>
            {cursor ? (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Spinner /> : null} Load more
              </Button>
            ) : null}
            <ErrorText>{moreError}</ErrorText>
          </div>
        </>
      )}
    </>
  );
}

function accountName(a: Account) {
  return a.label || `${a.institutionName}${a.last4 ? ` ··${a.last4}` : ""}`;
}

function SearchBox({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim());
      }}
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input
          type="search"
          aria-label="Search merchant or description"
          placeholder="Search merchant or description"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}

function TxnRow({
  t,
  account,
  onSaved,
}: {
  t: Transaction;
  account?: Account;
  onSaved: (t: Transaction, appliedToMerchant: boolean) => void;
}) {
  const [pending, setPending] = useState<CategoryKey | null>(null);
  const [applyAll, setApplyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const u = await updateTransaction(t.id, { category: pending, applyToMerchant: applyAll });
      setPending(null);
      onSaved(u, applyAll);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const credit = t.direction === "credit";
  return (
    <li className="px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[7rem_minmax(0,1fr)_14rem_8rem] md:items-center">
        <span className="order-3 text-xs text-fg-muted md:order-none md:text-sm md:text-fg">{fmtDate(t.postedOn)}</span>
        <div className="order-1 min-w-0 md:order-none">
          <p className="truncate text-sm font-medium" title={t.descriptionRaw}>
            {t.merchant}
          </p>
          <p className="truncate text-xs text-fg-muted" title={t.descriptionRaw}>
            {account ? `${accountName(account)} · ` : ""}
            {t.descriptionRaw}
          </p>
        </div>
        <div className="order-4 col-span-2 flex min-w-0 items-center gap-2 md:order-none md:col-span-1">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(pending ?? t.category) }} aria-hidden />
          <select
            aria-label={`Category for ${t.merchant}`}
            className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm hover:border-line-strong focus-visible:border-line-strong focus-visible:outline-none"
            value={pending ?? t.category}
            onChange={(e) => {
              const v = e.target.value as CategoryKey;
              setPending(v === t.category ? null : v);
              setError(null);
            }}
          >
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(k)}
              </option>
            ))}
          </select>
          {t.categoryLocked && !pending ? (
            <span title="You set this category">
              <Lock className="size-3.5 text-fg-muted" aria-label="You set this category" />
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            "order-2 text-right text-sm font-medium tabular md:order-none",
            credit ? "text-down" : "text-fg",
          )}
        >
          {credit ? "+" : ""}
          {moneyExact(t.amount, t.currency)}
        </span>
      </div>
      {pending ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft p-2.5 text-sm">
          <span>
            Change to <CategoryChip category={pending} className="font-medium" />
          </span>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-accent" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            Apply to all {t.merchant}
          </label>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Spinner /> : null} Save
            </Button>
          </div>
          {error ? <p className="w-full text-sm text-red-300">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
