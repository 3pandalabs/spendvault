import { describe, expect, it } from "vitest";
import { detectSpikes, type AlertCandidate } from "../../src/lib/insights/spikes.js";
import { addDays } from "../../src/lib/insights/util.js";
import type { Txn } from "../../src/lib/insights/util.js";
import { monthly, txn } from "./helpers.js";

const of = (xs: AlertCandidate[], kind: AlertCandidate["kind"]) => xs.filter((x) => x.kind === kind);
const run = (txns: Txn[], today: string, currency = "INR") => detectSpikes({ txns, currency, today });

describe("category_spike", () => {
  const history = monthly("Swiggy", "food_delivery", "2026-05", [6000, 6500, 5800, 6200, 6100, 6400], 12);

  it("flags a month well above the median", () => {
    const a = of(run([...history, txn({ postedOn: "2026-11-08", amount: 15000, merchant: "Swiggy", category: "food_delivery" })], "2026-11-20"), "category_spike");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("category_spike:food_delivery:2026-11");
    expect(a[0].baseline).toBe(6150);
    expect(a[0].amount).toBe(15000);
    expect(a[0].title).toBe("Food delivery is up 144% in November");
    expect(a[0].body).toContain("₹15,000");
    expect(a[0].body).toContain("so far");
    expect(a[0].periodStart).toBe("2026-11-01");
  });

  it("does not flag a modest rise", () => {
    expect(of(run([...history, txn({ postedOn: "2026-11-08", amount: 8000, merchant: "Swiggy", category: "food_delivery" })], "2026-11-20"), "category_spike")).toHaveLength(0);
  });

  it("does not pro-rate the in-progress month", () => {
    // ₹7,000 by the 10th would pro-rate to ₹21,000, but MTD is under the full-month threshold.
    expect(of(run([...history, txn({ postedOn: "2026-11-05", amount: 7000, merchant: "Swiggy", category: "food_delivery" })], "2026-11-10"), "category_spike")).toHaveLength(0);
  });

  it("requires the ₹1,000 absolute minimum", () => {
    const small = monthly("Chai Point", "dining", "2026-05", [100, 110, 90, 100, 105, 95], 12);
    expect(of(run([...small, txn({ postedOn: "2026-11-08", amount: 900, merchant: "Chai Point", category: "dining" })], "2026-11-20"), "category_spike")).toHaveLength(0);
  });

  it("needs at least 2 prior months with spend in the category", () => {
    const rows = [
      ...monthly("DMart", "groceries", "2026-08", [3000, 3000, 3000], 3),
      txn({ postedOn: "2026-10-12", amount: 1000, merchant: "Swiggy", category: "food_delivery" }),
      txn({ postedOn: "2026-11-08", amount: 15000, merchant: "Swiggy", category: "food_delivery" }),
    ];
    expect(of(run(rows, "2026-11-20"), "category_spike")).toHaveLength(0);
  });

  it("ignores NON_SPEND categories", () => {
    const rows = [
      ...monthly("Card bill payment", "card_payment", "2026-05", [10000, 10000, 10000, 10000, 10000, 10000], 12),
      txn({ postedOn: "2026-11-08", amount: 90000, merchant: "Card bill payment", category: "card_payment" }),
    ];
    expect(run(rows, "2026-11-20")).toHaveLength(0);
  });
});

describe("daily_spike", () => {
  const today = "2026-11-20";
  const steady = Array.from({ length: 100 }, (_, i) => txn({ postedOn: addDays(today, -100 + i), amount: 500, merchant: "Kirana", category: "groceries" }));

  it("flags a day far above the 90-day median", () => {
    const a = of(run([...steady, txn({ postedOn: "2026-11-15", amount: 4800, merchant: "Croma", category: "shopping" })], today), "daily_spike");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("daily_spike:2026-11-15");
    expect(a[0].amount).toBe(5300);
    expect(a[0].baseline).toBe(500);
    expect(a[0].body).toContain("Biggest: Croma ₹4,800");
  });

  it("ignores days under ₹2,000 and days older than 14 days", () => {
    expect(of(run([...steady, txn({ postedOn: "2026-11-15", amount: 1400, merchant: "X", category: "shopping" })], today), "daily_spike")).toHaveLength(0);
    expect(of(run([...steady, txn({ postedOn: "2026-11-01", amount: 9000, merchant: "X", category: "shopping" })], today), "daily_spike")).toHaveLength(0);
  });

  it("does not double-alert a day explained by a large new-merchant charge", () => {
    const a = run([...steady, txn({ postedOn: "2026-11-15", amount: 45000, merchant: "Croma", category: "shopping" })], today);
    expect(of(a, "large_new_merchant")).toHaveLength(1);
    expect(of(a, "daily_spike")).toHaveLength(0);
  });

  it("needs 30 days of history and skips rent", () => {
    const short = steady.slice(-20);
    expect(of(run([...short, txn({ postedOn: "2026-11-15", amount: 9000, merchant: "X", category: "shopping" })], today), "daily_spike")).toHaveLength(0);
    expect(of(run([...steady, txn({ postedOn: "2026-11-15", amount: 30000, merchant: "Landlord", category: "rent" })], today), "daily_spike")).toHaveLength(0);
  });
});

