import { describe, expect, it } from "vitest";
import {
  addMonths,
  daysInMonth,
  formatMoney,
  mad,
  median,
  scaledMad,
  spendEntries,
  todayInKolkata,
} from "../../src/lib/insights/util.js";
import { txn } from "./helpers.js";

describe("stats", () => {
  it("median handles odd, even, empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("MAD and scaled MAD", () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(scaledMad([1, 1, 2, 2, 4, 6, 9])).toBeCloseTo(1.4826);
    expect(mad([5, 5, 5])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatMoney(12340, "INR")).toBe("₹12,340");
    expect(formatMoney(123456, "INR")).toBe("₹1,23,456");
    expect(formatMoney(12345678.4, "INR")).toBe("₹1,23,45,678");
    expect(formatMoney(999, "INR")).toBe("₹999");
    expect(formatMoney(99.5, "INR")).toBe("₹99.50");
  });
  it("uses western grouping and $ for USD", () => {
    expect(formatMoney(1234567, "USD")).toBe("$1,234,567");
    expect(formatMoney(9.99, "USD")).toBe("$9.99");
  });
});

describe("dates", () => {
  it("month math", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
  });
  it("Kolkata date rolls over at 18:30 UTC", () => {
    expect(todayInKolkata(new Date("2026-11-09T18:29:00Z"))).toBe("2026-11-09");
    expect(todayInKolkata(new Date("2026-11-09T18:31:00Z"))).toBe("2026-11-10");
  });
});

describe("spendEntries", () => {
  it("excludes NON_SPEND, nets merchant refunds, keeps salary as income", () => {
    const rows = [
      txn({ postedOn: "2026-10-01", amount: 2000, merchant: "Amazon", category: "shopping" }),
      txn({ postedOn: "2026-10-03", amount: 500, merchant: "Amazon", category: "income", direction: "credit" }),
      txn({ postedOn: "2026-10-04", amount: 90000, merchant: "Income/refund", category: "income", direction: "credit" }),
      txn({ postedOn: "2026-10-05", amount: 30000, merchant: "Card bill payment", category: "card_payment" }),
      txn({ postedOn: "2026-10-06", amount: 5000, merchant: "Investment", category: "investments" }),
    ];
    const e = spendEntries(rows);
    expect(e.map((x) => [x.category, x.amount])).toEqual([
      ["shopping", 2000],
      ["shopping", -500],
    ]);
  });
});
