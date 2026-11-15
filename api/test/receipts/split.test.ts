import { describe, expect, it } from "vitest";
import { computeDashboard } from "../../src/lib/insights/dashboard.js";
import { allocateItems } from "../../src/lib/receipts/split.js";
import { txn } from "../insights/helpers.js";

describe("allocateItems", () => {
  it("splits ₹4,200 at DMart into groceries ₹2,900 + shopping ₹1,300", () => {
    const parts = allocateItems(4200, "groceries", [
      { category: "groceries", lineTotal: 1440 },
      { category: "groceries", lineTotal: 324 },
      { category: "groceries", lineTotal: 1136 },
      { category: "shopping", lineTotal: 1300 },
    ]);
    expect(parts).toEqual([
      { category: "groceries", amount: 2900 },
      { category: "shopping", amount: 1300 },
    ]);
  });

  it("spreads tax/round-off proportionally and always sums to the transaction", () => {
    const parts = allocateItems(1001, "groceries", [
      { category: "groceries", lineTotal: 333.33 },
      { category: "shopping", lineTotal: 333.33 },
      { category: "health", lineTotal: 333.34 },
    ])!;
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(1001, 2);
  });

  it("is a no-op when everything is already the transaction's category, or nothing is usable", () => {
    expect(allocateItems(500, "groceries", [{ category: "groceries", lineTotal: 500 }])).toBeNull();
    expect(allocateItems(500, "groceries", [])).toBeNull();
    expect(allocateItems(500, "groceries", [{ category: "shopping", lineTotal: -10 }])).toBeNull();
  });

  it("folds non-spend item categories into the transaction category", () => {
    expect(
      allocateItems(300, "groceries", [
        { category: "income", lineTotal: 100 },
        { category: "groceries", lineTotal: 200 },
      ]),
    ).toBeNull();
  });
});

describe("computeDashboard with receipt splits", () => {
  const dmart = txn({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart", category: "groceries" });
  const other = txn({ postedOn: "2026-11-13", amount: 500, merchant: "Myntra", category: "shopping" });
  const splits = new Map([
    [
      dmart.id,
      [
        { category: "groceries", amount: 2900 },
        { category: "shopping", amount: 1300 },
      ],
    ],
  ]);

  it("item categories feed byCategory; totals, merchants and daily stay whole", () => {
    const plain = computeDashboard({ txns: [dmart, other], currency: "INR", today: "2026-11-20" });
    const d = computeDashboard({ txns: [dmart, other], currency: "INR", today: "2026-11-20", splits });
    expect(d.totals.spend).toBe(plain.totals.spend);
    expect(d.totals.spend).toBe(4700);
    expect(Object.fromEntries(d.byCategory.map((c) => [c.category, c.amount]))).toEqual({ groceries: 2900, shopping: 1800 });
    expect(d.topMerchants.find((m) => m.merchant === "DMart")).toMatchObject({ amount: 4200, count: 1 });
    expect(d.daily.find((x) => x.date === "2026-11-12")?.amount).toBe(4200);
  });
});
