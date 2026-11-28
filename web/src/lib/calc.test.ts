import { describe, expect, it } from "vitest";
import {
  amortize,
  comparePayoff,
  compoundInterest,
  emergencyFund,
  emi,
  extraPaymentSavings,
  fire,
  fireNumber,
  inflation,
  monthsUntil,
  payoff,
  realRate,
  retirement,
  savingsGoal,
  sip,
  yearsToTarget,
} from "./calc";

describe("FIRE", () => {
  it("FIRE number = annual spend / withdrawal rate (25x at 4%)", () => {
    expect(fireNumber(40_000, 0.04)).toBe(1_000_000);
    expect(fireNumber(40_000, 0.035)).toBeCloseTo(1_142_857.14, 2);
    expect(fireNumber(6_00_000, 0.04)).toBe(1_50_00_000);
    expect(fireNumber(40_000, 0)).toBe(0);
  });

  it("years to a target: closed form, zero-rate and never", () => {
    // 40k/yr at 5% from 0 to 1M: ln(90k/40k)/ln(1.05) = 16.62
    expect(yearsToTarget({ current: 0, annualContribution: 40_000, rate: 0.05, target: 1_000_000 })).toBeCloseTo(16.62, 2);
    expect(yearsToTarget({ current: 0, annualContribution: 50_000, rate: 0, target: 1_000_000 })).toBe(20);
    expect(yearsToTarget({ current: 2_000_000, annualContribution: 0, rate: 0.05, target: 1_000_000 })).toBe(0);
    expect(yearsToTarget({ current: 0, annualContribution: 0, rate: 0, target: 1 })).toBeNull();
    // Already invested money alone: 500k → 1M at 7.177% ≈ 10 years (rule of 72).
    expect(yearsToTarget({ current: 500_000, annualContribution: 0, rate: 0.07177, target: 1_000_000 })).toBeCloseTo(10, 1);
  });

  it("real return removes inflation", () => {
    expect(realRate(0.08, 0.03)).toBeCloseTo(0.048544, 5);
    expect(realRate(0.05, 0.05)).toBe(0);
  });

  it("50% savings rate at 5% real takes ~16.6 years (the classic table)", () => {
    const r = fire({ annualSpend: 40_000, withdrawalRate: 0.04, currentSavings: 0, savingsRate: 0.5, expectedReturn: 0.05, inflation: 0 });
    expect(r.fireNumber).toBe(1_000_000);
    expect(r.annualIncome).toBe(80_000);
    expect(r.annualSavings).toBe(40_000);
    expect(r.yearsToFI).toBeCloseTo(16.62, 2);
  });

  it("Lean, Fat, Barista and Coast variants", () => {
    const r = fire({
      annualSpend: 40_000,
      withdrawalRate: 0.04,
      currentSavings: 300_000,
      savingsRate: 0.3,
      expectedReturn: 0.07,
      inflation: 0.02,
      leanAnnualSpend: 28_000,
      currentAge: 35,
      retirementAge: 65,
      partTimeIncome: 20_000,
    });
    expect(r.lean.number).toBe(700_000);
    expect(r.fat.number).toBe(1_500_000); // 1.5x spend by default
    expect(r.barista.number).toBe(500_000);
    // Coast: 1M / (1.07/1.02)^30
    expect(r.coast.number).toBeCloseTo(1_000_000 / Math.pow(1.07 / 1.02, 30), 0);
    expect(r.coast.reached).toBe(true);
    expect(r.lean.years! < r.yearsToFI! && r.yearsToFI! < r.fat.years!).toBe(true);
    // Lean defaults to 70% of spend.
    expect(fire({ annualSpend: 40_000, withdrawalRate: 0.04, currentSavings: 0, savingsRate: 0.5, expectedReturn: 0.05, inflation: 0 }).lean.number).toBe(700_000);
  });
});