describe("large_new_merchant", () => {
  const today = "2026-11-20";
  const steady = Array.from({ length: 30 }, (_, i) => txn({ postedOn: addDays(today, -120 + i * 4), amount: 400, merchant: "Swiggy", category: "food_delivery" }));

  it("flags a big first-time charge", () => {
    const big = txn({ postedOn: "2026-11-10", amount: 45000, merchant: "Croma", category: "shopping" });
    const a = of(run([...steady, big], today), "large_new_merchant");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe(`large_new_merchant:${big.id}`);
    expect(a[0].title).toBe("₹45,000 at Croma, a new merchant");
  });

  it("skips merchants seen in the prior 180 days, small charges, and thin history", () => {
    const seen = txn({ postedOn: "2026-08-01", amount: 300, merchant: "Croma", category: "shopping" });
    expect(of(run([...steady, seen, txn({ postedOn: "2026-11-10", amount: 45000, merchant: "Croma", category: "shopping" })], today), "large_new_merchant")).toHaveLength(0);
    expect(of(run([...steady, txn({ postedOn: "2026-11-10", amount: 4000, merchant: "Croma", category: "shopping" })], today), "large_new_merchant")).toHaveLength(0);
    expect(of(run([...steady.slice(-5), txn({ postedOn: "2026-11-10", amount: 45000, merchant: "Croma", category: "shopping" })], today), "large_new_merchant")).toHaveLength(0);
  });
});

describe("price_hike", () => {
  it("flags a recurring charge that went up ≥10% and ≥₹50", () => {
    const rows = monthly("Netflix", "subscriptions", "2026-05", [649, 649, 649, 649, 649, 799], 5);
    const a = of(run(rows, "2026-10-20"), "price_hike");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("price_hike:netflix:2026-10");
    expect(a[0].body).toContain("up from a typical ₹649 (+23%)");
    expect(a[0].body).toContain("₹1,800 more a year");
  });

  it("ignores non-subscription recurring charges", () => {
    const rows = monthly("Toit Brewpub", "dining", "2026-05", [2000, 2000, 2000, 2000, 2000, 2600], 5);
    expect(of(run(rows, "2026-10-20"), "price_hike")).toHaveLength(0);
  });

  it("ignores small changes", () => {
    const rows = monthly("Netflix", "subscriptions", "2026-05", [649, 649, 649, 649, 649, 669], 5);
    expect(of(run(rows, "2026-10-20"), "price_hike")).toHaveLength(0);
  });
});

describe("fee", () => {
  it("groups the month's fees with a breakdown", () => {
    const rows = [
      txn({ postedOn: "2026-11-03", amount: 750, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "LATE PAYMENT FEE" }),
      txn({ postedOn: "2026-11-03", amount: 135, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "IGST ON LATE PAYMENT FEE" }),
      txn({ postedOn: "2026-11-03", amount: 295, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "FINANCE CHARGES" }),
    ];
    const a = of(run(rows, "2026-11-10"), "fee");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("fee:2026-11");
    expect(a[0].body).toBe(
      "₹1,180 in fees and interest in November 2026: late fee ₹750, interest ₹295, GST ₹135. Paying the full amount due on time avoids most of these.",
    );
  });

  it("ignores tiny or old fees", () => {
    expect(of(run([txn({ postedOn: "2026-11-03", amount: 59, category: "fees_charges", descriptionRaw: "SMS CHARGE" })], "2026-11-10"), "fee")).toHaveLength(0);
    expect(of(run([txn({ postedOn: "2026-08-03", amount: 590, category: "fees_charges", descriptionRaw: "ANNUAL FEE" })], "2026-11-10"), "fee")).toHaveLength(0);
  });
});

describe("duplicate", () => {
  const today = "2026-11-10";
  it("flags same merchant + amount + account within 2 days", () => {
    const a1 = txn({ postedOn: "2026-11-03", amount: 2499, merchant: "Amazon" });
    const a2 = txn({ postedOn: "2026-11-04", amount: 2499, merchant: "Amazon" });
    const a = of(run([a1, a2], today), "duplicate");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe(`duplicate:${a1.id}:${a2.id}`);
    expect(a[0].body).toContain("₹2,499 at Amazon on 3 Nov and 4 Nov 2026");
  });

  it("skips different accounts, far-apart dates, alert-vs-statement pairs and subscriptions", () => {
    expect(of(run([txn({ postedOn: "2026-11-03", amount: 2499, merchant: "Amazon" }), txn({ postedOn: "2026-11-04", amount: 2499, merchant: "Amazon", accountId: "acct-2" })], today), "duplicate")).toHaveLength(0);
    expect(of(run([txn({ postedOn: "2026-11-01", amount: 2499, merchant: "Amazon" }), txn({ postedOn: "2026-11-04", amount: 2499, merchant: "Amazon" })], today), "duplicate")).toHaveLength(0);
    expect(of(run([txn({ postedOn: "2026-11-03", amount: 2499, merchant: "Amazon", sourceKind: "alert" }), txn({ postedOn: "2026-11-03", amount: 2499, merchant: "Amazon" })], today), "duplicate")).toHaveLength(0);
    // Spotify is a known recurring charge; two on consecutive days is not flagged.
    const subs = [...monthly("Spotify", "subscriptions", "2026-07", [299, 299, 299, 299], 3), txn({ postedOn: "2026-10-04", amount: 299, merchant: "Spotify", category: "subscriptions" })];
    expect(of(run(subs, "2026-10-20"), "duplicate")).toHaveLength(0);
  });
});
