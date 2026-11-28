"use client";

import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { delay, Eyebrow, INSIGHT_TABS, parseAmount, ProgressBar, SubTabs } from "@/components/app-ui";
import { EmptyState, ErrorText, Field, LoadError, PageHeader, Panel, Skeleton, Spinner } from "@/components/common";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addContribution, createGoal, deleteContribution, deleteGoal, errorMessage, listGoals, updateGoal } from "@/lib/api";
import { fmtDate, money, moneyExact } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import type { Goal, GoalStatus } from "@/lib/types";

const STATUS: Record<GoalStatus, { label: string; variant: BadgeVariant }> = {
  done: { label: "Reached", variant: "good" },
  on_track: { label: "On track", variant: "good" },
  behind: { label: "Behind", variant: "warn" },
  overdue: { label: "Past target date", variant: "bad" },
  no_date: { label: "No target date", variant: "muted" },
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Signed amount: "-50" = a withdrawal. */
function parseSigned(raw: string): number | null {
  const neg = raw.trim().startsWith("-");
  const n = parseAmount(raw);
  return n === null || n === 0 ? null : neg ? -n : n;
}

export default function GoalsPage() {
  const goals = useAsync(listGoals, "goals");
  const [creating, setCreating] = useState(false);
  const replace = (g: Goal) => goals.data && goals.setData({ ...goals.data, items: goals.data.items.map((x) => (x.id === g.id ? g : x)) });
  const items = goals.data?.items ?? [];
  const cur = goals.data?.currency ?? "USD";

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Savings goals"
        subtitle="Set a target, log what you put aside, and see how much a month gets you there."
        actions={
          items.length && !creating ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New goal
            </Button>
          ) : null
        }
      />
      <SubTabs label="Insights" items={INSIGHT_TABS} />
      {goals.error ? (
        <LoadError error={goals.error} onRetry={goals.reload} />
      ) : !goals.data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-4">
          {creating || items.length === 0 ? (
            items.length === 0 && !creating ? (
              <EmptyState
                icon={<PiggyBank />}
                title="No goals yet"
                body="An emergency fund, a trip, a new laptop: pick an amount and a date and we'll work out the monthly number."
                action={<Button onClick={() => setCreating(true)}>Create a goal</Button>}
              />
            ) : (
              <CreateGoal
                cur={cur}
                onCancel={() => setCreating(false)}
                onCreated={(g) => {
                  goals.setData({ ...goals.data!, items: [...items, g] });
                  setCreating(false);
                }}
              />
            )
          ) : null}
          {items.map((g, i) => (
            <GoalCard
              key={g.id}
              g={g}
              index={i}
              onChange={replace}
              onDeleted={() => goals.setData({ ...goals.data!, items: items.filter((x) => x.id !== g.id) })}
            />
          ))}
          {items.length ? <p className="text-xs text-fg-muted">Contributions are what you log here; SpendVault doesn&apos;t move money.</p> : null}
        </div>
      )}
    </>
  );
}

