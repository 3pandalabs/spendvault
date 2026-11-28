import { describe, expect, it } from "vitest";
import { normalizeItemName, priceHeadline, priceTracks, unitPriceOf, type PriceItemInput } from "../../src/lib/receipts/prices.js";
import { policyFor, returnWindow, returnWindowAlerts, returnWorthReminding, type ReturnAlertReceipt } from "../../src/lib/receipts/returns.js";
import { isTaxTag, suggestHsaFsa } from "../../src/lib/tax.js";
import { normalizeNote, normalizeTags, SplitError, spendSplitParts, validateSplit } from "../../src/lib/txnTools.js";
import { parseStatementText } from "../../src/lib/ingest/statement.js";
import { validateStatementInput } from "../../src/lib/ingest/llm.js";

// ---------------------------------------------------------------- return windows

describe("return windows", () => {
  it("typical windows for big US retailers", () => {
    const days = (m: string) => policyFor(m)?.days;
    expect(days("Amazon")).toBe(30);
    expect(days("AMZN Mktp US")).toBe(30);
    expect(days("Target")).toBe(90);
    expect(days("Walmart Supercenter")).toBe(90);
    expect(days("Costco Wholesale")).toBe(90);
    expect(days("Best Buy")).toBe(15);
    expect(days("Apple Store")).toBe(14);
    expect(days("The Home Depot")).toBe(90);
    expect(days("Joe's Diner")).toBeUndefined();
  });
  it("closes on purchase + days; a custom override wins; 0 = final sale", () => {
    const w = returnWindow({ merchant: "Best Buy", purchasedOn: "2026-11-20", returnDays: null }, "2026-11-30");
    expect(w).toMatchObject({ source: "typical", days: 15, closesOn: "2026-12-05", daysLeft: 5, open: true });
    expect(returnWindow({ merchant: "Best Buy", purchasedOn: "2026-11-20", returnDays: 30 }, "2026-11-30")).toMatchObject({ source: "custom", closesOn: "2026-12-20" });
    expect(returnWindow({ merchant: "Best Buy", purchasedOn: "2026-11-20", returnDays: 0 }, "2026-11-20").open).toBe(false);
    expect(returnWindow({ merchant: "Best Buy", purchasedOn: "2026-10-01", returnDays: null }, "2026-11-30").open).toBe(false);
    expect(returnWindow({ merchant: "Corner Shop", purchasedOn: "2026-11-20", returnDays: null }, "2026-11-30")).toMatchObject({ source: null, closesOn: null, open: false });
    expect(returnWindow({ merchant: "Amazon", purchasedOn: null, returnDays: null }, "2026-11-30").closesOn).toBeNull();
  });
  const r = (p: Partial<ReturnAlertReceipt> = {}): ReturnAlertReceipt => ({
    id: "r1",
    merchant: "Amazon",
    purchasedOn: "2026-11-01",
    returnDays: null,
    total: 89.99,
    currency: "USD",
    warrantyUntil: null,
    returned: false,
    itemCategories: ["shopping"],
    ...p,
  });
  it("alerts when ≤ 3 days are left, once per window, not for groceries / small / returned", () => {
    const a = returnWindowAlerts([r()], "2026-11-28"); // closes Dec 1
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("return_window:r1:2026-12-01");
    expect(a[0].title).toContain("in 3 days");
    expect(returnWindowAlerts([r()], "2026-11-27")).toHaveLength(0);
    expect(returnWindowAlerts([r({ returned: true })], "2026-11-28")).toHaveLength(0);
    expect(returnWindowAlerts([r({ total: 12 })], "2026-11-28")).toHaveLength(0);
    expect(returnWindowAlerts([r({ itemCategories: ["groceries", "groceries"] })], "2026-11-28")).toHaveLength(0);
    expect(returnWorthReminding({ total: 40, currency: "USD", itemCategories: [] })).toBe(true);
  });
  it("warranty ending within 30 days alerts once", () => {
    const a = returnWindowAlerts([r({ purchasedOn: "2025-01-01", warrantyUntil: "2026-12-20" })], "2026-11-28");
    expect(a.map((x) => x.kind)).toEqual(["warranty"]);
    expect(a[0].dedupeKey).toBe("warranty:r1:2026-12-20");
    expect(returnWindowAlerts([r({ purchasedOn: "2025-01-01", warrantyUntil: "2027-06-01" })], "2026-11-28")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- price tracker

describe("item price tracker", () => {
  const item = (p: Partial<PriceItemInput>): PriceItemInput => ({
    receiptId: "r",
    merchant: "Kroger",
    purchasedOn: "2026-08-03",
    name: "Large Eggs 12ct",
    quantity: null,
    unitPrice: null,
    lineTotal: 3.49,
    currency: "USD",
    ...p,
  });
  it("normalizes names and unit prices", () => {
    expect(normalizeItemName("LARGE EGGS 12CT  #0004125")).toBe("large eggs 12ct #0004125".replace(" #0004125", ""));
    expect(normalizeItemName("Milk, 2% 1gal 0007874235")).toBe("milk 2% 1gal");
    expect(unitPriceOf({ quantity: 2, unitPrice: null, lineTotal: 7 })).toBe(3.5);
    expect(unitPriceOf({ quantity: 2, unitPrice: 3.25, lineTotal: 6.5 })).toBe(3.25);
    expect(unitPriceOf({ quantity: null, unitPrice: null, lineTotal: -1 })).toBeNull();
  });
  it("tracks the same item across dates and reports the change", () => {
    const tracks = priceTracks([
      item({ purchasedOn: "2026-08-03", lineTotal: 3.49 }),
      item({ purchasedOn: "2026-09-10", lineTotal: 3.79, receiptId: "r2" }),
      item({ purchasedOn: "2026-11-02", lineTotal: 4.12, receiptId: "r3", name: "LARGE EGGS 12CT" }),
      item({ purchasedOn: "2026-11-02", name: "Bread", lineTotal: 2.5 }),
      item({ purchasedOn: "2026-11-02", name: "Large Eggs 12ct", currency: "INR", lineTotal: 90 }),
    ]);
    expect(tracks).toHaveLength(1);
    const t = tracks[0];
    expect(t.points.map((p) => p.unitPrice)).toEqual([3.49, 3.79, 4.12]);
    expect(t.changePct).toBe(18.1);
    expect(priceHeadline(t)).toBe("LARGE EGGS 12CT up 18% since August");
    expect(priceHeadline({ ...t, changePct: -5, since: "2025-03-01" })).toBe("LARGE EGGS 12CT down 5% since March 2025");
  });
  it("needs two different dates; same-day duplicates keep the lowest price", () => {
    expect(priceTracks([item({}), item({ lineTotal: 3.99 })])).toHaveLength(0);
    const t = priceTracks([item({ lineTotal: 3.99 }), item({ lineTotal: 3.49 }), item({ purchasedOn: "2026-09-01", lineTotal: 3.49 })]);
    expect(t[0].points[0].unitPrice).toBe(3.49);
    expect(t[0].changePct).toBe(0);
  });
});

// ---------------------------------------------------------------- tax + tags + splits

describe("tax helpers", () => {
  it("suggests HSA/FSA-eligible pharmacy items, not snacks", () => {
    expect(suggestHsaFsa({ name: "Advil Ibuprofen 200mg", category: "health" }, "CVS")).toBe(true);
    expect(suggestHsaFsa({ name: "Band-Aid Flexible Fabric", category: "shopping" }, "Target")).toBe(true);
    expect(suggestHsaFsa({ name: "Neutrogena Sunscreen SPF 50", category: "shopping" }, "Walmart")).toBe(true);
    expect(suggestHsaFsa({ name: "Vitamin water", category: "health" }, "Walgreens")).toBe(true);
    expect(suggestHsaFsa({ name: "Doritos", category: "groceries" }, "CVS")).toBe(false);
    expect(suggestHsaFsa({ name: "Phone charger", category: "shopping" }, "Best Buy")).toBe(false);
    expect(isTaxTag("hsa-fsa")).toBe(true);
    expect(isTaxTag("vacation")).toBe(false);
  });
});

describe("tags, notes and splits", () => {
  it("normalizes tags", () => {
    expect(normalizeTags(["  Tax Deductible ", "#Business", "business", "Trip: NYC!", ""])).toEqual(["tax-deductible", "business", "trip-nyc"]);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
    expect(normalizeTags(["x".repeat(50)])[0]).toHaveLength(30);
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote("a".repeat(600))).toHaveLength(500);
  });
  it("a split must add up, have 2+ parts and 2+ known categories", () => {
    expect(validateSplit(100, [{ category: "groceries", amount: 60 }, { category: "shopping", amount: 40 }])).toEqual([
      { category: "groceries", amount: 60 },
      { category: "shopping", amount: 40 },
    ]);
    expect(validateSplit(100, [{ category: "groceries", amount: 33.33 }, { category: "shopping", amount: 33.33 }, { category: "groceries", amount: 33.34 }])).toEqual([
      { category: "groceries", amount: 66.67 },
      { category: "shopping", amount: 33.33 },
    ]);
    const bad = (amount: number, parts: Array<{ category: string; amount: number }>, msg: string) => {
      expect(() => validateSplit(amount, parts)).toThrow(SplitError);
      expect(() => validateSplit(amount, parts)).toThrow(msg);
    };
    bad(100, [{ category: "groceries", amount: 60 }, { category: "shopping", amount: 30 }], "split_must_add_up");
    bad(100, [{ category: "groceries", amount: 100 }], "split_needs_2_to_10_parts");
    bad(100, [{ category: "groceries", amount: 50 }, { category: "groceries", amount: 50 }], "split_needs_2_categories");
    bad(100, [{ category: "nope", amount: 50 }, { category: "groceries", amount: 50 }], "invalid_category");
    bad(100, [{ category: "shopping", amount: 110 }, { category: "groceries", amount: -10 }], "split_amount_must_be_positive");
  });
  it("non-spend split parts fold into the transaction's category for spend views", () => {
    expect(spendSplitParts("shopping", [{ category: "transfers", amount: 20 }, { category: "groceries", amount: 30 }, { category: "shopping", amount: 50 }])).toEqual([
      { category: "shopping", amount: 70 },
      { category: "groceries", amount: 30 },
    ]);
  });
});

// ---------------------------------------------------------------- statement due-date extraction

describe("card statement payment fields", () => {
  const stmt = `CHASE FREEDOM UNLIMITED
Account number ending in 4321
Opening/Closing Date 10/16/26 - 11/15/26
Previous Balance $1,050.00
New Balance $1,240.18
Minimum Payment Due $40.00
Payment Due Date 12/10/26
Credit Limit $5,000   Available Credit $3,759
ACCOUNT ACTIVITY
10/20 STARBUCKS STORE 1234 SEATTLE WA 6.45
10/22 AMAZON.COM*AB12 AMZN.COM/BILL WA 183.73
`;
  it("rules parser reads due date, minimum due and credit limit", () => {
    const r = parseStatementText(stmt, { country: "US", kinds: ["credit_card"] });
    expect(r.accountKind).toBe("credit_card");
    expect(r.dueDate).toBe("2026-12-10");
    expect(r.minimumDue).toBe(40);
    expect(r.creditLimit).toBe(5000);
    expect(r.totalDue).toBe(1240.18);
    expect(r.txns).toHaveLength(2);
  });
  it("bank statements don't get card fields", () => {
    const r = parseStatementText("Date  Description  Debit  Credit  Balance\nOpening Balance 1,000.00\n11/02/2026 COFFEE 5.00  995.00\n", { country: "US", kinds: ["bank"] });
    expect(r.dueDate).toBeUndefined();
  });
  it("LLM output carries the card fields (bad dates become null)", () => {
    const base = { accountKind: "credit_card", currency: "USD", transactions: [{ date: "2026-11-01", description: "X", amount: 5, direction: "debit" }] };
    const v = validateStatementInput({ ...base, dueDate: "2026-12-10", minimumDue: 40, creditLimit: 5000 });
    expect(v).toMatchObject({ dueDate: "2026-12-10", minimumDue: 40, creditLimit: 5000 });
    expect(validateStatementInput({ ...base, dueDate: "Dec 10" }).dueDate).toBeNull();
    expect(validateStatementInput({ ...base, accountKind: "bank", dueDate: "2026-12-10" }).dueDate).toBeUndefined();
  });
});
