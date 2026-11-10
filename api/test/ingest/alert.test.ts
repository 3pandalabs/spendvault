import { describe, expect, it } from "vitest";
import { looksLikeAlert, parseAlertText } from "../../src/lib/ingest/alert.js";

const cases: Array<{ name: string; text: string; want: { amount: number; direction: "debit" | "credit"; postedOn: string; last4: string | null; merchant: RegExp } }> = [
  {
    name: "HDFC card spend",
    text: "Dear Customer, Rs.1,234.00 spent on HDFC Bank Card xx1234 at SWIGGY on 2026-11-02:20:31:44. Avl Lmt: Rs.1,23,456.00",
    want: { amount: 1234, direction: "debit", postedOn: "2026-11-02", last4: "1234", merchant: /^SWIGGY$/ },
  },
  {
    name: "UPI debit with Info",
    text: "INR 499.00 debited from A/c XX1234 on 02-11-26. Info: UPI/628812345678/SWIGGY. Avl bal INR 10,000.00",
    want: { amount: 499, direction: "debit", postedOn: "2026-11-02", last4: "1234", merchant: /UPI\/628812345678\/SWIGGY/ },
  },
  {
    name: "ICICI credit card used",
    text: "Your ICICI Bank Credit Card XX5678 has been used for a transaction of INR 2,345.00 on Nov 02, 2026 at AMAZON. Available credit limit is INR 50,000.00.",
    want: { amount: 2345, direction: "debit", postedOn: "2026-11-02", last4: "5678", merchant: /^AMAZON$/ },
  },
  {
    name: "rupee symbol, card ending",
    text: "You've spent ₹780.50 on your Axis Bank Credit Card ending 4321 at ZOMATO LTD on 03-11-2026 14:02 IST.",
    want: { amount: 780.5, direction: "debit", postedOn: "2026-11-03", last4: "4321", merchant: /^ZOMATO LTD$/ },
  },
  {
    name: "UPI debited ... credited (debit first wins)",
    text: "ICICI Bank Acct XX123 debited for Rs 250.00 on 04-Nov-26; RAVI KUMAR credited. UPI:628812345678. Call 18002662 for dispute.",
    want: { amount: 250, direction: "debit", postedOn: "2026-11-04", last4: "123", merchant: /^RAVI KUMAR$/ },
  },
  {
    name: "salary credit",
    text: "Dear Customer, your A/c XX9012 has been credited with INR 85,000.00 on 01/11/2026 by NEFT from ACME SOFTWARE PVT LTD. Avl Bal: INR 1,35,000.00",
    want: { amount: 85000, direction: "credit", postedOn: "2026-11-01", last4: "9012", merchant: /ACME SOFTWARE PVT LTD/ },
  },
  {
    name: "SBI style",
    text: "Dear SBI User, your A/c X4567-debited by Rs500.0 on 05Nov26 transfer to SHOPKEEPER Ref No 628812345678. If not done by you call 1800111109.",
    want: { amount: 500, direction: "debit", postedOn: "2026-11-05", last4: "4567", merchant: /SHOPKEEPER/ },
  },
  {
    name: "ATM withdrawal",
    text: "Rs.2,000.00 withdrawn at ATM MG ROAD BANGALORE from A/c XX1234 on 06/11/2026.",
    want: { amount: 2000, direction: "debit", postedOn: "2026-11-06", last4: "1234", merchant: /ATM MG ROAD BANGALORE/ },
  },
  {
    name: "refund credit to card",
    text: "A refund of Rs 1,499.00 from MYNTRA has been credited to your HDFC Bank Credit Card ending 1234 on 07-11-2026.",
    want: { amount: 1499, direction: "credit", postedOn: "2026-11-07", last4: "1234", merchant: /MYNTRA/ },
  },
  {
    name: "US charge",
    text: "A charge of $45.67 at TRADER JOES #123 was made on your card ending in 1234 on 11/02/2026.",
    want: { amount: 45.67, direction: "debit", postedOn: "2026-11-02", last4: "1234", merchant: /^TRADER JOES #123$/ },
  },
  {
    name: "Chase 'transaction with'",
    text: "You made a $12.50 transaction with STARBUCKS on Nov 3, 2026 at 8:14 AM ET on your Chase Freedom card ending in 4321.",
    want: { amount: 12.5, direction: "debit", postedOn: "2026-11-03", last4: "4321", merchant: /^STARBUCKS$/ },
  },
];

describe("alert parser", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(looksLikeAlert(c.text)).toBe(true);
      const r = parseAlertText(c.text, { fallbackDate: "2026-01-01" });
      expect(r.parser).toBe("rules:alert");
      expect(r.txns).toHaveLength(1);
      const t = r.txns[0];
      expect(t.amount).toBe(c.want.amount);
      expect(t.direction).toBe(c.want.direction);
      expect(t.postedOn).toBe(c.want.postedOn);
      expect(t.description).toMatch(c.want.merchant);
      expect(r.last4).toBe(c.want.last4);
    });
  }

  it("falls back to the email date when the body has none", () => {
    const r = parseAlertText("Rs 99.00 spent at CHAI POINT using your card XX1111.", { fallbackDate: "2026-11-08" });
    expect(r.txns[0].postedOn).toBe("2026-11-08");
  });

  it("rejects OTPs, promos and reminders", () => {
    expect(looksLikeAlert("123456 is the OTP for your transaction of Rs 499.00 at AMAZON")).toBe(false);
    expect(looksLikeAlert("Flat 50% off on Swiggy! Order now and get Rs 100 cashback*")).toBe(false);
    expect(looksLikeAlert("Get Rs 500 cashback on your first purchase above Rs 999")).toBe(false);
    expect(looksLikeAlert("Your statement is ready. Total amount due Rs 8,510.50. Pay by 25 Nov.")).toBe(false);
    expect(looksLikeAlert("Weekly newsletter: markets rallied today")).toBe(false);
    expect(parseAlertText("Your OTP is 123456 for Rs 10.00 spent").txns).toHaveLength(0);
  });
});
