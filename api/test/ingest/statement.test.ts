import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/lib/ingest/reconcile.js";
import { parseStatementText } from "../../src/lib/ingest/statement.js";
import { findAmounts, findLast4, parseDate } from "../../src/lib/ingest/text.js";
import { CHASE_CARD, HDFC_CARD, ICICI_CARD, SBI_SAVINGS } from "../fixtures/statements.js";

describe("rules statement parser", () => {
  it("HDFC-style card statement", () => {
    const r = parseStatementText(HDFC_CARD, { country: "IN" });
    expect(r.accountKind).toBe("credit_card");
    expect(r.last4).toBe("1234");
    expect(r.periodStart).toBe("2026-10-06");
    expect(r.periodEnd).toBe("2026-11-05");
    expect(r.previousBalance).toBe(12345);
    expect(r.totalDue).toBe(8509.5);
    expect(r.currency).toBe("INR");
    expect(r.txns).toHaveLength(10);
    expect(r.txns[0]).toEqual({ postedOn: "2026-10-08", description: "SWIGGY BANGALORE", amount: 456, direction: "debit" });
    const payment = r.txns.find((t) => /THANK YOU/.test(t.description))!;
    expect(payment).toMatchObject({ amount: 12345, direction: "credit", postedOn: "2026-10-12" });
    expect(r.txns.find((t) => /REFUND/.test(t.description))).toMatchObject({ amount: 500, direction: "credit" });
    expect(r.txns.filter((t) => /STARBUCKS/.test(t.description))).toHaveLength(2); // identical lines both kept
    expect(r.txns.find((t) => /INDIAN OIL/.test(t.description))!.amount).toBe(4350);
    // Reward-point summary (integers) and account summary rows are not transactions.
    expect(r.txns.some((t) => /balance|earned/i.test(t.description))).toBe(false);
    const rec = reconcile({ accountKind: r.accountKind, previousBalance: r.previousBalance, totalDue: r.totalDue, txns: r.txns });
    expect(rec).toMatchObject({ statementTotal: 8509.5, extractedDebits: 9009.5, reconciled: true });
  });

  it("ICICI-style card statement (serial numbers, reward points, CR suffix, month-name period)", () => {
    const r = parseStatementText(ICICI_CARD, { country: "IN" });
    expect(r.accountKind).toBe("credit_card");
    expect(r.last4).toBe("5678");
    expect(r.periodStart).toBe("2026-10-15");
    expect(r.periodEnd).toBe("2026-11-14");
    expect(r.previousBalance).toBe(3210);
    expect(r.totalDue).toBe(6147.1);
    expect(r.txns.map((t) => [t.description, t.amount, t.direction])).toEqual([
      ["UBER INDIA SYSTEMS PVT LTD MUMBAI IN", 345.6, "debit"],
      ["ZOMATO LTD GURGAON IN", 812, "debit"],
      ["BBPS Payment received", 3210, "credit"],
      ["AMAZON WEB SERVICES SEATTLE US", 3989.5, "debit"],
      ["BIGBASKET BANGALORE IN", 1000, "debit"],
    ]);
    expect(reconcile({ accountKind: "credit_card", previousBalance: r.previousBalance, totalDue: r.totalDue, txns: r.txns }).reconciled).toBe(true);
  });

  it("SBI-style savings statement (debit/credit/balance columns, wrapped description)", () => {
    const r = parseStatementText(SBI_SAVINGS, { country: "IN", kinds: ["bank"] });
    expect(r.accountKind).toBe("bank");
    expect(r.last4).toBe("8901");
    expect(r.periodStart).toBe("2026-10-01");
    expect(r.periodEnd).toBe("2026-10-31");
    expect(r.previousBalance).toBe(50000);
    expect(r.closingBalance).toBe(113976);
    expect(r.txns.map((t) => [t.postedOn, t.amount, t.direction])).toEqual([
      ["2026-10-01", 85000, "credit"],
      ["2026-10-03", 499, "debit"],
      ["2026-10-05", 10000, "debit"],
      ["2026-10-10", 12345, "debit"],
      ["2026-10-15", 1500, "credit"],
      ["2026-10-31", 320, "credit"],
    ]);
    expect(r.txns[0].description).toMatch(/ACME.*SALARY/);
    expect(reconcile({ accountKind: "bank", previousBalance: r.previousBalance, closingBalance: r.closingBalance, txns: r.txns })).toMatchObject({
      statementTotal: 113976,
      reconciled: true,
    });
  });

  it("bank statement direction by balance delta even without hint words", () => {
    const text = `Date  Narration  Withdrawal Amt.  Deposit Amt.  Closing Balance
01/10/26  UPI-SOMEONE-OKAXIS  1,000.00  9,000.00
02/10/26  NEFT ACME  5,000.00  14,000.00
03/10/26  POS SHOP  2,000.00  12,000.00`;
    const r = parseStatementText(text, { country: "IN" });
    expect(r.accountKind).toBe("bank");
    expect(r.txns.map((t) => t.direction)).toEqual(["debit", "credit", "debit"]); // first: no hint → debit
  });

  it("US-style card statement (MM/DD dates, negative credits, $)", () => {
    const r = parseStatementText(CHASE_CARD, { country: "US" });
    expect(r.currency).toBe("USD");
    expect(r.last4).toBe("4321");
    expect(r.periodStart).toBe("2026-10-04");
    expect(r.periodEnd).toBe("2026-11-03");
    expect(r.previousBalance).toBe(1234.56);
    expect(r.totalDue).toBe(887.35);
    expect(r.txns).toHaveLength(5);
    expect(r.txns[0]).toMatchObject({ postedOn: "2026-10-05", amount: 5.75, direction: "debit" });
    expect(r.txns[1]).toMatchObject({ amount: 1234.56, direction: "credit" });
    expect(reconcile({ accountKind: "credit_card", previousBalance: r.previousBalance, totalDue: r.totalDue, txns: r.txns }).reconciled).toBe(true);
  });

  it("year-less dates in a Dec→Jan statement roll back a year", () => {
    const text = `Opening/Closing Date 12/05/26 - 01/04/27\n12/20  SHOP ONE  10.00\n01/02  SHOP TWO  20.00`;
    const r = parseStatementText(text, { country: "US" });
    expect(r.txns.map((t) => t.postedOn)).toEqual(["2026-12-20", "2027-01-02"]);
  });
});

