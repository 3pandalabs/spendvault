"use client";

// Money calculators: the public /calculators page and the signed-in
// /my-calculators page (pre-filled from your own data). All math is in
// lib/calc.ts and runs in the browser; nothing is sent anywhere unless you
// press "Save these numbers" while signed in.

import { Calculator, CreditCard, Flame, Landmark, PiggyBank, Plus, RotateCcw, Save, ShieldCheck, Target, Trash2, TrendingUp, Umbrella } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { comparePayoff, extraPaymentSavings, fire, inflation, monthsUntil, retirement, savingsGoal, sip, emergencyFund } from "@/lib/calc";
import { fmtCount, money, moneyExact } from "@/lib/format";
import type { CalculatorKey, CalculatorPrefill, ScenarioInputs } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorText, Field, Panel, PanelTitle, Spinner } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Cur = "USD" | "INR";

export const CALCULATOR_LIST: Array<{ key: CalculatorKey; label: string; icon: typeof Flame; blurb: string }> = [
  { key: "fire", label: "FIRE", icon: Flame, blurb: "How much you need to stop working, and how long it takes." },
  { key: "compound", label: "Compound / SIP", icon: TrendingUp, blurb: "What monthly investing grows to, with an optional yearly step-up." },
  { key: "loan", label: "Loan / EMI", icon: Landmark, blurb: "Monthly payment, full schedule and what extra payments save." },
  { key: "card_payoff", label: "Card payoff", icon: CreditCard, blurb: "Avalanche vs snowball: which pays off your cards sooner and cheaper." },
  { key: "emergency", label: "Emergency fund", icon: Umbrella, blurb: "How many months of essentials you have saved, and how far to go." },
  { key: "retirement", label: "Retirement", icon: ShieldCheck, blurb: "The pot you need at retirement once prices rise, and what to invest monthly." },
  { key: "inflation", label: "Inflation", icon: Calculator, blurb: "What something costs later, and what today's money will be worth." },
  { key: "savings_goal", label: "Savings goal", icon: Target, blurb: "How much to put away each month to hit a goal by a date." },
];

// ---------------------------------------------------------------- inputs

type Vals = Record<string, number | string>;
type CardRow = { name: string; balance: number; apr: number; minPayment: number };

