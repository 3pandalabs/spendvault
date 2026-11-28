// Money calculators. Pure functions (no React, no fetch), unit-tested in
// calc.test.ts against known values. Rates are fractions (0.04 = 4%), money is
// in major units, time in years or months as named. Results are estimates for
// planning, not financial advice.

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Return after inflation: (1 + nominal) / (1 + inflation) − 1. */
export const realRate = (nominal: number, inflation: number) => (1 + nominal) / (1 + inflation) - 1;

// ---------------------------------------------------------------- FIRE

/** The FIRE number: annual spend / safe withdrawal rate (25× spend at 4%). */
export function fireNumber(annualSpend: number, withdrawalRate: number): number {
  if (withdrawalRate <= 0) return 0;
  return round2(Math.max(0, annualSpend) / withdrawalRate);
}

/**
 * Years until `current` growing at `rate` a year plus `annualContribution`
 * (added each year) reaches `target`. 0 when already there, null when it
 * never gets there.
 */
export function yearsToTarget(o: { current: number; annualContribution: number; rate: number; target: number }): number | null {
  const { current, annualContribution: c, rate: r, target } = o;
  if (current >= target) return 0;
  if (Math.abs(r) < 1e-12) return c > 0 ? (target - current) / c : null;
  const num = target * r + c;
  const den = current * r + c;
  if (den <= 0 || num / den <= 0) return null;
  const n = Math.log(num / den) / Math.log(1 + r);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type FireInput = {
  annualSpend: number;
  withdrawalRate: number; // 0.04
  currentSavings: number;
  savingsRate: number; // share of take-home pay saved, 0..0.95
  expectedReturn: number; // nominal, e.g. 0.07
  inflation: number; // e.g. 0.03
  /** Lean FIRE spend; default 70% of annualSpend (or your essential spend). */
  leanAnnualSpend?: number;
  /** Fat FIRE multiple of today's spend; default 1.5. */
  fatMultiple?: number;
  currentAge?: number;
  retirementAge?: number; // Coast FIRE: when you'd stop working anyway
  partTimeIncome?: number; // Barista FIRE: yearly income from part-time work
};

export type FireResult = {
  fireNumber: number;
  annualIncome: number;
  annualSavings: number;
  realReturn: number;
  yearsToFI: number | null;
  lean: { annualSpend: number; number: number; years: number | null };
  fat: { annualSpend: number; number: number; years: number | null };
  barista: { annualSpend: number; number: number; years: number | null };
  coast: { number: number; reached: boolean; yearsToRetirement: number | null };
};

/**
 * FIRE in today's money: growth uses the real (after-inflation) return, so the
 * targets stay in today's prices. Savings per year come from the savings
 * rate: income = spend / (1 − rate), savings = income × rate.
 */
export function fire(i: FireInput): FireResult {
  const sr = Math.min(Math.max(i.savingsRate, 0), 0.95);
  const annualIncome = sr < 1 ? i.annualSpend / (1 - sr) : 0;
  const annualSavings = annualIncome * sr;
  const real = realRate(i.expectedReturn, i.inflation);
  const years = (target: number) => yearsToTarget({ current: i.currentSavings, annualContribution: annualSavings, rate: real, target });
  const variant = (annualSpend: number) => {
    const n = fireNumber(annualSpend, i.withdrawalRate);
    return { annualSpend: round2(annualSpend), number: n, years: years(n) };
  };
  const target = fireNumber(i.annualSpend, i.withdrawalRate);
  const yearsToRetirement = i.currentAge !== undefined && i.retirementAge !== undefined ? Math.max(0, i.retirementAge - i.currentAge) : null;
  const coastNumber = yearsToRetirement === null ? target : round2(target / Math.pow(1 + real, yearsToRetirement));
  return {
    fireNumber: target,
    annualIncome: round2(annualIncome),
    annualSavings: round2(annualSavings),
    realReturn: real,
    yearsToFI: years(target),
    lean: variant(i.leanAnnualSpend ?? i.annualSpend * 0.7),
    fat: variant(i.annualSpend * (i.fatMultiple ?? 1.5)),
    barista: variant(Math.max(0, i.annualSpend - (i.partTimeIncome ?? 0))),
    coast: { number: coastNumber, reached: i.currentSavings >= coastNumber, yearsToRetirement },
  };
}

// ---------------------------------------------------------------- compound interest / SIP

/** A lump sum compounded `perYear` times a year: P (1 + r/k)^(k·t). */
export function compoundInterest(principal: number, annualRate: number, years: number, perYear = 1): number {
  return round2(principal * Math.pow(1 + annualRate / perYear, perYear * years));
}

export type SipInput = {
  monthly: number;
  years: number;
  annualReturn: number;
  /** Raise the monthly amount by this share every 12 months (India "step-up SIP"), e.g. 0.1. */
  stepUp?: number;
  lumpSum?: number;
};

export type SipResult = { futureValue: number; invested: number; gains: number; yearly: Array<{ year: number; invested: number; value: number }> };

/**
 * Monthly investing (SIP): each month's amount goes in at the start of the
 * month and grows at annualReturn / 12 per month (the convention Indian SIP
 * calculators use). With `stepUp`, the amount rises once a year.
 */
export function sip(i: SipInput): SipResult {
  const r = i.annualReturn / 12;
  const months = Math.max(0, Math.round(i.years * 12));
  let value = Math.max(0, i.lumpSum ?? 0);
  let invested = value;
  const yearly: SipResult["yearly"] = [];
  for (let m = 0; m < months; m++) {
    const amount = i.monthly * Math.pow(1 + (i.stepUp ?? 0), Math.floor(m / 12));
    invested += amount;
    value = (value + amount) * (1 + r);
    if ((m + 1) % 12 === 0 || m === months - 1) yearly.push({ year: Math.ceil((m + 1) / 12), invested: round2(invested), value: round2(value) });
  }
  return { futureValue: round2(value), invested: round2(invested), gains: round2(value - invested), yearly };
}

// ---------------------------------------------------------------- loan / EMI

/** Monthly payment (EMI): P·i·(1+i)^n / ((1+i)^n − 1), i = annual rate / 12. */
export function emi(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const i = annualRate / 12;
  if (Math.abs(i) < 1e-12) return round2(principal / months);
  const f = Math.pow(1 + i, months);
  return round2((principal * i * f) / (f - 1));
}

export type AmortizationRow = { month: number; payment: number; principal: number; interest: number; balance: number };
export type LoanResult = { payment: number; months: number; totalInterest: number; totalPaid: number; schedule: AmortizationRow[] };

/** Month-by-month schedule. `extraMonthly` goes straight to principal and ends the loan early. */
export function amortize(principal: number, annualRate: number, months: number, extraMonthly = 0): LoanResult {
  const pay = emi(principal, annualRate, months);
  const i = annualRate / 12;
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;
  const schedule: AmortizationRow[] = [];
  for (let m = 1; balance > 0.005 && m <= months; m++) {
    const interest = round2(balance * i);
    // The last month clears any cents left by rounding the payment.
    const due = m === months ? round2(balance + interest) : Math.min(pay + Math.max(0, extraMonthly), round2(balance + interest));
    const toPrincipal = round2(due - interest);
    balance = round2(balance - toPrincipal);
    totalInterest += interest;
    totalPaid += due;
    schedule.push({ month: m, payment: round2(due), principal: toPrincipal, interest, balance: Math.max(0, balance) });
  }
  return { payment: pay, months: schedule.length, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid), schedule };
}

