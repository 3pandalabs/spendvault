import { describe, expect, it } from "vitest";
import { cardDueAlerts, cardDues, type CardStatementInput } from "../../src/lib/insights/cards.js";
import { cancelInfoFor } from "../../src/lib/insights/cancelLinks.js";
import { goalProgress, monthsUntil } from "../../src/lib/insights/goals.js";
import { buildPeriodDigest, digestsDue, digestWorthSending, lastCompletePeriod, summarizePeriod } from "../../src/lib/insights/periodDigest.js";
import { findRefund, refundAlerts, refundStatus, resolveRefunds, type RefundWatchInput } from "../../src/lib/insights/refunds.js";
import { detectTrialConversions, trialAlerts } from "../../src/lib/insights/trials.js";
import { detectDuplicates } from "../../src/lib/insights/fees.js";
import { computeSubscriptions } from "../../src/lib/insights/subscriptions.js";
import { hourIn, isValidTimeZone, todayFor, todayIn, userTimeZone } from "../../src/lib/userTime.js";
import { monthly, txn } from "./helpers.js";

const USD = "USD";
const u = (p: Parameters<typeof txn>[0]) => txn({ currency: USD, ...p });

// ---------------------------------------------------------------- time zone

describe("user time zone", () => {
  const now = new Date("2026-12-01T03:30:00Z"); // still Nov 30 in New York, Dec 1 in Kolkata
  it("today follows the user's zone", () => {
    expect(todayIn("America/New_York", now)).toBe("2026-11-30");
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-12-01");
    expect(hourIn("America/Los_Angeles", now)).toBe(19);
  });
  it("falls back by currency and rejects junk zones", () => {
    expect(userTimeZone({ timezone: null, baseCurrency: "INR" })).toBe("Asia/Kolkata");
    expect(userTimeZone({ timezone: "Not/AZone", baseCurrency: "USD" })).toBe("America/New_York");
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("nope")).toBe(false);
    expect(todayFor({ timezone: "America/Chicago" }, now)).toBe("2026-11-30");
  });
});

// ---------------------------------------------------------------- card dues

const card = (p: Partial<CardStatementInput> = {}): CardStatementInput => ({
  accountId: "acct-1",
  label: "Chase card ••1234",
  currency: USD,
  documentId: "doc-1",
  periodEnd: "2026-11-15",
  statementBalance: 1200,
  minimumDue: 35,
  dueDate: "2026-12-10",
  creditLimit: 5000,
  ...p,
});

describe("card dues", () => {
  it("computes days left, utilization and status", () => {
    const [d] = cardDues([card()], [], "2026-12-06");
    expect(d.daysUntilDue).toBe(4);
    expect(d.status).toBe("due_soon");
    expect(d.utilization).toBe(0.24);
    expect(cardDues([card()], [], "2026-11-20")[0].status).toBe("upcoming");
    expect(cardDues([card()], [], "2026-12-11")[0].status).toBe("overdue");
    expect(cardDues([card({ statementBalance: 0 })], [], "2026-12-06")[0].status).toBe("nothing_due");
    expect(cardDues([card({ dueDate: null })], [], "2026-12-06")[0].status).toBe("unknown");
    expect(cardDues([card({ creditLimit: null })], [], "2026-12-06")[0].utilization).toBeNull();
  });
  it("a payment after the statement closed (≥ minimum) marks it paid; one before doesn't count", () => {
    const pay = u({ postedOn: "2026-11-25", amount: 35, direction: "credit", category: "card_payment", descriptionRaw: "AUTOPAY PAYMENT", merchant: "Card bill payment" });
    expect(cardDues([card()], [pay], "2026-12-06")[0].status).toBe("paid");
    const early = { ...pay, postedOn: "2026-11-10" };
    expect(cardDues([card()], [early], "2026-12-06")[0].status).toBe("due_soon");
    const otherCard = { ...pay, accountId: "acct-2" };
    expect(cardDues([card()], [otherCard], "2026-12-06")[0].status).toBe("due_soon");
  });
  it("reminds at 5 days and again the day before, each once (dedupe key per stage)", () => {
    const five = cardDueAlerts(cardDues([card()], [], "2026-12-05"), "2026-12-05");
    expect(five).toHaveLength(1);
    expect(five[0].dedupeKey).toBe("card_due:acct-1:2026-12-10:5");
    expect(five[0].title).toContain("in 5 days");
    expect(cardDueAlerts(cardDues([card()], [], "2026-12-07"), "2026-12-07")[0].dedupeKey).toBe("card_due:acct-1:2026-12-10:5");
    const one = cardDueAlerts(cardDues([card()], [], "2026-12-09"), "2026-12-09");
    expect(one[0].dedupeKey).toBe("card_due:acct-1:2026-12-10:1");
    expect(one[0].title).toContain("tomorrow");
    expect(cardDueAlerts(cardDues([card()], [], "2026-12-10"), "2026-12-10")[0].title).toContain("today");
    expect(cardDueAlerts(cardDues([card()], [], "2026-12-03"), "2026-12-03")).toHaveLength(0); // 7 days out
    expect(cardDueAlerts(cardDues([card()], [], "2026-12-11"), "2026-12-11")).toHaveLength(0); // overdue: no reminder
  });
});

