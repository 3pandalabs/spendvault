import { describe, expect, it } from "vitest";
import { detectForwardingConfirmation, fileTypeOf, isStatementAttachment } from "../../src/lib/ingest/classify.js";
import { fingerprints, reconcile } from "../../src/lib/ingest/reconcile.js";
import type { ParsedTxn } from "../../src/lib/ingest/types.js";

describe("forwarding confirmations", () => {
  it("extracts code, forwardFrom and link from Gmail's mail", () => {
    const body = `rahul.sharma@gmail.com has requested to automatically forward mail to your email
address abc123@in.spendvault.3pandalabs.com.
Confirmation code: 123456789

To allow rahul.sharma@gmail.com to automatically forward mail to your address,
please click the link below to confirm the request:

https://mail-settings.google.com/mail/vf-%5BANGjdJ9abc%5D-abcDEF123

If you click the link and it appears to be broken, please copy and paste it`;
    const c = detectForwardingConfirmation(
      "forwarding-noreply@google.com",
      "(#123456789) Gmail Forwarding Confirmation - Receive Mail from rahul.sharma@gmail.com",
      body,
    );
    expect(c).toEqual({
      provider: "gmail",
      forwardFrom: "rahul.sharma@gmail.com",
      code: "123456789",
      confirmUrl: "https://mail-settings.google.com/mail/vf-%5BANGjdJ9abc%5D-abcDEF123",
    });
  });

  it("falls back to the body for code/forwardFrom and accepts mail.google.com links", () => {
    const c = detectForwardingConfirmation("Gmail Team <forwarding-noreply@google.com>", "Gmail Forwarding Confirmation", "x@y.com has requested ... Confirmation code: 987654321 https://mail.google.com/mail/vf-abc");
    expect(c).toMatchObject({ provider: "gmail", code: "987654321", forwardFrom: "x@y.com", confirmUrl: "https://mail.google.com/mail/vf-abc" });
  });

  it("handles Outlook verification mails generically", () => {
    const c = detectForwardingConfirmation("account-security-noreply@accountprotection.microsoft.com", "Verify your forwarding address", "Use code 482913 or open https://account.live.com/verify?x=1 to confirm.");
    expect(c).toEqual({ provider: "outlook", forwardFrom: null, code: "482913", confirmUrl: "https://account.live.com/verify?x=1" });
  });

  it("ignores bank mail", () => {
    expect(detectForwardingConfirmation("alerts@hdfcbank.net", "Transaction alert", "Rs 100 spent")).toBeNull();
  });
});

describe("file types", () => {
  it("by extension, mime and magic bytes", () => {
    expect(fileTypeOf("application/octet-stream", "Statement_Oct.PDF")).toBe("pdf");
    expect(fileTypeOf("application/pdf", null)).toBe("pdf");
    expect(fileTypeOf(null, null, Buffer.from("%PDF-1.7"))).toBe("pdf");
    expect(fileTypeOf("text/csv", "x")).toBe("csv");
    expect(isStatementAttachment("image/png", "logo.png")).toBe(false);
    expect(isStatementAttachment("application/vnd.ms-excel", "stmt.xls")).toBe(true);
  });
});

describe("fingerprints", () => {
  const coffee: ParsedTxn = { postedOn: "2026-11-02", description: "STARBUCKS  Coffee", amount: 180, direction: "debit" };
  it("identical lines in one document get distinct keys; re-processing maps to the same keys", () => {
    const a = fingerprints("acct-1", [coffee, { ...coffee }, { ...coffee, amount: 200 }]);
    expect(new Set(a).size).toBe(3);
    expect(fingerprints("acct-1", [coffee, { ...coffee }, { ...coffee, amount: 200 }])).toEqual(a);
  });
  it("an alert never collides with the identical statement line (it gets superseded instead)", () => {
    expect(fingerprints("acct-1", [coffee], "alert")[0]).not.toBe(fingerprints("acct-1", [coffee])[0]);
  });
  it("normalizes description whitespace/case and depends on account", () => {
    const [x] = fingerprints("acct-1", [coffee]);
    const [y] = fingerprints("acct-1", [{ ...coffee, description: "starbucks coffee" }]);
    const [z] = fingerprints("acct-2", [coffee]);
    expect(x).toBe(y);
    expect(x).not.toBe(z);
  });
});

describe("reconciliation", () => {
  const t = (amount: number, direction: "debit" | "credit"): ParsedTxn => ({ postedOn: "2026-11-01", description: "x", amount, direction });
  it("card: previous + debits − credits vs total due, tolerance max(1, 0.5%)", () => {
    expect(reconcile({ accountKind: "credit_card", previousBalance: 1000, totalDue: 1500, txns: [t(700, "debit"), t(200, "credit")] }).reconciled).toBe(true);
    expect(reconcile({ accountKind: "credit_card", previousBalance: 1000, totalDue: 1500.9, txns: [t(700, "debit"), t(200, "credit")] }).reconciled).toBe(true); // ≤ ₹1
    expect(reconcile({ accountKind: "credit_card", previousBalance: 1000, totalDue: 1510, txns: [t(700, "debit"), t(200, "credit")] }).reconciled).toBe(false);
    // 0.5% of 100,000 = 500
    expect(reconcile({ accountKind: "credit_card", previousBalance: 0, totalDue: 100000, txns: [t(99600, "debit")] }).reconciled).toBe(true);
  });
  it("null when not computable; extractedDebits always summed", () => {
    const r = reconcile({ accountKind: "credit_card", totalDue: 500, txns: [t(100.1, "debit"), t(0.2, "debit")] });
    expect(r).toEqual({ statementTotal: 500, extractedDebits: 100.3, extractedCredits: 0, reconciled: null });
  });
  it("bank: opening − debits + credits vs closing", () => {
    expect(reconcile({ accountKind: "bank", previousBalance: 100, closingBalance: 150, txns: [t(50, "debit"), t(100, "credit")] })).toMatchObject({ statementTotal: 150, reconciled: true });
  });
});