/** What an extra monthly payment saves versus the plain schedule. */
export function extraPaymentSavings(principal: number, annualRate: number, months: number, extraMonthly: number) {
  const base = amortize(principal, annualRate, months);
  const fast = amortize(principal, annualRate, months, extraMonthly);
  return { base, withExtra: fast, monthsSaved: base.months - fast.months, interestSaved: round2(base.totalInterest - fast.totalInterest) };
}

// ---------------------------------------------------------------- credit card payoff

export type Card = { name: string; balance: number; apr: number; minPayment: number };
export type PayoffStrategy = "avalanche" | "snowball";
export type PayoffResult = { feasible: boolean; months: number; totalInterest: number; order: string[] };

const MAX_PAYOFF_MONTHS = 600;

/**
 * Pays every card's minimum each month, then puts whatever is left of
 * `monthlyBudget` on one card at a time: highest APR first (avalanche) or
 * smallest balance first (snowball). Interest accrues monthly at APR / 12.
 * Not feasible when the budget doesn't cover the minimums or the debt never
 * ends (50 years).
 */
export function payoff(cards: readonly Card[], monthlyBudget: number, strategy: PayoffStrategy): PayoffResult {
  const cs = cards.filter((c) => c.balance > 0).map((c) => ({ ...c }));
  const minimums = cs.reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);
  if (cs.length === 0) return { feasible: true, months: 0, totalInterest: 0, order: [] };
  if (monthlyBudget + 1e-9 < minimums) return { feasible: false, months: 0, totalInterest: 0, order: [] };
  const order: string[] = [];
  let totalInterest = 0;
  let month = 0;
  while (cs.some((c) => c.balance > 0.005)) {
    if (++month > MAX_PAYOFF_MONTHS) return { feasible: false, months: month - 1, totalInterest: round2(totalInterest), order };
    for (const c of cs) {
      if (c.balance <= 0.005) continue;
      const interest = round2((c.balance * c.apr) / 12);
      c.balance = round2(c.balance + interest);
      totalInterest += interest;
    }
    let left = monthlyBudget;
    for (const c of cs) {
      if (c.balance <= 0.005) continue;
      const p = Math.min(c.minPayment, c.balance, left);
      c.balance = round2(c.balance - p);
      left -= p;
    }
    const targets = cs
      .filter((c) => c.balance > 0.005)
      .sort((a, b) => (strategy === "avalanche" ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance || b.apr - a.apr));
    for (const c of targets) {
      if (left <= 0.005) break;
      const p = Math.min(c.balance, left);
      c.balance = round2(c.balance - p);
      left -= p;
    }
    for (const c of cs) if (c.balance <= 0.005 && !order.includes(c.name)) order.push(c.name);
  }
  return { feasible: true, months: month, totalInterest: round2(totalInterest), order };
}