function CreateGoal({ cur, onCreated, onCancel }: { cur: string; onCreated: (g: Goal) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const act = useAction();
  return (
    <Panel className="spa-in">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const amount = parseAmount(target);
          if (!amount) return act.setError("Enter a target amount.");
          await act.run(async () => {
            const g = await createGoal({ name: name.trim(), targetAmount: amount, targetDate: date || null, startingAmount: parseAmount(start) ?? undefined });
            onCreated(g);
          }, errorMessage);
        }}
      >
        <p className="font-medium">New goal</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="goal-name">
            <Input id="goal-name" required maxLength={80} placeholder="Emergency fund" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={`Target (${cur})`} htmlFor="goal-target">
            <Input id="goal-target" inputMode="decimal" required placeholder="5,000" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Target date (optional)" htmlFor="goal-date">
            <Input id="goal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Already saved (optional)" htmlFor="goal-start">
            <Input id="goal-start" inputMode="decimal" placeholder="0" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
        </div>
        <ErrorText>{act.error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" disabled={act.busy || !name.trim()}>
            {act.busy ? <Spinner /> : null} Create goal
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function GoalCard({ g, index, onChange, onDeleted }: { g: Goal; index: number; onChange: (g: Goal) => void; onDeleted: () => void }) {
  const p = g.progress;
  const cur = g.currency;
  const st = STATUS[p.status];
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(localToday);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const act = useAction();

  return (
    <section className="spa-tile spa-in rounded-2xl p-4 sm:p-5" style={delay(Math.min(index, 6) * 0.05)}>
      {editing ? (
        <EditGoal g={g} onDone={(u) => { if (u) onChange(u); setEditing(false); }} onDeleted={onDeleted} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Eyebrow>{g.targetDate ? `By ${fmtDate(g.targetDate)}` : "Savings goal"}</Eyebrow>
              <h2 className="mt-1 break-words text-lg font-semibold">{g.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={st.variant}>{st.label}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </div>
          <p className="mt-2 text-sm">
            <span className="text-xl font-bold tabular">{money(p.saved, cur)}</span>
            <span className="text-fg-muted"> of {money(g.targetAmount, cur)}</span>
          </p>
          <div className="mt-2">
            <ProgressBar value={p.progress} status={p.status === "done" ? "ok" : p.status === "behind" || p.status === "overdue" ? "near" : "ok"} label={`${g.name} progress`} />
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            {p.status === "done"
              ? "Goal reached. Nice work."
              : p.monthlyNeeded != null && g.targetDate
                ? `Save ${money(p.monthlyNeeded, cur)} a month to hit it by ${fmtDate(g.targetDate)} (${p.monthsLeft} month${p.monthsLeft === 1 ? "" : "s"} left, ${money(p.remaining, cur)} to go).`
                : p.status === "overdue"
                  ? `${money(p.remaining, cur)} to go. The target date has passed; pick a new one in Edit.`
                  : `${money(p.remaining, cur)} to go. Add a target date to see the monthly amount.`}
            {p.recentMonthlyPace ? ` Lately you've been adding about ${money(p.recentMonthlyPace, cur)} a month.` : ""}
          </p>

          {(
            <form
              className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[8rem_10rem_minmax(0,1fr)_auto]"
              onSubmit={async (e) => {
                e.preventDefault();
                const n = parseSigned(amount);
                if (n === null) return act.setError("Enter an amount (use - for a withdrawal).");
                const ok = await act.run(async () => onChange(await addContribution(g.id, { amount: n, contributedOn: on || undefined, note: note.trim() || null })), errorMessage);
                if (ok) {
                  setAmount("");
                  setNote("");
                }
              }}
            >
              <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Input aria-label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              <Input aria-label="Note" className="col-span-2 sm:col-span-1" maxLength={120} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1" disabled={act.busy}>
                {act.busy ? <Spinner /> : <Plus />} Add
              </Button>
            </form>
          )}
          <div className="mt-2">
            <ErrorText>{act.error}</ErrorText>
          </div>
          {g.contributions.length ? (
            <div className="mt-2">
              <button type="button" className="text-xs text-accent-strong hover:underline" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Hide" : "Show"} history ({g.contributions.length})
              </button>
              {showHistory ? (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {g.contributions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="tabular">
                          <span className={c.amount < 0 ? "text-up" : "text-down"}>{c.amount > 0 ? "+" : ""}{moneyExact(c.amount, cur)}</span>
                          <span className="text-fg-muted"> · {fmtDate(c.contributedOn)}</span>
                        </p>
                        {c.note ? <p className="truncate text-xs text-fg-muted">{c.note}</p> : null}
                      </div>
                      <button
                        type="button"
                        aria-label="Delete contribution"
                        className="rounded-full p-1.5 text-fg-muted hover:bg-bg-subtle hover:text-fg"
                        onClick={() => act.run(async () => onChange(await deleteContribution(g.id, c.id)), errorMessage)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function EditGoal({ g, onDone, onDeleted }: { g: Goal; onDone: (g: Goal | null) => void; onDeleted: () => void }) {
  const [name, setName] = useState(g.name);
  const [target, setTarget] = useState(String(g.targetAmount));
  const [date, setDate] = useState(g.targetDate ?? "");
  const [confirm, setConfirm] = useState(false);
  const act = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const amount = parseAmount(target);
        if (!amount) return act.setError("Enter a target amount.");
        await act.run(async () => onDone(await updateGoal(g.id, { name: name.trim(), targetAmount: amount, targetDate: date || null })), errorMessage);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor={`n-${g.id}`}>
          <Input id={`n-${g.id}`} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Target" htmlFor={`t-${g.id}`}>
          <Input id={`t-${g.id}`} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Target date" htmlFor={`d-${g.id}`}>
          <Input id={`d-${g.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <ErrorText>{act.error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={act.busy || !name.trim()}>
          {act.busy ? <Spinner /> : null} Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        {confirm ? (
          <Button type="button" variant="destructive" onClick={() => act.run(async () => { await deleteGoal(g.id); onDeleted(); }, errorMessage)}>
            Delete goal and history
          </Button>
        ) : (
          <Button type="button" variant="ghost" className="ml-auto text-red-300" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </form>
  );
}