describe("compound interest and SIP", () => {
  it("lump sum compounding", () => {
    expect(compoundInterest(1000, 0.05, 10)).toBe(1628.89);
    expect(compoundInterest(100_000, 0.12, 10, 12)).toBe(330_038.69);
  });

  it("₹10,000/month at 12% for 10 years = ₹23,23,391 (start-of-month SIP)", () => {
    const r = sip({ monthly: 10_000, years: 10, annualReturn: 0.12 });
    expect(Math.round(r.futureValue)).toBe(2_323_391);
    expect(r.invested).toBe(1_200_000);
    expect(r.yearly).toHaveLength(10);
    expect(r.yearly[9].value).toBe(r.futureValue);
  });

  it("step-up raises the amount once a year", () => {
    const r = sip({ monthly: 10_000, years: 3, annualReturn: 0.12, stepUp: 0.1 });
    expect(r.invested).toBe(120_000 + 132_000 + 145_200);
    // Independent formula: each year's 12 start-of-month payments, then grown for the remaining years.
    const i = 0.01;
    const yearFv = (p: number) => ((p * (Math.pow(1 + i, 12) - 1)) / i) * (1 + i);
    const expected = yearFv(10_000) * Math.pow(1 + i, 24) + yearFv(11_000) * Math.pow(1 + i, 12) + yearFv(12_100);
    expect(r.futureValue).toBeCloseTo(expected, 1);
  });

  it("lump sum plus SIP; zero return = what you put in", () => {
    expect(sip({ monthly: 100, years: 2, annualReturn: 0, lumpSum: 1000 })).toMatchObject({ futureValue: 3400, invested: 3400, gains: 0 });
  });
});

describe("loan / EMI", () => {
  it("known EMIs", () => {
    expect(emi(1_000_000, 0.1, 240)).toBe(9650.22); // ₹10 lakh, 10%, 20 years
    expect(emi(300_000, 0.065, 360)).toBe(1896.2); // $300k mortgage, 6.5%, 30 years
    expect(emi(12_000, 0, 12)).toBe(1000);
  });

  it("amortization pays the loan off exactly", () => {
    const r = amortize(300_000, 0.065, 360);
    expect(r.months).toBe(360);
    expect(r.schedule[0]).toMatchObject({ month: 1, interest: 1625, principal: 271.2 });
    expect(r.schedule[359].balance).toBe(0);
    expect(r.totalInterest).toBeCloseTo(1896.2 * 360 - 300_000, -1);
    const sumPrincipal = r.schedule.reduce((s, x) => s + x.principal, 0);
    expect(sumPrincipal).toBeCloseTo(300_000, 1);
  });

  it("an extra $200/month on that mortgage saves years and interest", () => {
    const s = extraPaymentSavings(300_000, 0.065, 360, 200);
    expect(s.withExtra.months).toBeLessThan(300);
    expect(s.monthsSaved).toBeGreaterThan(60);
    expect(s.interestSaved).toBeGreaterThan(80_000);
    expect(s.withExtra.schedule.at(-1)!.balance).toBe(0);
  });
});

describe("credit card payoff", () => {
  it("one card: $1,000 at 12% APR paying $100/month → 11 months, $58.99 interest", () => {
    const r = payoff([{ name: "A", balance: 1000, apr: 0.12, minPayment: 100 }], 100, "avalanche");
    expect(r).toMatchObject({ feasible: true, months: 11, order: ["A"] });
    expect(r.totalInterest).toBeCloseTo(58.99, 1);
  });

  it("avalanche never pays more interest than snowball; order differs", () => {
    const cards = [
      { name: "Small low", balance: 500, apr: 0.12, minPayment: 25 },
      { name: "Big high", balance: 5000, apr: 0.29, minPayment: 100 },
      { name: "Mid", balance: 2000, apr: 0.2, minPayment: 50 },
    ];
    const c = comparePayoff(cards, 600);
    expect(c.avalanche.feasible && c.snowball.feasible).toBe(true);
    expect(c.avalanche.totalInterest).toBeLessThanOrEqual(c.snowball.totalInterest);
    expect(c.interestSavedVsSnowball).toBeGreaterThan(0);
    expect(c.snowball.order[0]).toBe("Small low");
    expect(c.avalanche.order.at(-1)).not.toBe("Big high");
    expect(c.interestSavedVsMinimums).toBeGreaterThan(0);
  });

  it("not feasible when the budget doesn't cover minimums, or minimums never beat interest", () => {
    expect(payoff([{ name: "A", balance: 1000, apr: 0.2, minPayment: 50 }], 40, "avalanche").feasible).toBe(false);
    expect(payoff([{ name: "A", balance: 10_000, apr: 0.3, minPayment: 100 }], 100, "avalanche").feasible).toBe(false);
    expect(payoff([], 100, "snowball")).toEqual({ feasible: true, months: 0, totalInterest: 0, order: [] });
  });
});

