import { describe, expect, it } from "vitest";
import { budgetAlerts, budgetLines, MAX_ROLLOVER_MONTHS, nextRollover, NO_ROLLOVER, overallBudgetLine, rolloverCarry, type Rollover } from "../../src/lib/insights/budgets.js";
import { detectDuplicates } from "../../src/lib/insights/fees.js";
import { spendAverages } from "../../src/lib/insights/prefill.js";
import { monthOf } from "../../src/lib/insights/util.js";
import { cleanMerchant, COVERING_KINDS, isManual, MANUAL, manualFingerprint, SUPERSEDABLE_KINDS, validManualDate } from "../../src/lib/manualTxn.js";
import { todayFor } from "../../src/lib/userTime.js";
import { txn } from "./helpers.js";

const USD = "USD";
const u = (p: Parameters<typeof txn>[0]) => txn({ currency: USD, category: "groceries", ...p });

// ---------------------------------------------------------------- manual transactions

describe("manual cash transactions", () => {
  it("superseding never targets or uses manual rows", () => {
    expect(SUPERSEDABLE_KINDS).not.toContain(MANUAL);
    expect(COVERING_KINDS).not.toContain(MANUAL);
    expect(SUPERSEDABLE_KINDS).toEqual(["alert"]);
    expect(COVERING_KINDS).toEqual(["statement", "csv"]);
  });

  it("fingerprints are namespaced and unique, so a statement line never collides", () => {
    const a = manualFingerprint();
    const b = manualFingerprint();
    expect(a).toMatch(/^manual:[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    expect(isManual({ sourceKind: "manual" })).toBe(true);
    expect(isManual({ sourceKind: "statement" })).toBe(false);
  });

  it("dates: real calendar days, not before 2000, at most a day ahead of the user's today", () => {
    expect(validManualDate("2026-11-27", "2026-11-27")).toBe(true);
    expect(validManualDate("2026-11-28", "2026-11-27")).toBe(true); // time zones
    expect(validManualDate("2026-11-29", "2026-11-27")).toBe(false);
    expect(validManualDate("2026-02-30", "2026-11-27")).toBe(false);
    expect(validManualDate("1999-12-31", "2026-11-27")).toBe(false);
    expect(validManualDate("27/11/2026", "2026-11-27")).toBe(false);
  });

  it("merchant names are trimmed, collapsed and required", () => {
    expect(cleanMerchant("  Farmers   market ")).toBe("Farmers market");
    expect(cleanMerchant("   ")).toBeNull();
    expect(cleanMerchant("x".repeat(200))).toHaveLength(80);
  });

  it("the double-charge detector skips manual rows but still flags real ones", () => {
    const pair = [u({ postedOn: "2026-11-02", amount: 60, merchant: "Deli" }), u({ postedOn: "2026-11-03", amount: 60, merchant: "Deli" })];
    expect(detectDuplicates(pair, USD, new Set())).toHaveLength(1);
    const manual = pair.map((t) => ({ ...t, sourceKind: "manual" }));
    expect(detectDuplicates(manual, USD, new Set())).toHaveLength(0);
    // A manual spend next to a card charge of the same amount is not a double charge either.
    expect(detectDuplicates([pair[0], manual[1]], USD, new Set())).toHaveLength(0);
  });

  it("manual spends count in budgets like any other spend", () => {
    const txns = [u({ postedOn: "2026-11-05", amount: 40 }), u({ postedOn: "2026-11-06", amount: 25, sourceKind: "manual", accountId: "cash" })];
    expect(budgetLines(txns, USD, "2026-11", [{ category: "groceries", amount: 100 }])[0]).toMatchObject({ spent: 65, remaining: 35 });
  });
});

// ---------------------------------------------------------------- rollover

const on = (since: string, unspent = true, overspend = false): Rollover => ({ unspent, overspend, since });

describe("budget rollover", () => {
  const spent: Record<string, number> = { "2026-08": 50, "2026-09": 80, "2026-10": 130, "2026-11": 60 };
  const spentIn = (m: string) => spent[m] ?? 0;

  it("off, or before/at the month it was switched on → nothing carried", () => {
    expect(rolloverCarry(100, "2026-11", NO_ROLLOVER, spentIn)).toBe(0);
    expect(rolloverCarry(100, "2026-11", { unspent: false, overspend: false, since: "2026-08" }, spentIn)).toBe(0);
    expect(rolloverCarry(100, "2026-09", on("2026-09"), spentIn)).toBe(0);
    expect(rolloverCarry(100, "2026-08", on("2026-09"), spentIn)).toBe(0);
  });

  it("unspent only: leftovers carry, overspend resets to 0", () => {
    // Sep: 100-80 = +20 → Oct starts with 20. Oct: 120-130 = -10 → reset to 0 → Nov 0.
    expect(rolloverCarry(100, "2026-10", on("2026-09"), spentIn)).toBe(20);
    expect(rolloverCarry(100, "2026-11", on("2026-09"), spentIn)).toBe(0);
    // Counts only from when it was switched on: August's +50 never carries.
    expect(rolloverCarry(100, "2026-10", on("2026-09"), spentIn)).not.toBe(70);
    expect(rolloverCarry(100, "2026-10", on("2026-08"), spentIn)).toBe(70);
  });

  it("overspend only: overspending is taken off next month, leftovers don't carry", () => {
    // Sep +20 → 0; Oct 100-130 = -30 → Nov -30.
    expect(rolloverCarry(100, "2026-11", on("2026-09", false, true), spentIn)).toBe(-30);
    expect(rolloverCarry(100, "2026-10", on("2026-09", false, true), spentIn)).toBe(0);
  });

  it("both on: a running balance", () => {
    // Aug +50 → Sep 150-80 = +70 → Oct 170-130 = +40 → Nov 40; Dec: 140-60 = 80.
    expect(rolloverCarry(100, "2026-11", on("2026-08", true, true), spentIn)).toBe(40);
    expect(rolloverCarry(100, "2026-12", on("2026-08", true, true), spentIn)).toBe(80);
  });

  it("crosses the year boundary", () => {
    const s = (m: string) => ({ "2026-12": 70, "2027-01": 10 })[m] ?? 0;
    expect(rolloverCarry(100, "2027-01", on("2026-12"), s)).toBe(30);
    expect(rolloverCarry(100, "2027-02", on("2026-12"), s)).toBe(120);
  });

  it(`looks back at most ${MAX_ROLLOVER_MONTHS} months`, () => {
    const calls: string[] = [];
    rolloverCarry(100, "2026-11", on("2020-01"), (m) => (calls.push(m), 0));
    expect(calls).toHaveLength(MAX_ROLLOVER_MONTHS);
    expect(calls[0]).toBe("2025-11");
  });

  it("month boundaries use real spend by posted date: Nov 30 is November, Dec 1 is December", () => {
    const txns = [u({ postedOn: "2026-11-30", amount: 90 }), u({ postedOn: "2026-12-01", amount: 30 })];
    const [line] = budgetLines(txns, USD, "2026-12", [{ category: "groceries", amount: 100, rollover: on("2026-11") }]);
    expect(line).toMatchObject({ rolledOver: 10, available: 110, spent: 30, remaining: 80, status: "ok" });
  });

  it("budget lines measure against budget + rollover; overspent carry can push a line over", () => {
    const txns = [u({ postedOn: "2026-10-10", amount: 150 }), u({ postedOn: "2026-11-10", amount: 60 })];
    const [line] = budgetLines(txns, USD, "2026-11", [{ category: "groceries", amount: 100, rollover: on("2026-10", true, true) }]);
    expect(line).toMatchObject({ budget: 100, rolledOver: -50, available: 50, spent: 60, remaining: -10, status: "over", progress: 1.2 });
    const [plain] = budgetLines(txns, USD, "2026-11", [{ category: "groceries", amount: 100 }]);
    expect(plain).toMatchObject({ rolledOver: 0, available: 100, status: "ok" });
  });

  it("over-budget alerts follow the rollover amount", () => {
    const txns = [u({ postedOn: "2026-10-05", amount: 20 }), u({ postedOn: "2026-11-05", amount: 110 })];
    const base = { txns, currency: USD, today: "2026-11-20" };
    expect(budgetAlerts({ ...base, budgets: [{ category: "groceries", amount: 100 }] }).filter((a) => a.periodStart === "2026-11-01")).toHaveLength(1);
    // 80 unspent in October carries: 110 of 180 is fine.
    expect(budgetAlerts({ ...base, budgets: [{ category: "groceries", amount: 100, rollover: on("2026-10") }] })).toHaveLength(0);
  });

  it("the overall monthly budget rolls over the same way", () => {
    const txns = [u({ postedOn: "2026-10-05", amount: 400 }), u({ postedOn: "2026-11-05", amount: 650, category: "dining" })];
    const l = overallBudgetLine(txns, USD, "2026-11", 500, on("2026-10"));
    expect(l).toMatchObject({ rolledOver: 100, available: 600, spent: 650, status: "over" });
    expect(overallBudgetLine(txns, USD, "2026-11", null, on("2026-10"))).toBeNull();
    const alerts = budgetAlerts({ txns, currency: USD, today: "2026-11-20", budgets: [], monthlyBudget: 500, monthlyRollover: on("2026-10") });
    expect(alerts.find((a) => a.dedupeKey === "over_budget:total:2026-11")).toMatchObject({ baseline: 600, amount: 650 });
  });

  it("switching on starts at the current month; staying on keeps it; all off clears it", () => {
    expect(nextRollover(NO_ROLLOVER, { unspent: true, overspend: false }, "2026-11")).toEqual(on("2026-11"));
    expect(nextRollover(on("2026-09"), { unspent: true, overspend: true }, "2026-11")).toEqual(on("2026-09", true, true));
    expect(nextRollover(on("2026-09"), { unspent: false, overspend: false }, "2026-11")).toEqual(NO_ROLLOVER);
    // Off and on again restarts the count.
    const off = nextRollover(on("2026-09"), { unspent: false, overspend: false }, "2026-10");
    expect(nextRollover(off, { unspent: true, overspend: false }, "2026-11")).toEqual(on("2026-11"));
  });

  it("the start month is the user's month (lib/userTime.ts), not UTC's", () => {
    // 2026-12-01 03:30 UTC = Nov 30, 22:30 in New York, Dec 1, 09:00 in Kolkata.
    const now = new Date("2026-12-01T03:30:00Z");
    const ny = monthOf(todayFor({ timezone: "America/New_York" }, now));
    const ind = monthOf(todayFor({ timezone: "Asia/Kolkata" }, now));
    expect(ny).toBe("2026-11");
    expect(ind).toBe("2026-12");
    expect(nextRollover(NO_ROLLOVER, { unspent: true, overspend: false }, ny).since).toBe("2026-11");
    // No time zone saved: by currency (USD → New York).
    expect(monthOf(todayFor({ timezone: null, baseCurrency: "USD" }, now))).toBe("2026-11");
    expect(monthOf(todayFor({ timezone: null, baseCurrency: "INR" }, now))).toBe("2026-12");
  });
});

// ---------------------------------------------------------------- calculator pre-fill

describe("calculator pre-fill averages", () => {
  it("averages the last 3 complete months: spend, essential spend and income", () => {
    const txns = [
      u({ postedOn: "2026-07-03", amount: 999 }), // too old (4th complete month back)
      u({ postedOn: "2026-08-03", amount: 300 }),
      u({ postedOn: "2026-08-04", amount: 100, category: "dining" }),
      u({ postedOn: "2026-09-03", amount: 300, sourceKind: "manual" }),
      u({ postedOn: "2026-10-03", amount: 300 }),
      u({ postedOn: "2026-10-01", amount: 3000, direction: "credit", category: "income", merchant: "Payroll" }),
      u({ postedOn: "2026-11-03", amount: 5000 }), // current month: excluded
    ];
    const a = spendAverages(txns, USD, "2026-11-20");
    expect(a.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(a.avgMonthlySpend).toBe(333.33);
    expect(a.avgMonthlyEssentialSpend).toBe(300);
    expect(a.avgMonthlyIncome).toBe(1000);
  });

  it("no complete month yet → zeros", () => {
    expect(spendAverages([u({ postedOn: "2026-11-03", amount: 10 })], USD, "2026-11-20")).toEqual({ months: [], avgMonthlySpend: 0, avgMonthlyEssentialSpend: 0, avgMonthlyIncome: 0 });
  });
});
