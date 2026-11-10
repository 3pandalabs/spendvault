import { describe, expect, it } from "vitest";
import { classifyFee } from "../../src/lib/insights/fees.js";
import { detectRecurring } from "../../src/lib/insights/recurring.js";
import { addDays } from "../../src/lib/insights/util.js";
import { monthly, txn } from "./helpers.js";

describe("detectRecurring", () => {
  it("detects monthly charges", () => {
    const r = detectRecurring(monthly("Spotify", "subscriptions", "2026-07", [119, 119, 119, 119]), "INR", "2026-10-20");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ merchant: "Spotify", cadence: "monthly", monthlyAmount: 119, annualCost: 1428, occurrences: 4, priceChanged: false, active: true });
  });

  it("detects weekly charges and normalizes to monthly", () => {
    const rows = Array.from({ length: 5 }, (_, i) => txn({ postedOn: addDays("2026-09-01", i * 7), amount: 300, merchant: "Milk Basket", category: "groceries" }));
    const r = detectRecurring(rows, "INR", "2026-10-05");
    expect(r[0].cadence).toBe("weekly");
    expect(r[0].monthlyAmount).toBe(1300);
  });

  it("detects yearly charges from 2 occurrences", () => {
    const rows = [
      txn({ postedOn: "2025-09-10", amount: 1499, merchant: "Amazon Prime", category: "subscriptions" }),
      txn({ postedOn: "2026-09-12", amount: 1499, merchant: "Amazon Prime", category: "subscriptions" }),
    ];
    const r = detectRecurring(rows, "INR", "2026-10-01");
    expect(r[0]).toMatchObject({ cadence: "yearly", monthlyAmount: 124.92 });
  });

  it("tolerates ±15% amount drift but not irregular spend", () => {
    expect(detectRecurring(monthly("Airtel", "telecom", "2026-06", [1000, 1100, 900, 1050]), "INR", "2026-09-20")).toHaveLength(1);
    expect(detectRecurring(monthly("Airtel", "telecom", "2026-06", [1000, 2500, 400, 1050]), "INR", "2026-09-20")).toHaveLength(0);
    const irregular = [1, 2, 4, 9, 10, 15, 21].map((d, i) => txn({ postedOn: `2026-10-${String(d).padStart(2, "0")}`, amount: 300 + i * 40, merchant: "Swiggy", category: "food_delivery" }));
    expect(detectRecurring(irregular, "INR", "2026-10-25")).toHaveLength(0);
  });

  it("detects a price step as recurring with priceChanged", () => {
    const r = detectRecurring(monthly("Netflix", "subscriptions", "2026-04", [649, 649, 649, 799, 799]), "INR", "2026-08-20");
    expect(r[0]).toMatchObject({ priceChanged: true, previousTypical: 649, latestAmount: 799, latestPriceSince: "2026-07-05", monthlyAmount: 799 });
  });

  it("2 monthly charges count only for the subscriptions category", () => {
    expect(detectRecurring(monthly("Notion", "subscriptions", "2026-08", [800, 800]), "INR", "2026-09-20")).toHaveLength(1);
    expect(detectRecurring(monthly("Gym", "health", "2026-08", [800, 800]), "INR", "2026-09-20")).toHaveLength(0);
  });

  it("marks stale subscriptions inactive", () => {
    const r = detectRecurring(monthly("Spotify", "subscriptions", "2026-01", [119, 119, 119]), "INR", "2026-10-20");
    expect(r[0].active).toBe(false);
  });
});

describe("classifyFee", () => {
  it.each([
    ["LATE PAYMENT FEE", "late_fee"],
    ["IGST ON LATE PAYMENT FEE", "gst_on_fees"],
    ["CGST @9%", "gst_on_fees"],
    ["FINANCE CHARGES", "interest"],
    ["INTEREST CHARGED ON REVOLVING BALANCE", "interest"],
    ["CROSS CURRENCY MARKUP", "forex"],
    ["FOREIGN CURRENCY TRANSACTION FEE", "forex"],
    ["ANNUAL FEE", "annual_fee"],
    ["CASH ADVANCE FEE", "cash_advance"],
    ["SMS CHARGES", "other"],
  ])("%s → %s", (desc, type) => {
    expect(classifyFee(desc)).toBe(type);
  });
});