describe("emergency fund", () => {
  it("target = months x essential spend", () => {
    expect(emergencyFund({ monthlyEssential: 2500, months: 6, saved: 5000, monthlySaving: 500 })).toEqual({ target: 15_000, gap: 10_000, coveredMonths: 2, monthsToGoal: 20 });
    expect(emergencyFund({ monthlyEssential: 2500, months: 3, saved: 9000, monthlySaving: 0 }).monthsToGoal).toBe(0);
    expect(emergencyFund({ monthlyEssential: 2500, months: 3, saved: 0, monthlySaving: 0 }).monthsToGoal).toBeNull();
  });
});

describe("retirement corpus", () => {
  it("inflates today's expense to retirement", () => {
    const r = retirement({ currentAge: 35, retirementAge: 60, lifeExpectancy: 85, annualExpense: 600_000, inflation: 0.06, preReturn: 0.1, postReturn: 0.06, currentSavings: 0 });
    expect(r.expenseAtRetirement).toBeCloseTo(600_000 * Math.pow(1.06, 25), 0);
    // Return equal to inflation: corpus = expense x years.
    expect(r.corpus).toBeCloseTo(r.expenseAtRetirement * 25, 0);
  });

  it("growing annuity when returns beat inflation; monthly investment closes the gap", () => {
    const r = retirement({ currentAge: 30, retirementAge: 31, lifeExpectancy: 33, annualExpense: 100, inflation: 0, preReturn: 0, postReturn: 0.1, currentSavings: 0 });
    // 100 + 100/1.1 = 190.91 (two years, taken at the start of each)
    expect(r.corpus).toBe(190.91);
    expect(r.monthlyNeeded).toBeCloseTo(190.91 / 12, 2);
    const covered = retirement({ currentAge: 30, retirementAge: 31, lifeExpectancy: 33, annualExpense: 100, inflation: 0, preReturn: 0, postReturn: 0.1, currentSavings: 1000 });
    expect(covered).toMatchObject({ gap: 0, monthlyNeeded: 0 });
  });
});

describe("inflation", () => {
  it("$1,000 at 3% for 10 years", () => {
    expect(inflation(1000, 0.03, 10)).toEqual({ futureCost: 1343.92, purchasingPower: 744.09, increase: 343.92 });
  });
});

describe("savings goal", () => {
  it("monthly amount needed by a date", () => {
    expect(savingsGoal({ target: 12_000, current: 0, months: 12, annualReturn: 0 }).monthly).toBe(1000);
    expect(savingsGoal({ target: 12_000, current: 0, months: 12, annualReturn: 0.06 }).monthly).toBe(972.8);
    expect(savingsGoal({ target: 12_000, current: 6000, months: 12, annualReturn: 0 }).monthly).toBe(500);
    expect(savingsGoal({ target: 1000, current: 2000, months: 12, annualReturn: 0 }).monthly).toBe(0);
    expect(savingsGoal({ target: 1000, current: 0, months: 0, annualReturn: 0 }).monthly).toBeNull();
  });

  it("months until a date counts a partial month", () => {
    expect(monthsUntil("2026-11-27", "2027-11-27")).toBe(12);
    expect(monthsUntil("2026-11-27", "2027-11-28")).toBe(13);
    expect(monthsUntil("2026-11-27", "2026-12-01")).toBe(1);
    expect(monthsUntil("2026-11-27", "2026-10-01")).toBe(0);
  });
});
