import { describe, expect, it } from "vitest";
import { looksLikeReceipt, looksLikeReceiptSubject, looksLikeStatementText, receiptCues } from "../../src/lib/receipts/detect.js";
import { CHASE_CARD, HDFC_CARD, ICICI_CARD, SBI_SAVINGS } from "../fixtures/statements.js";

const DMART_BILL = `AVENUE SUPERMARTS LTD
D-MART, HIRANANDANI ESTATE, THANE
GSTIN: 27AACCA8432H1ZQ
TAX INVOICE
Bill No: 4521-0098812   Date: 12/11/2026 18:42
Cashier: 017
HSN   Item                     Qty   Rate     Amount
1006  BASMATI RICE 5KG          1    720.00   720.00
0401  AMUL TAAZA MILK 1L        6     54.00   324.00
8516  PIGEON ELECTRIC KETTLE    1   1300.00  1300.00
Sub Total                                    2344.00
CGST 2.5%   29.30   SGST 2.5%   29.30
Grand Total                         Rs. 2344.00
Thank you for shopping. Visit again!`;

const SWIGGY_MAIL = `Your Swiggy order summary
Order ID: 182736451122
Item Total ₹ 540.00
Delivery partner fee ₹ 30.00
Order Total ₹ 570.00
You paid ₹570 via UPI`;

const ALERTS = [
  "Dear Customer, Rs.1,234.00 spent on HDFC Bank Card xx1234 at SWIGGY on 2026-11-02:20:31:44. Avl Lmt: Rs.1,23,456.00",
  "INR 499.00 debited from A/c XX1234 on 02-11-26. Info: UPI/628812345678/SWIGGY. Avl bal INR 10,000.00",
  "Your ICICI Bank Credit Card XX5678 has been used for a transaction of INR 2,345.00 on Nov 02, 2026 at AMAZON. Available credit limit is INR 50,000.00.",
  // A bank alert that happens to mention an order id must stay an alert.
  "Rs 570.00 debited from A/c XX4321 towards Swiggy order id 182736451122. Avl bal Rs 9,430.00",
];

describe("receipt detection", () => {
  it("recognises a printed tax invoice and an order-summary email", () => {
    expect(looksLikeReceipt(DMART_BILL)).toBe(true);
    expect(receiptCues(DMART_BILL).length).toBeGreaterThanOrEqual(4);
    expect(looksLikeReceipt(SWIGGY_MAIL)).toBe(true);
  });

  it("never classifies a statement as a receipt", () => {
    for (const s of [HDFC_CARD, ICICI_CARD, SBI_SAVINGS, CHASE_CARD]) {
      expect(looksLikeReceipt(s)).toBe(false);
    }
    expect(looksLikeStatementText(HDFC_CARD)).toBe(true);
  });

  it("never classifies a bank alert as a receipt", () => {
    for (const a of ALERTS) expect(looksLikeReceipt(a)).toBe(false);
  });

  it("needs money and at least two cues", () => {
    expect(looksLikeReceipt("Thanks for your receipt request")).toBe(false);
    expect(looksLikeReceipt("Order ID 123, Qty 2, no prices here")).toBe(false);
    expect(looksLikeReceipt("")).toBe(false);
  });

  it("subject lines", () => {
    expect(looksLikeReceiptSubject("Your Swiggy order was delivered")).toBe(true);
    expect(looksLikeReceiptSubject("Invoice for your Uber trip")).toBe(true);
    expect(looksLikeReceiptSubject("Payment successful - Airtel")).toBe(true);
    expect(looksLikeReceiptSubject("Your HDFC Bank Credit Card Statement - Nov 2026")).toBe(false);
    expect(looksLikeReceiptSubject("Statement of account / invoice")).toBe(false);
    expect(looksLikeReceiptSubject(null)).toBe(false);
  });
});
