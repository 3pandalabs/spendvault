"use client";

import { Gauge, Pencil, Plus, Sparkles, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { delay, Eyebrow, INSIGHT_TABS, InfoTip, parseAmount, ProgressBar, SubTabs } from "@/components/app-ui";
import { CategoryChip } from "@/components/bits";
import { EmptyState, ErrorText, LoadError, PageHeader, Panel, PanelTitle, selectClass, Skeleton, Spinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteBudget, errorMessage, getBudgets, listCategories, setBudget, setMonthlyBudget } from "@/lib/api";
import { fmtMonth, money } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { BudgetLine, Budgets } from "@/lib/types";

export default function BudgetsPage() {
  const budgets = useAsync(() => getBudgets(), "budgets");
  return (
    <>
      <PageHeader eyebrow="Insights" title="Budgets" subtitle="Set a monthly limit per category and see how this month is going." />
      <SubTabs label="Insights" items={INSIGHT_TABS} />
      {budgets.error ? (
        <LoadError error={budgets.error} onRetry={budgets.reload} />
      ) : !budgets.data ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <Body b={budgets.data} onChange={budgets.setData} />
      )}
    </>
  );
}

function Body({ b, onChange }: { b: Budgets; onChange: (b: Budgets) => void }) {
  const cur = b.currency;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const over = b.items.filter((l) => l.status === "over").length;

  async function act(key: string, fn: () => Promise<Budgets | void>) {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      if (next) onChange(next);
      else onChange(await getBudgets());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const overall = b.monthlyBudget;
  const overallProgress = overall ? b.totals.spent / overall : 0;
  return (
    <div className="space-y-4">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <Eyebrow>{fmtMonth(b.month)}</Eyebrow>
          <InfoTip label="How budgets work">
            Spending counts the same way as on Overview: card and bank charges in each category this month, with refunds netted off. Payments to your
            card, transfers and income never count. You get an alert when a category goes over.
          </InfoTip>
        </div>
        <p className="spa-display mt-2 text-3xl font-extrabold tabular sm:text-4xl">
          {money(b.totals.spent, cur)}
          <span className="text-base font-normal text-zinc-400">
            {" "}
            spent{overall ? ` of ${money(overall, cur)}` : b.totals.budgeted ? ` · ${money(b.totals.budgeted, cur)} budgeted` : ""}
          </span>
        </p>
        {overall ? (
          <div className="mt-3 max-w-md">
            <ProgressBar value={overallProgress} status={b.totals.spent > overall ? "over" : overallProgress >= 0.8 ? "near" : "ok"} label="Monthly budget used" />
          </div>
        ) : null}
        <p className="mt-2 text-sm text-fg-muted">
          {b.items.length === 0
            ? "No category budgets yet."
            : over
              ? `${over} categor${over === 1 ? "y is" : "ies are"} over budget.`
              : "Every budgeted category is on track."}
        </p>
        <MonthlyBudget value={overall} currency={cur} busy={busy === "total"} onSave={(v) => act("total", () => setMonthlyBudget(v))} />
      </section>

      <ErrorText>{error}</ErrorText>

      {b.items.length > 0 ? (
        <Panel className="spa-in" style={delay(0.05)}>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <Gauge className="size-4" aria-hidden /> Category budgets
            </span>
          </PanelTitle>
          <ul className="divide-y divide-line">
            {b.items.map((l) => (
              <BudgetRow
                key={l.category}
                line={l}
                currency={cur}
                busy={busy === l.category}
                onSave={(v) => act(l.category, () => setBudget(l.category, v))}
                onDelete={() => act(l.category, () => deleteBudget(l.category))}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {b.suggestions.length > 0 ? (
        <Panel className="spa-in" style={delay(0.1)}>
          <PanelTitle
            aside={
              b.suggestions.length > 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    act("all", async () => {
                      let last: Budgets | undefined;
                      for (const s of b.suggestions) last = await setBudget(s.category, s.suggested);
                      return last;
                    })
                  }
                >
                  {busy === "all" ? <Spinner /> : <Sparkles />} Use all
                </Button>
              ) : null
            }
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles className="size-4 text-amber-300" aria-hidden /> Suggested starting budgets
            </span>
          </PanelTitle>
          <p className="mb-2 text-sm text-fg-muted">From your average over the last 3 months, rounded up. Tweak them once they&apos;re set.</p>
          <ul className="divide-y divide-line">
            {b.suggestions.map((s) => (
              <li key={s.category} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <CategoryChip category={s.category} />
                  <p className="text-xs text-fg-muted">avg {money(s.average, cur)} / month</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(s.category, () => setBudget(s.category, s.suggested))}>
                  {busy === s.category ? <Spinner /> : <Plus />} {money(s.suggested, cur)}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <AddBudget currency={cur} existing={b.items.map((l) => l.category)} busy={busy === "add"} onAdd={(cat, v) => act("add", () => setBudget(cat, v))} />

      {b.items.length === 0 && b.suggestions.length === 0 ? (
        <EmptyState icon={<Wallet />} title="Set your first budget" body="Pick a category above and give it a monthly limit. Suggestions appear once you have a month or two of statements." />
      ) : null}
    </div>
  );
}

function MonthlyBudget({ value, currency, busy, onSave }: { value: number | null; currency: string; busy: boolean; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value ? String(value) : "");
  if (!editing) {
    return (
      <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5" aria-hidden /> {value ? "Change monthly budget" : "Set an overall monthly budget"}
      </button>
    );
  }
  return (
    <form
      className="mt-3 flex max-w-sm flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(parseAmount(raw));
        setEditing(false);
      }}
    >
      <Input inputMode="decimal" aria-label="Monthly budget" placeholder={currency === "INR" ? "₹50,000" : "$3,000"} value={raw} onChange={(e) => setRaw(e.target.value)} className="w-36" />
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? <Spinner /> : null} Save
      </Button>
      {value ? (
        <Button size="sm" variant="ghost" type="button" onClick={() => (onSave(null), setEditing(false))}>
          Clear
        </Button>
      ) : null}
      <p className="w-full text-xs text-fg-muted">Used for &ldquo;Safe to spend&rdquo; on Overview. Leave empty to use your category budgets or income.</p>
    </form>
  );
}

function BudgetRow({ line: l, currency, busy, onSave, onDelete }: { line: BudgetLine; currency: string; busy: boolean; onSave: (v: number) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(l.budget));
  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CategoryChip category={l.category} className="font-medium" />
          {l.status === "over" ? <Badge variant="bad">Over</Badge> : l.status === "near" ? <Badge variant="warn">Near</Badge> : null}
        </div>
        <span className="shrink-0 text-sm tabular">
          <span className="font-semibold">{money(l.spent, currency)}</span>
          <span className="text-fg-muted"> / {money(l.budget, currency)}</span>
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={l.progress} status={l.status} label={`${l.label} budget used`} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={l.remaining < 0 ? "text-red-300" : "text-fg-muted"}>
          {l.remaining < 0 ? `${money(-l.remaining, currency)} over` : `${money(l.remaining, currency)} left`}
        </span>
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = parseAmount(raw);
              if (v !== null) onSave(v);
              setEditing(false);
            }}
          >
            <Input inputMode="decimal" aria-label={`${l.label} budget`} value={raw} onChange={(e) => setRaw(e.target.value)} className="h-8 w-28" />
            <Button size="sm" type="submit" disabled={busy}>
              Save
            </Button>
          </form>
        ) : (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy} aria-label={`Edit ${l.label} budget`}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy} aria-label={`Remove ${l.label} budget`}>
              {busy ? <Spinner /> : <Trash2 />}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

function AddBudget({ currency, existing, busy, onAdd }: { currency: string; existing: string[]; busy: boolean; onAdd: (category: string, amount: number) => void }) {
  const cats = useAsync(listCategories, "categories");
  const options = useMemo(() => (cats.data?.items ?? []).filter((c) => c.spend && !existing.includes(c.key)), [cats.data, existing]);
  const [cat, setCat] = useState("");
  const [raw, setRaw] = useState("");
  const chosen = cat || options[0]?.key || "";
  if (!options.length) return null;
  return (
    <Panel>
      <PanelTitle>Add a budget</PanelTitle>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseAmount(raw);
          if (!chosen || v === null) return;
          onAdd(chosen, v);
          setRaw("");
          setCat("");
        }}
      >
        <select aria-label="Category" className={`${selectClass} min-w-0 flex-1 sm:max-w-56`} value={chosen} onChange={(e) => setCat(e.target.value)}>
          {options.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <Input inputMode="decimal" aria-label="Monthly amount" placeholder={currency === "INR" ? "₹5,000" : "$200"} value={raw} onChange={(e) => setRaw(e.target.value)} className="w-28" />
        <Button type="submit" disabled={busy || parseAmount(raw) === null}>
          {busy ? <Spinner /> : <Plus />} Add
        </Button>
      </form>
    </Panel>
  );
}
