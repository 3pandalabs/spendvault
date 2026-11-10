import { describe, expect, it } from "vitest";
import { buildDigest } from "../../src/lib/insights/digest.js";
import { computeSavings } from "../../src/lib/insights/savings.js";
import { monthly, txn } from "./helpers.js";

const today = "2026-11-10";
const rows = [
  // Subscriptions: two music services + Netflix with a price hike.
  ...monthly("Spotify", "subscriptions", "2026-05", [119, 119, 119, 119, 119, 119, 119], 3),
  ...monthly("YouTube Premium", "subscriptions", "2026-05", [149, 149, 149, 149, 149, 149, 149], 8),
  ...monthly("Netflix", "subscriptions", "2026-05", [649, 649, 649, 649, 649, 799, 799], 5),
  // Food delivery: ~₹12k/month, last complete month (Oct) ₹20k.
  // Two orders a month so these don't look like monthly subscriptions.
  ...monthly("Swiggy", "food_delivery", "2026-04", [6000, 6000, 6000, 6000, 6000, 6000, 10000], 5),
  ...monthly("Swiggy", "food_delivery", "2026-04", [6000, 6000, 6000, 6000, 6000, 6000, 10000], 15),
  // Shopping: ₹4k/month, Oct ₹10k including a ₹2k double charge.
  ...monthly("Myntra", "shopping", "2026-04", [2000, 2000, 2000, 2000, 2000, 2000, 3000], 10),
  ...monthly("Myntra", "shopping", "2026-04", [2000, 2000, 2000, 2000, 2000, 2000, 3000], 20),
  txn({ postedOn: "2026-10-21", amount: 2000, merchant: "Amazon" }),
  txn({ postedOn: "2026-10-22", amount: 2000, merchant: "Amazon" }),
  // Fees.
  txn({ postedOn: "2026-10-03", amount: 750, category: "fees_charges", merchant: "Bank fee/charge", descriptionRaw: "LATE PAYMENT FEE" }),
  txn({ postedOn: "2026-10-03", amount: 135, category: "fees_charges", merchant: "Bank fee/charge", descriptionRaw: "IGST ON LATE PAYMENT FEE" }),
  // Recurring but not a subscription: rent is never listed.
  ...monthly("Landlord", "rent", "2026-04", [30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000], 1),
  // Not spend.
  ...monthly("Card bill payment", "card_payment", "2026-04", [50000, 50000, 50000, 50000, 50000, 50000, 50000], 25),
];

describe("computeSavings", () => {
  const s = computeSavings({ txns: rows, currency: "INR", today });

  it("lists active subscriptions with price changes", () => {
    expect(s.subscriptions.map((x) => x.merchant)).toEqual(["Netflix", "YouTube Premium", "Spotify"]);
    expect(s.subscriptions[0]).toMatchObject({ monthlyAmount: 799, annualCost: 9588, priceChanged: true, cadence: "monthly" });
  });

  it("summarizes fees and duplicates", () => {
    expect(s.fees.totalLast12Months).toBe(885);
    expect(s.fees.items.map((i) => i.type)).toEqual(["late_fee", "gst_on_fees"]);
    expect(s.duplicates).toHaveLength(1);
    expect(s.duplicates[0]).toMatchObject({ merchant: "Amazon", amount: 2000, dates: ["2026-10-21", "2026-10-22"] });
  });

  it("produces tips sorted by monthly saving", () => {
    const savings = s.tips.map((t) => t.monthlySaving);
    expect([...savings].sort((a, b) => b - a)).toEqual(savings);
    const ids = s.tips.map((t) => t.id);
    expect(ids).toContain("subscription_overlap:music");
    expect(ids).toContain("price_hike:netflix");
    expect(ids).toContain("fee:late_fee");
    expect(ids).toContain("category:food_delivery");
    expect(ids).toContain("card:food_delivery");
    expect(ids).not.toContain("category:subscriptions");
    expect(ids).not.toContain("category:fees_charges");
  });

  it("does not double count", () => {
    const byId = Object.fromEntries(s.tips.map((t) => [t.id, t.monthlySaving]));
    expect(byId["subscription_overlap:music"]).toBe(119); // keep YouTube Premium, drop Spotify
    expect(byId["price_hike:netflix"]).toBe(150);
    expect(byId["fee:late_fee"]).toBe(73.75); // (750 + 135 GST) / 12
    expect(byId["category:food_delivery"]).toBe(8000);
    // Shopping Oct ₹10k vs avg ₹4k = ₹6k over, minus the ₹2k duplicate already claimed.
    expect(byId["category:shopping"]).toBe(4000);
    // Card tip: 3-month avg ₹14,667, but the nudge brings food delivery back to ₹12,000 → 5% of that.
    expect(byId["card:food_delivery"]).toBe(600);
    expect(s.estimatedMonthlySavings).toBe(Math.round(s.tips.reduce((a, t) => a + t.monthlySaving, 0) * 100) / 100);
    const card = s.tips.find((t) => t.kind === "card")!;
    expect(card.body).not.toMatch(/HDFC|SBI|Amex|ICICI|Axis/);
  });

  it("returns empty sections for no data", () => {
    const e = computeSavings({ txns: [], currency: "INR", today });
    expect(e).toEqual({ estimatedMonthlySavings: 0, subscriptions: [], fees: { totalLast12Months: 0, items: [] }, duplicates: [], tips: [] });
  });
});

describe("buildDigest", () => {
  it("escapes HTML and links to alerts", () => {
    const m = buildDigest("a@b.c", "Anil Kumar", [{ title: "<b>x</b>", body: "₹1,000 & more" }], "https://x/alerts");
    expect(m.subject).toBe("SpendVault: <b>x</b>");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(m.html).toContain("₹1,000 &amp; more");
    expect(m.text).toContain("Hi Anil,");
    expect(m.text).toContain("https://x/alerts");
  });
});