describe("text helpers", () => {
  it("parses common date formats", () => {
    expect(parseDate("02/11/2026")).toBe("2026-11-02");
    expect(parseDate("02-11-26")).toBe("2026-11-02");
    expect(parseDate("02/11/2026", "MDY")).toBe("2026-02-11");
    expect(parseDate("13/01/2026", "MDY")).toBe("2026-01-13"); // unambiguous wins over order
    expect(parseDate("02-Nov-2026")).toBe("2026-11-02");
    expect(parseDate("2 Nov 26")).toBe("2026-11-02");
    expect(parseDate("Nov 02, 2026")).toBe("2026-11-02");
    expect(parseDate("2026-11-02")).toBe("2026-11-02");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("11/02", "MDY", 2026)).toBe("2026-11-02");
  });

  it("finds Indian-grouped amounts with markers and ignores dates", () => {
    const a = findAmounts("02.11.2026  ₹1,23,456.78 Cr  (12.00)  -$5.50  18.0");
    expect(a.map((x) => [x.value, x.negative, x.marker])).toEqual([
      [123456.78, false, "cr"],
      [12, true, null],
      [5.5, true, null],
    ]);
  });

  it("finds last4 in several spellings", () => {
    expect(findLast4("Card No: 4893 7712 3456 4417")).toBe("4417");
    expect(findLast4("Card XX1234 used")).toBe("1234");
    expect(findLast4("card ending in 9876")).toBe("9876");
    expect(findLast4("A/c No. 50100012345678")).toBe("5678");
  });
});
