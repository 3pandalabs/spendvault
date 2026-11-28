import { describe, expect, it } from "vitest";
import { budgetAlerts, budgetLines, niceCeil, statusOf, suggestBudgets } from "../../src/lib/insights/budgets.js";
import { classifyFee } from "../../src/lib/insights/fees.js";
import { computeNetWorth } from "../../src/lib/insights/networth.js";
import { detectRecurring, expectedChargesBetween, nextChargeAfter } from "../../src/lib/insights/recurring.js";
import { computeSafeToSpend, trailingIncome } from "../../src/lib/insights/safeToSpend.js";
import { detectSpikes } from "../../src/lib/insights/spikes.js";
import { computeSubscriptions, newSubscriptionAlerts } from "../../src/lib/insights/subscriptions.js";
import { addDays } from "../../src/lib/insights/util.js";
import { categorize } from "../../src/lib/categories.js";
import { monthly, txn } from "./helpers.js";

const USD = "USD";
const u = (p: Parameters<typeof txn>[0]) => txn({ currency: USD, ...p });
const usdMonthly = (merchant: string, category: string, start: string, amounts: number[], day = 5) =>
  monthly(merchant, category, start, amounts, day).map((t) => ({ ...t, currency: USD }));

/** Filler so there is history before a subscription starts. */
const filler = (from: string, months: number, amount = 40) =>
  Array.from({ length: months }, (_, i) => u({ postedOn: addDays(from, i * 30), amount, merchant: `Corner Store`, category: "groceries" }));

// ---------------------------------------------------------------- subscriptions

describe("recurring: next expected charge", () => {
  it("monthly keeps the day of month, clamped to short months", () => {
    expect(nextChargeAfter("2026-01-31", "monthly", 30)).toBe("2026-02-28");
    expect(nextChargeAfter("2026-10-05", "monthly", 30)).toBe("2026-11-05");
    expect(nextChargeAfter("2026-12-15", "monthly", 30)).toBe("2027-01-15");
  });
  it("yearly is the same date next year; weekly uses the interval", () => {
    expect(nextChargeAfter("2025-11-20", "yearly", 365)).toBe("2026-11-20");
    expect(nextChargeAfter("2026-11-02", "weekly", 7)).toBe("2026-11-09");
  });
  it("detectRecurring exposes first/next dates", () => {
    const [r] = detectRecurring(usdMonthly("Netflix", "subscriptions", "2026-07", [15.49, 15.49, 15.49, 15.49], 12), USD, "2026-11-01");
    expect(r).toMatchObject({ firstChargedOn: "2026-07-12", lastChargedOn: "2026-10-12", nextExpectedOn: "2026-11-12", intervalDays: 31 });
    expect(expectedChargesBetween(r, "2026-11-01", "2026-11-30")).toEqual(["2026-11-12"]);
    expect(expectedChargesBetween(r, "2026-11-01", "2027-01-31")).toEqual(["2026-11-12", "2026-12-12", "2027-01-12"]);
  });
});

describe("computeSubscriptions", () => {
  it("lists active subscription-like charges with monthly + yearly cost and a price-increase flag", () => {
    const txns = [
      ...usdMonthly("Spotify", "subscriptions", "2026-05", [10.99, 10.99, 10.99, 11.99, 11.99, 11.99], 3),
      ...usdMonthly("Landlord LLC", "rent", "2026-05", [2000, 2000, 2000, 2000, 2000, 2000], 1),
    ];
    const s = computeSubscriptions({ txns, currency: USD, today: "2026-11-10" });
    expect(s.items.map((x) => x.merchant)).toEqual(["Spotify"]); // rent recurs but isn't a subscription
    expect(s.items[0]).toMatchObject({ amount: 11.99, monthlyAmount: 11.99, annualCost: 143.88, nextExpectedOn: "2026-11-03", isNew: false });
    expect(s.monthlyTotal).toBe(11.99);
    expect(s.yearlyTotal).toBe(143.88);
  });

  it("drops subscriptions that stopped charging", () => {
    const s = computeSubscriptions({ txns: usdMonthly("Hulu", "subscriptions", "2026-01", [7.99, 7.99, 7.99]), currency: USD, today: "2026-11-10" });
    expect(s.items).toHaveLength(0);
  });
});