/** Avalanche vs snowball (and minimums only), with what avalanche saves. */
export function comparePayoff(cards: readonly Card[], monthlyBudget: number) {
  const avalanche = payoff(cards, monthlyBudget, "avalanche");
  const snowball = payoff(cards, monthlyBudget, "snowball");
  const minimumsOnly = payoff(cards, cards.reduce((s, c) => s + (c.balance > 0 ? Math.min(c.minPayment, c.balance) : 0), 0), "avalanche");
  return {
    avalanche,
    snowball,
    minimumsOnly,
    interestSavedVsSnowball: round2(snowball.totalInterest - avalanche.totalInterest),
    monthsSavedVsSnowball: snowball.months - avalanche.months,
    interestSavedVsMinimums: minimumsOnly.feasible ? round2(minimumsOnly.totalInterest - avalanche.totalInterest) : null,
    monthsSavedVsMinimums: minimumsOnly.feasible ? minimumsOnly.months - avalanche.months : null,
  };
}

// ---------------------------------------------------------------- emergency fund

export function emergencyFund(o: { monthlyEssential: number; months: number; saved: number; monthlySaving: number }) {
  const target = round2(Math.max(0, o.monthlyEssential) * Math.max(0, o.months));
  const gap = round2(Math.max(0, target - o.saved));
  return {
    target,
    gap,
    coveredMonths: o.monthlyEssential > 0 ? round2(o.saved / o.monthlyEssential) : 0,
    monthsToGoal: gap === 0 ? 0 : o.monthlySaving > 0 ? Math.ceil(gap / o.monthlySaving) : null,
  };
}

// ---------------------------------------------------------------- retirement corpus

export type RetirementInput = {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  annualExpense: number; // in today's money
  inflation: number;
  preReturn: number; // return before retirement
  postReturn: number; // return during retirement
  currentSavings: number;
};

/**
 * Corpus needed at retirement to pay this year's expense, grown by inflation,
 * every year from retirement to life expectancy (each year's money taken at
 * its start), while the rest earns postReturn. Then the monthly investment
 * (start of month, preReturn / 12) that closes the gap after current savings grow.
 */
export function retirement(i: RetirementInput) {
  const n = Math.max(0, i.retirementAge - i.currentAge);
  const m = Math.max(0, i.lifeExpectancy - i.retirementAge);
  const expenseAtRetirement = i.annualExpense * Math.pow(1 + i.inflation, n);
  const q = (1 + i.inflation) / (1 + i.postReturn);
  const corpus = Math.abs(q - 1) < 1e-12 ? expenseAtRetirement * m : (expenseAtRetirement * (1 - Math.pow(q, m))) / (1 - q);
  const savingsAtRetirement = i.currentSavings * Math.pow(1 + i.preReturn, n);
  const gap = Math.max(0, corpus - savingsAtRetirement);
  const months = n * 12;
  const r = i.preReturn / 12;
  const monthlyNeeded = gap === 0 ? 0 : months === 0 ? null : Math.abs(r) < 1e-12 ? gap / months : gap / (((Math.pow(1 + r, months) - 1) / r) * (1 + r));
  return {
    yearsToRetirement: n,
    yearsInRetirement: m,
    expenseAtRetirement: round2(expenseAtRetirement),
    corpus: round2(finite(corpus)),
    savingsAtRetirement: round2(savingsAtRetirement),
    gap: round2(gap),
    monthlyNeeded: monthlyNeeded === null ? null : round2(monthlyNeeded),
  };
}

// ---------------------------------------------------------------- inflation

export function inflation(amount: number, rate: number, years: number) {
  const f = Math.pow(1 + rate, years);
  return { futureCost: round2(amount * f), purchasingPower: round2(amount / f), increase: round2(amount * f - amount) };
}

// ---------------------------------------------------------------- savings goal

/** Whole months from `today` to `date` (YYYY-MM-DD), counting a partial month; ≥ 0. */
export function monthsUntil(today: string, date: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0);
  return Math.max(0, n);
}

/** Monthly deposit (end of month) to reach `target` in `months`, with `current` and returns compounding monthly. */
export function savingsGoal(o: { target: number; current: number; months: number; annualReturn: number }) {
  const i = o.annualReturn / 12;
  const grown = o.current * Math.pow(1 + i, o.months);
  const need = Math.max(0, o.target - grown);
  const monthly = need === 0 ? 0 : o.months <= 0 ? null : Math.abs(i) < 1e-12 ? need / o.months : (need * i) / (Math.pow(1 + i, o.months) - 1);
  return { monthly: monthly === null ? null : round2(monthly), currentGrowsTo: round2(grown), shortfall: round2(need) };
}
