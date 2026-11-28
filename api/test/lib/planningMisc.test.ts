import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/lib/csv.js";
import { checkInvite, inviteMail } from "../../src/lib/household/invite.js";
import { reconcile } from "../../src/lib/ingest/reconcile.js";

const t = (amount: number, direction: "debit" | "credit" = "debit") => ({ postedOn: "2026-11-01", description: "X", amount, direction });

describe("statement reconciliation", () => {
  it("card: previous + charges − payments = new balance → reconciled, with both ends kept", () => {
    const r = reconcile({ accountKind: "credit_card", previousBalance: 500, totalDue: 820.5, txns: [t(400), t(120.5), t(200, "credit")] });
    expect(r).toMatchObject({ reconciled: true, openingBalance: 500, closingBalance: 820.5, difference: 0, extractedDebits: 520.5, extractedCredits: 200 });
  });

  it("card: a missing charge shows as a positive difference", () => {
    const r = reconcile({ accountKind: "credit_card", previousBalance: 500, totalDue: 900, txns: [t(400), t(200, "credit")] });
    expect(r.reconciled).toBe(false);
    expect(r.difference).toBe(200);
  });

  it("bank: opening − debits + credits = closing", () => {
    const ok = reconcile({ accountKind: "bank", previousBalance: 2000, closingBalance: 4500, txns: [t(500), t(3000, "credit")] });
    expect(ok).toMatchObject({ reconciled: true, difference: 0, openingBalance: 2000, closingBalance: 4500 });
    const off = reconcile({ accountKind: "bank", previousBalance: 2000, closingBalance: 4400, txns: [t(500), t(3000, "credit")] });
    expect(off).toMatchObject({ reconciled: false, difference: -100 });
  });

  it("tolerates rounding (max $1 or 0.5%) and is null without both ends", () => {
    expect(reconcile({ accountKind: "credit_card", previousBalance: 0, totalDue: 100.8, txns: [t(100)] }).reconciled).toBe(true);
    const none = reconcile({ accountKind: "credit_card", totalDue: 100, txns: [t(100)] });
    expect(none).toMatchObject({ reconciled: null, difference: null, openingBalance: null, closingBalance: 100 });
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('Joe\'s "Diner", NYC')).toBe('"Joe\'s ""Diner"", NYC"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(-12.5)).toBe("-12.5");
  });

  it("neutralizes spreadsheet formulas in text cells", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("writes a BOM, a header and CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [2, null]])).toBe("﻿a,b\r\n1,x\r\n2,\r\n");
  });
});

describe("household invites", () => {
  const future = new Date(Date.now() + 3_600_000);
  const inv = { email: "partner@example.com", expiresAt: future, acceptedAt: null, householdId: "h1" };

  it("accepts the invited address (case-insensitive) when not in another household", () => {
    expect(checkInvite(inv, { email: "Partner@Example.com ", householdId: null })).toEqual({ ok: true });
    expect(checkInvite(inv, { email: "partner@example.com", householdId: "h1" })).toEqual({ ok: true });
  });

  it("rejects expired, used, wrong-account and already-in-household cases", () => {
    expect(checkInvite(null, { email: "x", householdId: null })).toMatchObject({ code: "invalid_or_expired_token" });
    expect(checkInvite({ ...inv, expiresAt: new Date(Date.now() - 1) }, { email: inv.email, householdId: null })).toMatchObject({ code: "invalid_or_expired_token" });
    expect(checkInvite({ ...inv, acceptedAt: new Date() }, { email: inv.email, householdId: null })).toMatchObject({ code: "invalid_or_expired_token" });
    expect(checkInvite(inv, { email: "someone@else.com", householdId: null })).toMatchObject({ code: "wrong_account" });
    expect(checkInvite(inv, { email: inv.email, householdId: "h2" })).toMatchObject({ code: "already_in_household" });
  });

  it("invite email carries the link and names but no financial data, HTML-escaped", () => {
    const m = inviteMail("p@example.com", "Sam <b>", "https://spendvault.example/household/join?token=abc");
    expect(m.subject).toBe("Sam <b> invited you to a SpendVault household");
    expect(m.html).toContain("Sam &lt;b&gt;");
    expect(m.text).toContain("https://spendvault.example/household/join?token=abc");
    expect(m.text).not.toMatch(/\$\d/);
  });
});