describe("newSubscriptionAlerts", () => {
  const today = "2026-11-20";
  it("flags a recurring subscription that started recently, once per merchant", () => {
    const txns = [...filler("2026-05-01", 6), ...usdMonthly("Disney Plus", "subscriptions", "2026-09", [13.99, 13.99, 13.99], 8)];
    const recurring = detectRecurring(txns, USD, today);
    const alerts = newSubscriptionAlerts({ txns, currency: USD, today, recurring });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "new_subscription", dedupeKey: "new_subscription:disney plus", merchant: "Disney Plus", amount: 13.99 });
    expect(alerts[0].body).toContain("Dec");
  });

  it("flags a first charge from a never-seen subscription merchant (trial converted)", () => {
    const txns = [...filler("2026-06-01", 5), u({ postedOn: "2026-11-15", amount: 9.99, merchant: "Paramount+", category: "subscriptions" })];
    const alerts = newSubscriptionAlerts({ txns, currency: USD, today, recurring: detectRecurring(txns, USD, today) });
    expect(alerts.map((a) => a.dedupeKey)).toEqual(["new_subscription:paramount+"]);
  });

  it("stays quiet on a first upload (no history before the first charge) and for old subscriptions", () => {
    const fresh = usdMonthly("Disney Plus", "subscriptions", "2026-09", [13.99, 13.99, 13.99], 8);
    expect(newSubscriptionAlerts({ txns: fresh, currency: USD, today, recurring: detectRecurring(fresh, USD, today) })).toHaveLength(0);
    const old = [...filler("2025-12-01", 4), ...usdMonthly("Netflix", "subscriptions", "2026-01", Array(11).fill(15.49), 8)];
    expect(newSubscriptionAlerts({ txns: old, currency: USD, today, recurring: detectRecurring(old, USD, today) })).toHaveLength(0);
  });

  it("is wired into detectSpikes", () => {
    const txns = [...filler("2026-05-01", 6), ...usdMonthly("Disney Plus", "subscriptions", "2026-09", [13.99, 13.99, 13.99], 8)];
    expect(detectSpikes({ txns, currency: USD, today }).some((a) => a.kind === "new_subscription")).toBe(true);
  });
});

// ---------------------------------------------------------------- fees

describe("card fee & hidden charge classification", () => {
  it.each([
    ["LATE PAYMENT FEE", "late_fee"],
    ["INTEREST CHARGE ON PURCHASES", "interest"],
    ["FINANCE CHARGE", "interest"],
    ["FOREIGN TRANSACTION FEE", "forex"],
    ["ANNUAL MEMBERSHIP FEE", "annual_fee"],
    ["OVERLIMIT FEE", "overlimit"],
    ["OVER-LIMIT CHARGE", "overlimit"],
    ["ATM FEE NON-NETWORK", "atm_fee"],
    ["ATM SURCHARGE", "atm_fee"],
    ["OVERDRAFT FEE", "overdraft"],
    ["RETURNED PAYMENT FEE", "overdraft"],
    ["NSF FEE", "overdraft"],
    ["CASH ADVANCE FEE", "cash_advance"],
  ])("%s → %s", (desc, type) => {
    expect(classifyFee(desc)).toBe(type);
  });

  it.each(["ATM FEE", "OVERDRAFT FEE", "FOREIGN TRANSACTION FEE", "MONTHLY SERVICE FEE", "RETURNED PAYMENT FEE"])(
    "%s is categorized as a fee (not cash or shopping)",
    (desc) => {
      expect(categorize(desc, "debit").category).toBe("fees_charges");
    },
  );

  it("fee alerts total the month by type", () => {
    const today = "2026-11-20";
    const txns = [
      u({ postedOn: "2026-11-03", amount: 39, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "LATE PAYMENT FEE" }),
      u({ postedOn: "2026-11-03", amount: 3.5, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "ATM FEE" }),
      u({ postedOn: "2026-11-04", amount: 2.1, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "FOREIGN TRANSACTION FEE" }),
    ];
    const fee = detectSpikes({ txns, currency: USD, today }).find((a) => a.kind === "fee")!;
    expect(fee.amount).toBe(44.6);
    expect(fee.body).toContain("late fee $39");
    expect(fee.body).toContain("ATM fee $3.50");
    expect(fee.data).toMatchObject({ types: { late_fee: 39, atm_fee: 3.5, forex: 2.1 } });
  });
});