// ---------------------------------------------------------------- refunds + duplicates

describe("refund tracking", () => {
  const watch = (p: Partial<RefundWatchInput> = {}): RefundWatchInput => ({
    id: "w1",
    merchant: "Amazon",
    amount: 59.99,
    currency: USD,
    returnedOn: "2026-11-01",
    refundTransactionId: null,
    transactionId: "purchase-1",
    ...p,
  });
  it("matches a same-merchant credit after the return (partial refunds too)", () => {
    const credit = u({ postedOn: "2026-11-06", amount: 59.99, direction: "credit", category: "income", merchant: "Amazon", descriptionRaw: "AMZN MKTP REFUND" });
    expect(findRefund(watch(), [credit])?.id).toBe(credit.id);
    const partial = { ...credit, id: "p", amount: 49.99 };
    expect(findRefund(watch(), [partial])?.id).toBe("p");
  });
  it("ignores other merchants, debits, tiny credits, too-early and too-late credits", () => {
    const base = { direction: "credit" as const, category: "income", merchant: "Amazon", descriptionRaw: "AMAZON REFUND" };
    expect(findRefund(watch(), [u({ ...base, postedOn: "2026-11-06", amount: 59.99, merchant: "Target", descriptionRaw: "TARGET" })])).toBeNull();
    expect(findRefund(watch(), [u({ ...base, postedOn: "2026-11-06", amount: 59.99, direction: "debit" })])).toBeNull();
    expect(findRefund(watch(), [u({ ...base, postedOn: "2026-11-06", amount: 10 })])).toBeNull();
    expect(findRefund(watch(), [u({ ...base, postedOn: "2026-10-20", amount: 59.99 })])).toBeNull();
    expect(findRefund(watch(), [u({ ...base, postedOn: "2027-01-15", amount: 59.99 })])).toBeNull();
  });
  it("one credit resolves one watch; status waits 14 days then alerts once", () => {
    const credit = u({ postedOn: "2026-11-06", amount: 20, direction: "credit", category: "income", merchant: "Amazon", descriptionRaw: "AMAZON" });
    const hits = resolveRefunds([watch({ id: "a", amount: 20 }), watch({ id: "b", amount: 20, returnedOn: "2026-11-02" })], [credit]);
    expect(hits.size).toBe(1);
    expect(hits.get("a")?.id).toBe(credit.id);
    expect(refundStatus(watch(), "2026-11-10")).toBe("waiting");
    expect(refundStatus(watch(), "2026-11-15")).toBe("overdue");
    expect(refundStatus(watch({ refundTransactionId: "x" }), "2026-12-30")).toBe("refunded");
    const a = refundAlerts([watch()], "2026-11-16");
    expect(a).toHaveLength(1);
    expect(a[0].dedupeKey).toBe("refund_missing:w1");
    expect(refundAlerts([watch()], "2026-11-10")).toHaveLength(0);
  });
  it("duplicate charges: same merchant + amount within 48h flag; a recurring merchant doesn't", () => {
    const a = u({ postedOn: "2026-11-03", amount: 42.5, merchant: "Best Buy" });
    const b = u({ postedOn: "2026-11-04", amount: 42.5, merchant: "Best Buy" });
    const far = u({ postedOn: "2026-11-09", amount: 42.5, merchant: "Best Buy" });
    expect(detectDuplicates([a, b], USD, new Set())).toHaveLength(1);
    expect(detectDuplicates([a, far], USD, new Set())).toHaveLength(0);
    expect(detectDuplicates([a, b], USD, new Set(["best buy"]))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- trials + cancel links

describe("free trial → paid", () => {
  const history = [u({ postedOn: "2026-06-01", amount: 30, merchant: "Corner Store", category: "groceries" })];
  it("a $1 charge then a full charge 7–31 days later is a converted trial", () => {
    const txns = [
      ...history,
      u({ postedOn: "2026-10-20", amount: 1, merchant: "Peacock", category: "subscriptions", descriptionRaw: "PEACOCK TV TRIAL" }),
      u({ postedOn: "2026-11-03", amount: 13.99, merchant: "Peacock", category: "subscriptions", descriptionRaw: "PEACOCK TV" }),
    ];
    const found = detectTrialConversions(txns, USD);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ trialAmount: 1, fullAmount: 13.99, fullOn: "2026-11-03" });
    const alerts = trialAlerts(txns, USD, "2026-11-10");
    expect(alerts[0].kind).toBe("trial_converted");
    expect(alerts[0].dedupeKey).toBe("trial_converted:peacock:2026-11-03");
    expect(alerts[0].data?.cancelUrl).toBe("https://www.peacocktv.com/account");
    expect(trialAlerts(txns, USD, "2027-01-30")).toHaveLength(0); // too old to alert
  });
  it("not a trial: too soon, too late, too small a jump, or a regular customer", () => {
    const t = (d: string, amount: number, m = "Hulu") => u({ postedOn: d, amount, merchant: m, category: "subscriptions" });
    expect(detectTrialConversions([t("2026-10-01", 1), t("2026-10-04", 9.99)], USD)).toHaveLength(0);
    expect(detectTrialConversions([t("2026-10-01", 1), t("2026-11-15", 9.99)], USD)).toHaveLength(0);
    expect(detectTrialConversions([t("2026-10-01", 1), t("2026-10-15", 2.5)], USD)).toHaveLength(0);
    expect(detectTrialConversions([t("2026-09-20", 9.99), t("2026-10-01", 1), t("2026-10-15", 9.99)], USD)).toHaveLength(0);
  });
  it("cancel links: official pages for known services, null otherwise", () => {
    expect(cancelInfoFor("Netflix NETFLIX.COM")?.url).toBe("https://www.netflix.com/cancelplan");
    expect(cancelInfoFor("Streaming/App store APPLE.COM/BILL")?.name).toBe("Apple subscriptions");
    expect(cancelInfoFor("Software subscription MSFT *MICROSOFT 365")?.url).toBe("https://account.microsoft.com/services");
    expect(cancelInfoFor("Amazon Prime AMAZON PRIME*2K4")?.name).toBe("Amazon Prime");
    expect(cancelInfoFor("Kindle Unlimited AMAZON DIGITAL")?.name).toBe("Kindle Unlimited");
    expect(cancelInfoFor("Joe's Pizza")).toBeNull();
    for (const s of ["netflix", "spotify", "hulu", "disney plus", "youtube premium", "peacock", "paramount+", "adobe", "dropbox", "audible", "nytimes", "planet fitness"]) {
      expect(cancelInfoFor(s)?.url.startsWith("https://")).toBe(true);
    }
  });
  it("subscriptions carry their cancel link", () => {
    const txns = monthly("Netflix", "subscriptions", "2026-07", [15.49, 15.49, 15.49, 15.49]).map((t) => ({ ...t, currency: USD }));
    const s = computeSubscriptions({ txns, currency: USD, today: "2026-10-20" });
    expect(s.items[0].cancel?.url).toBe("https://www.netflix.com/cancelplan");
  });
});

// ---------------------------------------------------------------- goals

describe("savings goals", () => {
  it("months left counts the current month", () => {
    expect(monthsUntil("2026-12-10", "2026-12-31")).toBe(1);
    expect(monthsUntil("2026-11-27", "2027-05-01")).toBe(7);
    expect(monthsUntil("2026-11-27", "2026-10-01")).toBe(0);
  });
  it("progress, monthly needed and on-track vs behind", () => {
    const g = goalProgress({ targetAmount: 1200, targetDate: "2027-04-30", contributions: [{ amount: 300, contributedOn: "2026-10-15" }, { amount: 300, contributedOn: "2026-11-15" }] }, "2026-11-27");
    expect(g.saved).toBe(600);
    expect(g.remaining).toBe(600);
    expect(g.progress).toBe(0.5);
    expect(g.monthsLeft).toBe(6);
    expect(g.monthlyNeeded).toBe(100);
    expect(g.recentMonthlyPace).toBe(200);
    expect(g.status).toBe("on_track");
    const behind = goalProgress({ targetAmount: 5000, targetDate: "2027-01-31", contributions: [{ amount: 100, contributedOn: "2026-11-01" }] }, "2026-11-27");
    expect(behind.status).toBe("behind");
    expect(behind.monthlyNeeded).toBe(1633.33);
  });
  it("done, no date, overdue, withdrawals", () => {
    expect(goalProgress({ targetAmount: 100, targetDate: null, contributions: [{ amount: 150, contributedOn: "2026-11-01" }] }, "2026-11-27").status).toBe("done");
    const nd = goalProgress({ targetAmount: 100, targetDate: null, contributions: [] }, "2026-11-27");
    expect(nd.status).toBe("no_date");
    expect(nd.monthlyNeeded).toBeNull();
    expect(goalProgress({ targetAmount: 100, targetDate: "2026-10-01", contributions: [] }, "2026-11-27").status).toBe("overdue");
    expect(goalProgress({ targetAmount: 100, targetDate: null, contributions: [{ amount: 80, contributedOn: "2026-11-01" }, { amount: -30, contributedOn: "2026-11-02" }] }, "2026-11-27").saved).toBe(50);
  });
});

// ---------------------------------------------------------------- digests

describe("weekly / monthly digest", () => {
  it("periods are the last complete week (Mon–Sun) and month", () => {
    const w = lastCompletePeriod("weekly", "2026-11-25"); // a Wednesday
    expect([w.from, w.to, w.key, w.prevFrom]).toEqual(["2026-11-16", "2026-11-22", "2026-11-16", "2026-11-09"]);
    expect(lastCompletePeriod("weekly", "2026-11-23").from).toBe("2026-11-16"); // Monday
    const m = lastCompletePeriod("monthly", "2026-12-01");
    expect([m.from, m.to, m.key, m.prevFrom, m.prevTo]).toEqual(["2026-11-01", "2026-11-30", "2026-11", "2026-10-01", "2026-10-31"]);
    expect(lastCompletePeriod("monthly", "2027-01-05").key).toBe("2026-12");
  });
  it("summary: spend vs previous, top 3 categories, refunds net, card payments excluded", () => {
    const p = lastCompletePeriod("monthly", "2026-12-02");
    const txns = [
      u({ postedOn: "2026-10-10", amount: 100, category: "groceries", merchant: "Kroger" }),
      u({ postedOn: "2026-11-03", amount: 80, category: "groceries", merchant: "Kroger" }),
      u({ postedOn: "2026-11-05", amount: 60, category: "dining", merchant: "Chipotle" }),
      u({ postedOn: "2026-11-07", amount: 200, category: "shopping", merchant: "Target" }),
      u({ postedOn: "2026-11-09", amount: 50, direction: "credit", category: "income", merchant: "Target" }),
      u({ postedOn: "2026-11-10", amount: 20, category: "entertainment", merchant: "AMC" }),
      u({ postedOn: "2026-11-20", amount: 900, category: "card_payment", merchant: "Card bill payment" }),
    ];
    const s = summarizePeriod(txns, USD, p);
    expect(s.spend).toBe(310);
    expect(s.previousSpend).toBe(100);
    expect(s.changePct).toBe(210);
    expect(s.topCategories.map((c) => c.category)).toEqual(["shopping", "groceries", "dining"]);
    expect(digestWorthSending(s)).toBe(true);
    const mail = buildPeriodDigest("a@b.com", "Ann Lee", s, { newSubscriptions: [{ merchant: "Netflix", amount: 15.49 }], upcomingDues: [{ label: "Chase", dueDate: "2026-12-10", amount: 35 }], alertCount: 2 }, { app: "https://x/dashboard", settings: "https://x/settings" });
    expect(mail.subject).toBe("SpendVault: $310 spent in November 2026");
    expect(mail.text).toContain("210% more");
    expect(mail.text).toContain("Netflix");
    expect(mail.text).toContain("Chase: due 10 Dec 2026");
    expect(mail.html).not.toContain("<script");
    expect(digestWorthSending(summarizePeriod([], USD, p))).toBe(false);
  });
  it("due: once per period, from 8am local, monthly on by default, not before signup", () => {
    const base = { digestWeekly: false, digestMonthly: true, lastWeeklyDigest: null, lastMonthlyDigest: null, createdOn: "2026-01-01" };
    expect(digestsDue(base, "2026-12-01", 9).map((p) => p.key)).toEqual(["2026-11"]);
    expect(digestsDue(base, "2026-12-01", 7)).toEqual([]);
    expect(digestsDue({ ...base, lastMonthlyDigest: "2026-11" }, "2026-12-15", 9)).toEqual([]);
    expect(digestsDue({ ...base, digestWeekly: true }, "2026-12-01", 9).map((p) => p.kind)).toEqual(["weekly", "monthly"]);
    expect(digestsDue({ ...base, createdOn: "2026-12-01" }, "2026-12-01", 9)).toEqual([]);
  });
});