const num = (v: number | string | undefined, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

function NumField({ id, label, value, onChange, prefix, suffix, hint, step }: { id: string; label: string; value: number | string; onChange: (v: string) => void; prefix?: string; suffix?: string; hint?: string; step?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-zinc-500">{prefix}</span> : null}
        <Input id={id} inputMode="decimal" type="text" step={step} value={value} onChange={(e) => onChange(e.target.value)} className={cn(prefix && "pl-7", suffix && "pr-14")} />
        {suffix ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-500">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("spa-display mt-1 text-xl font-bold tabular", tone === "good" && "text-emerald-300", tone === "bad" && "text-red-300")}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-fg-muted">{sub}</p> : null}
    </div>
  );
}

const years = (y: number | null) => (y === null ? "Not reached" : y === 0 ? "Already there" : y < 1 ? `${Math.max(1, Math.round(y * 12))} months` : `${y.toFixed(1)} years`);
const months = (m: number) => (m < 12 ? `${m} month${m === 1 ? "" : "s"}` : `${Math.floor(m / 12)} yr ${m % 12} mo`);

// ---------------------------------------------------------------- defaults + prefill

function defaultsFor(key: CalculatorKey, cur: Cur, p?: CalculatorPrefill | null): Vals {
  const inr = cur === "INR";
  const annualSpend = p && p.avgMonthlySpend > 0 ? Math.round(p.avgMonthlySpend * 12) : inr ? 600_000 : 48_000;
  const essential = p && p.avgMonthlyEssentialSpend > 0 ? Math.round(p.avgMonthlyEssentialSpend) : inr ? 30_000 : 2_500;
  const savings = p?.netWorth && p.netWorth > 0 ? Math.round(p.netWorth) : inr ? 500_000 : 50_000;
  const income = p?.avgMonthlyIncome ?? 0;
  const spendM = p?.avgMonthlySpend ?? 0;
  const savingsRate = income > 0 && spendM > 0 && income > spendM ? Math.round(((income - spendM) / income) * 100) : 25;
  const infl = inr ? 6 : 3;
  switch (key) {
    case "fire":
      return { annualSpend, withdrawalRate: 4, currentSavings: savings, savingsRate, expectedReturn: inr ? 11 : 7, inflation: infl, leanSpend: p && p.avgMonthlyEssentialSpend > 0 ? Math.round(p.avgMonthlyEssentialSpend * 12) : Math.round(annualSpend * 0.7), currentAge: 35, retirementAge: 60, partTimeIncome: inr ? 240_000 : 20_000 };
    case "compound":
      return { monthly: inr ? 10_000 : 500, years: 10, annualReturn: inr ? 12 : 7, stepUp: inr ? 10 : 0, lumpSum: 0 };
    case "loan":
      return { principal: inr ? 3_000_000 : 300_000, rate: inr ? 8.5 : 6.5, years: inr ? 20 : 30, extra: inr ? 5_000 : 200 };
    case "card_payoff":
      return { budget: inr ? 15_000 : 600 };
    case "emergency":
      return { monthlyEssential: essential, months: 6, saved: Math.min(savings, essential * 3), monthlySaving: inr ? 10_000 : 400 };
    case "retirement":
      return { currentAge: 35, retirementAge: 60, lifeExpectancy: 85, annualExpense: annualSpend, inflation: infl, preReturn: inr ? 11 : 7, postReturn: inr ? 7 : 4, currentSavings: savings };
    case "inflation":
      return { amount: inr ? 100_000 : 1_000, rate: infl, years: 10 };
    case "savings_goal": {
      const g = p?.goals[0];
      const d = new Date();
      const nextYear = `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      return { target: g?.targetAmount ?? (inr ? 300_000 : 10_000), current: g?.saved ?? 0, targetDate: g?.targetDate ?? nextYear, annualReturn: 0, goalName: g?.name ?? "" };
    }
  }
}

function defaultCards(cur: Cur, p?: CalculatorPrefill | null): CardRow[] {
  const apr = cur === "INR" ? 42 : 24;
  if (p?.cards.length) {
    return p.cards.map((c) => ({ name: c.label, balance: Math.round(c.balance), apr, minPayment: Math.round(c.minimumDue ?? Math.max(cur === "INR" ? 500 : 25, c.balance * 0.03)) }));
  }
  return cur === "INR"
    ? [
        { name: "Card A", balance: 80_000, apr: 42, minPayment: 4_000 },
        { name: "Card B", balance: 25_000, apr: 36, minPayment: 1_250 },
      ]
    : [
        { name: "Card A", balance: 4_000, apr: 27, minPayment: 100 },
        { name: "Card B", balance: 1_200, apr: 20, minPayment: 35 },
      ];
}

// ---------------------------------------------------------------- the page body

export function Calculators({
  currency,
  prefill,
  saved,
  onSave,
  onDelete,
}: {
  currency: string;
  prefill?: CalculatorPrefill | null;
  saved?: Partial<Record<CalculatorKey, ScenarioInputs>>;
  onSave?: (key: CalculatorKey, inputs: ScenarioInputs) => Promise<void>;
  onDelete?: (key: CalculatorKey) => Promise<void>;
}) {
  const cur: Cur = currency === "INR" ? "INR" : "USD";
  const [active, setActive] = useState<CalculatorKey>("fire");
  const meta = CALCULATOR_LIST.find((c) => c.key === active)!;
  return (
    <div className="space-y-4">
      <nav aria-label="Calculators" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {CALCULATOR_LIST.map((c) => {
          const Icon = c.icon;
          const on = c.key === active;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(c.key)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm whitespace-nowrap", on ? "border-amber-400/50 bg-amber-400/10 font-medium text-amber-100" : "border-white/10 text-zinc-400 hover:text-zinc-100")}
            >
              <Icon className={cn("size-4", on ? "text-amber-300" : "")} aria-hidden /> {c.label}
            </button>
          );
        })}
      </nav>
      <p className="text-sm text-fg-muted">{meta.blurb}</p>
      {/* key: switching calculators (or prefill arriving) starts from fresh inputs */}
      <One key={`${active}:${prefill ? "p" : "-"}:${saved?.[active] ? "s" : "-"}`} calc={active} cur={cur} prefill={prefill} saved={saved?.[active]} onSave={onSave} onDelete={onDelete} />
      <p className="text-xs text-fg-muted">
        Estimates for planning, not financial advice. Real returns, rates and prices change; the results are only as good as the numbers you put in.
        {prefill ? " Pre-filled from your last 3 complete months in SpendVault; change anything." : ""}
      </p>
    </div>
  );
}

function One({ calc, cur, prefill, saved, onSave, onDelete }: { calc: CalculatorKey; cur: Cur; prefill?: CalculatorPrefill | null; saved?: ScenarioInputs; onSave?: (k: CalculatorKey, i: ScenarioInputs) => Promise<void>; onDelete?: (k: CalculatorKey) => Promise<void> }) {
  const initial = useMemo(() => {
    const base = defaultsFor(calc, cur, prefill);
    if (!saved) return base;
    const out: Vals = { ...base };
    for (const [k, v] of Object.entries(saved)) if (typeof v === "number" || typeof v === "string") out[k] = v;
    return out;
  }, [calc, cur, prefill, saved]);
  const [v, setV] = useState<Vals>(initial);
  const [cards, setCards] = useState<CardRow[]>(() => (Array.isArray(saved?.cards) ? (saved.cards as unknown as CardRow[]) : defaultCards(cur, prefill)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const sym = cur === "INR" ? "₹" : "$";
  const f = (k: string) => num(v[k]);
  const pct = (k: string) => num(v[k]) / 100;
  const m = (n: number) => money(n, cur);

  async function save() {
    if (!onSave) return;
    setBusy(true);
    setError(null);
    try {
      const inputs: ScenarioInputs = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" && k !== "targetDate" && k !== "goalName" ? num(x) : x]));
      if (calc === "card_payoff") inputs.cards = cards.map((c) => ({ ...c }));
      await onSave(calc, inputs);
      setMsg("Saved. These numbers load next time.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  let fields: React.ReactNode;
  let results: React.ReactNode;

  if (calc === "fire") {
    const r = fire({
      annualSpend: f("annualSpend"),
      withdrawalRate: pct("withdrawalRate"),
      currentSavings: f("currentSavings"),
      savingsRate: pct("savingsRate"),
      expectedReturn: pct("expectedReturn"),
      inflation: pct("inflation"),
      leanAnnualSpend: f("leanSpend") || undefined,
      currentAge: f("currentAge"),
      retirementAge: f("retirementAge"),
      partTimeIncome: f("partTimeIncome"),
    });
    const age = (y: number | null) => (y === null ? undefined : `around age ${Math.round(f("currentAge") + y)}`);
    fields = (
      <>
        <NumField id="fire-spend" label="Yearly spending" prefix={sym} value={v.annualSpend} onChange={set("annualSpend")} hint={prefill?.avgMonthlySpend ? `Your average month × 12` : undefined} />
        <NumField id="fire-wr" label="Withdrawal rate" suffix="%" value={v.withdrawalRate} onChange={set("withdrawalRate")} hint="4% is the common rule of thumb" />
        <NumField id="fire-saved" label="Invested so far" prefix={sym} value={v.currentSavings} onChange={set("currentSavings")} hint={prefill?.netWorth ? "From your net worth" : undefined} />
        <NumField id="fire-sr" label="Savings rate" suffix="% of pay" value={v.savingsRate} onChange={set("savingsRate")} />
        <NumField id="fire-ret" label="Expected return" suffix="% / yr" value={v.expectedReturn} onChange={set("expectedReturn")} />
        <NumField id="fire-inf" label="Inflation" suffix="% / yr" value={v.inflation} onChange={set("inflation")} />
        <NumField id="fire-age" label="Your age" value={v.currentAge} onChange={set("currentAge")} />
        <NumField id="fire-rage" label="Age you'd stop anyway (Coast)" value={v.retirementAge} onChange={set("retirementAge")} />
        <NumField id="fire-lean" label="Bare-bones yearly spending (Lean)" prefix={sym} value={v.leanSpend} onChange={set("leanSpend")} hint={prefill?.avgMonthlyEssentialSpend ? "Your essential spending × 12" : "Default: 70% of spending"} />
        <NumField id="fire-pt" label="Part-time income a year (Barista)" prefix={sym} value={v.partTimeIncome} onChange={set("partTimeIncome")} />
      </>
    );
    results = (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Your FIRE number" value={m(r.fireNumber)} sub={`${Math.round(1 / Math.max(pct("withdrawalRate"), 0.0001))}× your yearly spending`} />
          <Stat label="Time to get there" value={years(r.yearsToFI)} sub={age(r.yearsToFI) ?? `saving ${m(r.annualSavings)} a year`} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Lean FIRE" value={m(r.lean.number)} sub={years(r.lean.years)} />
          <Stat label="Fat FIRE (1.5× spend)" value={m(r.fat.number)} sub={years(r.fat.years)} />
          <Stat label="Barista FIRE" value={m(r.barista.number)} sub={years(r.barista.years)} />
          <Stat label="Coast FIRE" value={m(r.coast.number)} sub={r.coast.reached ? "Reached: you could stop saving" : `needed now to coast to age ${f("retirementAge")}`} tone={r.coast.reached ? "good" : undefined} />
        </div>
        <p className="mt-2 text-xs text-fg-muted">In today&apos;s money: growth uses your return minus inflation ({(r.realReturn * 100).toFixed(1)}%). Savings come from your savings rate: about {m(r.annualSavings)} a year.</p>
      </>
    );
  } else if (calc === "compound") {
    const r = sip({ monthly: f("monthly"), years: f("years"), annualReturn: pct("annualReturn"), stepUp: pct("stepUp"), lumpSum: f("lumpSum") });
    fields = (
      <>
        <NumField id="sip-m" label="Each month" prefix={sym} value={v.monthly} onChange={set("monthly")} />
        <NumField id="sip-y" label="For" suffix="years" value={v.years} onChange={set("years")} />
        <NumField id="sip-r" label="Expected return" suffix="% / yr" value={v.annualReturn} onChange={set("annualReturn")} />
        <NumField id="sip-s" label="Step-up each year" suffix="%" value={v.stepUp} onChange={set("stepUp")} hint="Raise the monthly amount every year (0 = flat)" />
        <NumField id="sip-l" label="Starting lump sum" prefix={sym} value={v.lumpSum} onChange={set("lumpSum")} />
      </>
    );
    results = (
      <>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Grows to" value={m(r.futureValue)} />
          <Stat label="You put in" value={m(r.invested)} />
          <Stat label="Growth" value={m(r.gains)} tone="good" />
        </div>
        <YearTable rows={r.yearly.map((y) => [`Year ${y.year}`, m(y.invested), m(y.value)])} head={["", "Put in", "Value"]} />
      </>
    );
  } else if (calc === "loan") {
    const n = Math.round(f("years") * 12);
    const s = extraPaymentSavings(f("principal"), pct("rate"), n, f("extra"));
    const byYear: Array<[string, string, string, string]> = [];
    for (let y = 0; y * 12 < s.base.schedule.length; y++) {
      const rows = s.base.schedule.slice(y * 12, y * 12 + 12);
      byYear.push([`Year ${y + 1}`, m(rows.reduce((a, x) => a + x.principal, 0)), m(rows.reduce((a, x) => a + x.interest, 0)), m(rows.at(-1)!.balance)]);
    }
    fields = (
      <>
        <NumField id="loan-p" label="Loan amount" prefix={sym} value={v.principal} onChange={set("principal")} />
        <NumField id="loan-r" label="Interest rate" suffix="% / yr" value={v.rate} onChange={set("rate")} />
        <NumField id="loan-y" label="Term" suffix="years" value={v.years} onChange={set("years")} />
        <NumField id="loan-x" label="Extra each month" prefix={sym} value={v.extra} onChange={set("extra")} hint="Paid on top, straight off the principal" />
      </>
    );
    results = (
      <>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label={cur === "INR" ? "Monthly EMI" : "Monthly payment"} value={moneyExact(s.base.payment, cur)} />
          <Stat label="Total interest" value={m(s.base.totalInterest)} sub={`over ${months(s.base.months)}`} />
          <Stat label="With the extra payment" value={s.monthsSaved > 0 ? `${months(s.monthsSaved)} sooner` : "No change"} sub={s.interestSaved > 0 ? `saves ${m(s.interestSaved)} interest` : undefined} tone={s.interestSaved > 0 ? "good" : undefined} />
        </div>
        <YearTable rows={byYear} head={["", "Principal", "Interest", "Left"]} />
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent-strong">Month-by-month schedule</summary>
          <YearTable rows={s.base.schedule.map((x) => [String(x.month), moneyExact(x.payment, cur), moneyExact(x.principal, cur), moneyExact(x.interest, cur), moneyExact(x.balance, cur)])} head={["Month", "Payment", "Principal", "Interest", "Left"]} />
        </details>
      </>
    );
  } else if (calc === "card_payoff") {
    const c = comparePayoff(cards.map((x) => ({ ...x, apr: x.apr / 100 })), f("budget"));
    const setCard = (i: number, k: keyof CardRow) => (x: string) => setCards((cs) => cs.map((cc, j) => (j === i ? { ...cc, [k]: k === "name" ? x : num(x) } : cc)));
    fields = (
      <>
        <div className="space-y-3 sm:col-span-2">
          {cards.map((cd, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 p-3 sm:grid-cols-[1.4fr_1fr_0.7fr_0.9fr_auto]">
              <Field label="Card" htmlFor={`cp-n-${i}`} className="col-span-2 sm:col-span-1">
                <Input id={`cp-n-${i}`} value={cd.name} onChange={(e) => setCard(i, "name")(e.target.value)} maxLength={40} />
              </Field>
              <NumField id={`cp-b-${i}`} label="Balance" prefix={sym} value={cd.balance} onChange={setCard(i, "balance")} />
              <NumField id={`cp-a-${i}`} label="APR" suffix="%" value={cd.apr} onChange={setCard(i, "apr")} />
              <NumField id={`cp-m-${i}`} label="Minimum" prefix={sym} value={cd.minPayment} onChange={setCard(i, "minPayment")} />
              <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove ${cd.name}`} onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={cards.length >= 10} onClick={() => setCards((cs) => [...cs, { name: `Card ${String.fromCharCode(65 + cs.length)}`, balance: 0, apr: cur === "INR" ? 42 : 24, minPayment: 0 }])}>
            <Plus /> Add a card
          </Button>
          {prefill?.cards.length ? <p className="text-xs text-fg-muted">Balances come from your latest card statements. APRs are a guess: check your statement.</p> : null}
        </div>
        <NumField id="cp-budget" label="You can pay each month (all cards)" prefix={sym} value={v.budget} onChange={set("budget")} />
      </>
    );
    results = !c.avalanche.feasible ? (
      <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
        That monthly amount doesn&apos;t cover the minimums or never gets ahead of the interest. Try a bigger monthly amount.
      </p>
    ) : (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Avalanche (highest rate first)" value={months(c.avalanche.months)} sub={`${m(c.avalanche.totalInterest)} interest · order: ${c.avalanche.order.join(", ")}`} />
          <Stat label="Snowball (smallest balance first)" value={months(c.snowball.months)} sub={`${m(c.snowball.totalInterest)} interest · order: ${c.snowball.order.join(", ")}`} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Stat label="Avalanche saves vs snowball" value={m(c.interestSavedVsSnowball)} sub={c.monthsSavedVsSnowball > 0 ? `${months(c.monthsSavedVsSnowball)} sooner` : "Same finish date"} tone={c.interestSavedVsSnowball > 0 ? "good" : undefined} />
          <Stat
            label="vs paying only the minimums"
            value={c.interestSavedVsMinimums === null ? "Minimums never finish" : m(c.interestSavedVsMinimums)}
            sub={c.monthsSavedVsMinimums ? `${months(c.monthsSavedVsMinimums)} sooner` : undefined}
            tone={c.interestSavedVsMinimums ? "good" : undefined}
          />
        </div>
        <p className="mt-2 text-xs text-fg-muted">Snowball costs a little more but clears a card sooner, which some people find easier to stick with.</p>
      </>
    );
  } else if (calc === "emergency") {
    const r = emergencyFund({ monthlyEssential: f("monthlyEssential"), months: f("months"), saved: f("saved"), monthlySaving: f("monthlySaving") });
    fields = (
      <>
        <NumField id="ef-e" label="Essential spending a month" prefix={sym} value={v.monthlyEssential} onChange={set("monthlyEssential")} hint={prefill?.avgMonthlyEssentialSpend ? "Rent, groceries, bills, transport, health… from your data" : "Rent, groceries, bills, transport, health"} />
        <NumField id="ef-m" label="Months to cover" value={v.months} onChange={set("months")} hint="3–6 is common; more if your income is irregular" />
        <NumField id="ef-s" label="Saved for it so far" prefix={sym} value={v.saved} onChange={set("saved")} />
        <NumField id="ef-ms" label="You can add each month" prefix={sym} value={v.monthlySaving} onChange={set("monthlySaving")} />
      </>
    );
    results = (
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Target" value={m(r.target)} />
        <Stat label="You cover" value={`${fmtCount(Math.floor(r.coveredMonths * 10) / 10)} months`} tone={r.gap === 0 ? "good" : undefined} />
        <Stat label="Still to save" value={m(r.gap)} sub={r.monthsToGoal === null ? "Add a monthly amount" : r.monthsToGoal === 0 ? "Done" : `about ${months(r.monthsToGoal)}`} />
      </div>
    );
  } else if (calc === "retirement") {
    const r = retirement({
      currentAge: f("currentAge"),
      retirementAge: f("retirementAge"),
      lifeExpectancy: f("lifeExpectancy"),
      annualExpense: f("annualExpense"),
      inflation: pct("inflation"),
      preReturn: pct("preReturn"),
      postReturn: pct("postReturn"),
      currentSavings: f("currentSavings"),
    });
    fields = (
      <>
        <NumField id="rt-a" label="Your age" value={v.currentAge} onChange={set("currentAge")} />
        <NumField id="rt-r" label="Retire at" value={v.retirementAge} onChange={set("retirementAge")} />
        <NumField id="rt-l" label="Plan until age" value={v.lifeExpectancy} onChange={set("lifeExpectancy")} />
        <NumField id="rt-e" label="Yearly spending today" prefix={sym} value={v.annualExpense} onChange={set("annualExpense")} />
        <NumField id="rt-i" label="Inflation" suffix="% / yr" value={v.inflation} onChange={set("inflation")} />
        <NumField id="rt-p" label="Return until retirement" suffix="% / yr" value={v.preReturn} onChange={set("preReturn")} />
        <NumField id="rt-q" label="Return in retirement" suffix="% / yr" value={v.postReturn} onChange={set("postReturn")} />
        <NumField id="rt-s" label="Saved for retirement so far" prefix={sym} value={v.currentSavings} onChange={set("currentSavings")} />
      </>
    );
    results = (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Pot you'll need at retirement" value={m(r.corpus)} sub={`${r.yearsInRetirement} years of spending, rising with prices`} />
          <Stat label="Invest each month" value={r.monthlyNeeded === null ? "Retiring now" : m(r.monthlyNeeded)} sub={r.gap === 0 ? "Your savings already cover it" : `to close a ${m(r.gap)} gap`} tone={r.gap === 0 ? "good" : undefined} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Stat label={`A year's spending in ${r.yearsToRetirement} years`} value={m(r.expenseAtRetirement)} />
          <Stat label="Your savings grow to" value={m(r.savingsAtRetirement)} />
        </div>
      </>
    );
  } else if (calc === "inflation") {
    const r = inflation(f("amount"), pct("rate"), f("years"));
    fields = (
      <>
        <NumField id="in-a" label="Amount today" prefix={sym} value={v.amount} onChange={set("amount")} />
        <NumField id="in-r" label="Inflation" suffix="% / yr" value={v.rate} onChange={set("rate")} />
        <NumField id="in-y" label="Years" value={v.years} onChange={set("years")} />
      </>
    );
    results = (
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat label={`Costs in ${f("years")} years`} value={m(r.futureCost)} sub={`${m(r.increase)} more than today`} />
        <Stat label="Today's money will buy" value={m(r.purchasingPower)} sub="worth of today's prices" tone="bad" />
      </div>
    );
  } else {
    const today = new Date().toLocaleDateString("en-CA");
    const n = monthsUntil(today, String(v.targetDate || today));
    const r = savingsGoal({ target: f("target"), current: f("current"), months: n, annualReturn: pct("annualReturn") });
    fields = (
      <>
        {prefill?.goals.length ? (
          <Field label="Start from a goal" htmlFor="sg-goal">
            <select
              id="sg-goal"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-base text-zinc-100 md:text-sm"
              value={String(v.goalName)}
              onChange={(e) => {
                const g = prefill.goals.find((x) => x.name === e.target.value);
                if (g) setV((o) => ({ ...o, goalName: g.name, target: g.targetAmount, current: g.saved, targetDate: g.targetDate ?? o.targetDate }));
              }}
            >
              {prefill.goals.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <NumField id="sg-t" label="Goal amount" prefix={sym} value={v.target} onChange={set("target")} />
        <NumField id="sg-c" label="Saved so far" prefix={sym} value={v.current} onChange={set("current")} />
        <Field label="By" htmlFor="sg-d">
          <Input id="sg-d" type="date" value={String(v.targetDate)} min={today} onChange={(e) => set("targetDate")(e.target.value)} />
        </Field>
        <NumField id="sg-r" label="Interest or return" suffix="% / yr" value={v.annualReturn} onChange={set("annualReturn")} hint="0 for a plain savings pot" />
      </>
    );
    results = (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Put away each month" value={r.monthly === null ? "Pick a later date" : m(r.monthly)} sub={`${n} month${n === 1 ? "" : "s"} to go`} />
          <Stat label="Still to save" value={m(r.shortfall)} />
        </div>
        <p className="mt-2 text-sm">
          <Link href="/goals" className="text-accent-strong hover:underline">
            Track it in Goals
          </Link>
          <span className="text-fg-muted"> to see if you&apos;re on pace each month.</span>
        </p>
      </>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel>
        <PanelTitle
          aside={
            <Button type="button" variant="ghost" size="sm" onClick={() => (setV(defaultsFor(calc, cur, prefill)), setCards(defaultCards(cur, prefill)), setMsg(null))}>
              <RotateCcw /> Reset
            </Button>
          }
        >
          Your numbers
        </PanelTitle>
        <div className="grid gap-3 sm:grid-cols-2">{fields}</div>
        {onSave ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={save} disabled={busy}>
              {busy ? <Spinner /> : <Save />} Save these numbers
            </Button>
            {saved && onDelete ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onDelete(calc).then(() => setMsg("Saved numbers removed."), () => setError("Couldn't remove."))}>
                Forget saved
              </Button>
            ) : null}
            {msg ? <span className="text-xs text-emerald-300">{msg}</span> : null}
          </div>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </Panel>
      <Panel aria-live="polite">
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <PiggyBank className="size-4 text-amber-300" aria-hidden /> Result
          </span>
        </PanelTitle>
        {results}
      </Panel>
    </div>
  );
}

function YearTable({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/10">
      <table className="w-full text-right text-xs tabular">
        <thead className="sticky top-0 bg-zinc-900 text-fg-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn("px-2 py-1.5 font-medium", i === 0 && "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={cn("px-2 py-1", j === 0 && "text-left text-fg-muted")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