// ---------------------------------------------------------------- budgets

describe("budgets", () => {
  const month = "2026-11";
  const txns = [
    u({ postedOn: "2026-11-02", amount: 180, merchant: "Whole Foods", category: "groceries" }),
    u({ postedOn: "2026-11-09", amount: 150, merchant: "Whole Foods", category: "groceries" }),
    u({ postedOn: "2026-11-10", amount: 85, merchant: "Chipotle", category: "dining" }),
    u({ postedOn: "2026-11-11", amount: 20, merchant: "Chipotle", category: "income", direction: "credit" }), // refund nets
    u({ postedOn: "2026-10-20", amount: 999, merchant: "Whole Foods", category: "groceries" }), // other month
  ];

  it("progress uses month spend with refunds netted; status ok / near / over", () => {
    const lines = budgetLines(txns, USD, month, [
      { category: "groceries", amount: 300 },
      { category: "dining", amount: 80 },
      { category: "shopping", amount: 200 },
    ]);
    expect(lines.map((l) => [l.category, l.spent, l.status])).toEqual([
      ["groceries", 330, "over"],
      ["dining", 65, "near"],
      ["shopping", 0, "ok"],
    ]);
    expect(lines[0]).toMatchObject({ remaining: -30, progress: 1.1 });
    expect(statusOf(79.99, 100)).toBe("ok");
    expect(statusOf(80, 100)).toBe("near");
    expect(statusOf(100, 100)).toBe("near");
    expect(statusOf(100.01, 100)).toBe("over");
  });

  it("suggests starting budgets from the last 3 complete months, rounded up", () => {
    const hist = [
      ...usdMonthly("Whole Foods", "groceries", "2026-07", [400, 420, 380, 460], 10), // Jul..Oct; uses Aug–Oct
      ...usdMonthly("Uber", "transport", "2026-08", [60, 0.01, 90], 12),
      u({ postedOn: "2026-10-01", amount: 30, merchant: "Bank fee/charge", category: "fees_charges", descriptionRaw: "LATE FEE" }),
      u({ postedOn: "2026-11-05", amount: 999, merchant: "Whole Foods", category: "groceries" }), // current month ignored
    ];
    const s = suggestBudgets({ txns: hist, currency: USD, today: "2026-11-20" });
    expect(s.map((x) => [x.category, x.average, x.suggested])).toEqual([
      ["groceries", 420, 425],
      ["transport", 50, 50],
    ]);
    expect(suggestBudgets({ txns: hist, currency: USD, today: "2026-11-20", existing: new Set(["groceries"]) }).map((x) => x.category)).toEqual(["transport"]);
  });

  it("niceCeil steps by currency", () => {
    expect(niceCeil(43.2, "USD")).toBe(45);
    expect(niceCeil(420, "USD")).toBe(425);
    expect(niceCeil(1210, "USD")).toBe(1300);
    expect(niceCeil(640, "INR")).toBe(650);
    expect(niceCeil(4200, "INR")).toBe(4500);
    expect(niceCeil(18_100, "INR")).toBe(19_000);
  });

  it("raises over-budget alerts per category and for the overall budget", () => {
    const alerts = budgetAlerts({ txns, currency: USD, today: "2026-11-20", budgets: [{ category: "groceries", amount: 300 }], monthlyBudget: 350 });
    expect(alerts.map((a) => a.dedupeKey).sort()).toEqual(["over_budget:groceries:2026-10", "over_budget:groceries:2026-11", "over_budget:total:2026-10", "over_budget:total:2026-11"]);
    const nov = alerts.find((a) => a.dedupeKey === "over_budget:groceries:2026-11")!;
    expect(nov).toMatchObject({ amount: 330, baseline: 300 });
    expect(nov.body).toContain("$30 over");
  });
});

// ---------------------------------------------------------------- safe to spend

