import { describe, expect, it } from "vitest";
import { computeDashboard } from "../../src/lib/insights/dashboard.js";
import { txn } from "./helpers.js";

const base = [
  // Aug: 1000 food; Sep: none at all (no data); Oct: 3000 food; Nov (selected): 5000 food + 1000 shopping
  txn({ postedOn: "2026-08-10", amount: 1000, merchant: "Swiggy", category: "food_delivery" }),
  txn({ postedOn: "2026-10-10", amount: 3000, merchant: "Swiggy", category: "food_delivery" }),
  txn({ postedOn: "2026-11-02", amount: 2000, merchant: "Swiggy", category: "food_delivery" }),
  txn({ postedOn: "2026-11-02", amount: 3000, merchant: "Zomato", category: "food_delivery", accountId: "acct-2" }),
  txn({ postedOn: "2026-11-15", amount: 1000, merchant: "Myntra", category: "shopping" }),
  // NON_SPEND: must not count
  txn({ postedOn: "2026-11-20", amount: 40000, merchant: "Card bill payment", category: "card_payment" }),
  txn({ postedOn: "2026-11-01", amount: 90000, merchant: "Income/refund", category: "income", direction: "credit" }),
  // superseded alert row: must not count
  txn({ postedOn: "2026-11-02", amount: 2000, merchant: "Swiggy", category: "food_delivery", sourceKind: "alert", supersededBy: "x" }),
  // other currency: ignored
  txn({ postedOn: "2026-11-03", amount: 50, merchant: "Netflix", category: "subscriptions", currency: "USD" }),
];

describe("computeDashboard", () => {
  const d = computeDashboard({
    txns: base,
    currency: "INR",
    today: "2026-11-25",
    accounts: [
      { id: "acct-1", label: "HDFC card ••1234" },
      { id: "acct-2", label: "ICICI card ••9876" },
    ],
  });

  it("defaults to the latest month with data", () => {
    expect(d.month).toBe("2026-11");
    expect(d.availableMonths).toEqual(["2026-11", "2026-10", "2026-08"]);
  });

  it("totals exclude NON_SPEND, superseded and other-currency rows", () => {
    expect(d.totals.spend).toBe(6000);
    expect(d.totals.income).toBe(90000);
    expect(d.totals.previousMonthSpend).toBe(3000);
    expect(d.totals.txnCount).toBe(5); // all usable INR rows in the month, incl. non-spend
  });

  it("avg3 averages only previous months that have data", () => {
    // Oct 3000, Sep no data, Aug 1000 → 2000
    expect(d.totals.avg3MonthSpend).toBe(2000);
    const food = d.byCategory.find((c) => c.category === "food_delivery")!;
    expect(food).toMatchObject({ amount: 5000, previous: 3000, avg3: 2000, label: "Food delivery" });
    expect(food.share).toBeCloseTo(5000 / 6000, 3);
    expect(d.byCategory.map((c) => c.category)).toEqual(["food_delivery", "shopping"]);
  });

  it("daily has every day with zero fill", () => {
    expect(d.daily).toHaveLength(30);
    expect(d.daily[0]).toEqual({ date: "2026-11-01", amount: 0 });
    expect(d.daily[1]).toEqual({ date: "2026-11-02", amount: 5000 });
    expect(d.daily.reduce((s, x) => s + x.amount, 0)).toBe(6000);
  });

  it("trend is 12 months oldest first", () => {
    expect(d.trend).toHaveLength(12);
    expect(d.trend[0].month).toBe("2025-12");
    expect(d.trend[11]).toEqual({ month: "2026-11", spend: 6000 });
    expect(d.trend.find((t) => t.month === "2026-09")!.spend).toBe(0);
  });

  it("byAccount and topMerchants", () => {
    expect(d.byAccount).toEqual([
      { accountId: "acct-1", label: "HDFC card ••1234", amount: 3000 },
      { accountId: "acct-2", label: "ICICI card ••9876", amount: 3000 },
    ]);
    expect(d.topMerchants[0]).toEqual({ merchant: "Zomato", category: "food_delivery", amount: 3000, count: 1 });
  });

  it("explicit month with no data returns zeros", () => {
    const e = computeDashboard({ txns: base, currency: "INR", today: "2026-11-25", month: "2026-09" });
    expect(e.totals.spend).toBe(0);
    expect(e.daily).toHaveLength(30);
    expect(e.totals.avg3MonthSpend).toBe(1000); // only Aug has data among Jun–Aug
  });

  it("merchant refunds reduce that category's spend", () => {
    const e = computeDashboard({
      txns: [...base, txn({ postedOn: "2026-11-16", amount: 400, merchant: "Myntra", category: "income", direction: "credit" })],
      currency: "INR",
      today: "2026-11-25",
    });
    expect(e.byCategory.find((c) => c.category === "shopping")!.amount).toBe(600);
    expect(e.totals.spend).toBe(5600);
    expect(e.totals.income).toBe(90000);
  });
});