describe("safe to spend", () => {
  const today = "2026-11-20";
  const income = (m: string, amt = 5000) => u({ postedOn: `${m}-01`, amount: amt, merchant: "ACME PAYROLL", category: "income", direction: "credit" });
  const base = [
    income("2026-08"),
    income("2026-09"),
    income("2026-10", 5300),
    income("2026-11"),
    ...usdMonthly("Netflix", "subscriptions", "2026-07", [15.49, 15.49, 15.49, 15.49], 25), // next: Nov 25 (upcoming)
    ...usdMonthly("Spotify", "subscriptions", "2026-07", [10.99, 10.99, 10.99, 10.99, 10.99], 3), // already charged Nov 3
    u({ postedOn: "2026-11-10", amount: 1200, merchant: "Target", category: "shopping" }),
  ];

  it("uses the overall budget first: base − spent − upcoming", () => {
    const recurring = detectRecurring(base, USD, today);
    const s = computeSafeToSpend({ txns: base, currency: USD, today, recurring, monthlyBudget: 3000, categoryBudgetTotal: 999 })!;
    expect(s.basis).toBe("budget");
    expect(s.spent).toBe(1210.99); // Target + Spotify
    expect(s.upcomingItems).toEqual([{ merchant: "Netflix", amount: 15.49, expectedOn: "2026-11-25" }]);
    expect(s.amount).toBe(round(3000 - 1210.99 - 15.49));
    expect(s.daysLeft).toBe(11);
    expect(s.perDay).toBe(round((3000 - 1210.99 - 15.49) / 11));
  });

  it("falls back to category budgets, then trailing income", () => {
    const recurring = detectRecurring(base, USD, today);
    expect(computeSafeToSpend({ txns: base, currency: USD, today, recurring, categoryBudgetTotal: 2000 })!.basis).toBe("category_budgets");
    const s = computeSafeToSpend({ txns: base, currency: USD, today, recurring })!;
    expect(s.basis).toBe("income");
    expect(s.base).toBe(5100); // Aug–Oct average
    expect(trailingIncome(base, USD, today)).toBe(5100);
  });

  it("is null with no budget and too little income history, and can go negative", () => {
    const thin = [income("2026-11"), u({ postedOn: "2026-11-02", amount: 50, merchant: "Target", category: "shopping" })];
    expect(computeSafeToSpend({ txns: thin, currency: USD, today, recurring: [] })).toBeNull();
    const s = computeSafeToSpend({ txns: thin, currency: USD, today, recurring: [], monthlyBudget: 20 })!;
    expect(s.amount).toBe(-30);
    expect(s.perDay).toBe(0);
  });
});

// ---------------------------------------------------------------- net worth

describe("net worth", () => {
  it("adds bank balances + assets and subtracts card balances + liabilities; skips other currencies and opted-out accounts", () => {
    const nw = computeNetWorth({
      currency: USD,
      accounts: [
        { accountId: "a", label: "Chase checking", kind: "bank", currency: USD, includeInNetWorth: true, balance: 4200, asOf: "2026-10-31" },
        { accountId: "b", label: "Amex card", kind: "credit_card", currency: USD, includeInNetWorth: true, balance: 1350.5, asOf: "2026-11-05" },
        { accountId: "c", label: "HDFC", kind: "bank", currency: "INR", includeInNetWorth: true, balance: 90000, asOf: "2026-11-01" },
        { accountId: "d", label: "Old card", kind: "credit_card", currency: USD, includeInNetWorth: false, balance: 500, asOf: "2026-09-01" },
        { accountId: "e", label: "No statement", kind: "bank", currency: USD, includeInNetWorth: true, balance: null, asOf: null },
      ],
      items: [
        { id: "1", kind: "asset", type: "investment", name: "401k", amount: 30000, updatedAt: "" },
        { id: "2", kind: "liability", type: "loan", name: "Car loan", amount: 8000, updatedAt: "" },
      ],
    });
    expect(nw).toMatchObject({ assets: 34200, liabilities: 9350.5, netWorth: 24849.5, hasData: true, asOf: "2026-10-31" });
    expect(nw.accounts.filter((a) => a.counted).map((a) => a.accountId)).toEqual(["a", "b"]);
  });

  it("has no data when nothing counts", () => {
    expect(computeNetWorth({ currency: USD, accounts: [], items: [] })).toMatchObject({ hasData: false, netWorth: 0 });
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
