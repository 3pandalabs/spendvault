import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_CURRENCY, homeCountryOf, signupBaseCurrency } from "../../src/lib/currency.js";
import { GMAIL_FILTER_MAX, gmailFilterQuery, INSTITUTIONS, institutionFromText } from "../../src/lib/institutions.js";
import { parseStatementText } from "../../src/lib/ingest/statement.js";
import { parseTable } from "../../src/lib/ingest/tabular.js";
import { feeLabel } from "../../src/lib/insights/fees.js";
import { computeSavings } from "../../src/lib/insights/savings.js";
import { txn } from "../insights/helpers.js";

describe("gmailFilterQuery", () => {
  const q = gmailFilterQuery();

  it("covers every known sender, US and India", () => {
    for (const d of ["chase.com", "americanexpress.com", "capitalone.com", "wellsfargo.com", "hdfcbank.net", "sbicard.com"]) {
      expect(q).toContain(d);
    }
    // Every sender is listed itself or via its parent domain (Gmail's from: matches subdomains).
    for (const s of INSTITUTIONS.flatMap((i) => i.senders)) expect(q).toContain(s.replace(/^(welcome|info|ealerts)\./, ""));
    expect(q).not.toContain("welcome.americanexpress.com");
  });

  it("matches US alert wording as well as Indian", () => {
    for (const w of ["transaction", "purchase", "charged", "debited", "spent", "statement"]) expect(q).toContain(w);
  });

  it("lists US senders first", () => {
    expect(q.startsWith("from:(chase.com OR ")).toBe(true);
    expect(q.indexOf("wellsfargo.com")).toBeLessThan(q.indexOf("hdfcbank.net"));
  });

  it("stays under Gmail's filter length limit", () => {
    expect(q.length).toBeLessThan(GMAIL_FILTER_MAX);
  });

  it("has no duplicate domains", () => {
    const domains = q.match(/^from:\(([^)]*)\)/)![1].split(" OR ");
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe("sign-up base currency", () => {
  it("defaults new users to USD", () => {
    expect(DEFAULT_BASE_CURRENCY).toBe("USD");
    expect(signupBaseCurrency()).toBe("USD");
    expect(signupBaseCurrency(null)).toBe("USD");
  });
  it("keeps an explicit INR choice", () => {
    expect(signupBaseCurrency("INR")).toBe("INR");
  });
  it("maps currency to the home market", () => {
    expect(homeCountryOf("USD")).toBe("US");
    expect(homeCountryOf("INR")).toBe("IN");
    expect(homeCountryOf(undefined)).toBe("IN");
  });
});

describe("new US institutions", () => {
  it("recognizes them by name", () => {
    expect(institutionFromText("U.S. Bank Visa Platinum statement")?.key).toBe("usbank");
    expect(institutionFromText("Navy Federal Credit Union")?.key).toBe("navyfederal");
    expect(institutionFromText("Ally Bank savings")?.key).toBe("ally");
    expect(institutionFromText("totally normal text")).toBeUndefined();
  });
});

describe("home-country fallback for unknown institutions", () => {
  const rows = [["Date", "Description", "Amount"], ["01/02/2026", "COFFEE", "-4.50"]];

  it("INR users (and no hint) keep DD/MM + INR", () => {
    for (const r of [parseTable(rows), parseTable(rows, { homeCountry: "IN" })]) {
      expect(r.currency).toBe("INR");
      expect(r.txns[0].postedOn).toBe("2026-02-01");
    }
  });

  it("USD users get MM/DD + USD", () => {
    const r = parseTable(rows, { homeCountry: "US" });
    expect(r.currency).toBe("USD");
    expect(r.txns[0].postedOn).toBe("2026-01-02");
  });

  it("a known institution's country still wins", () => {
    expect(parseTable(rows, { country: "IN", homeCountry: "US" }).currency).toBe("INR");
    expect(parseTable(rows, { country: "US", homeCountry: "IN" }).currency).toBe("USD");
  });

  it("statement text: explicit rupee markers stay INR even for USD users", () => {
    const text = "Statement\n01/02/2026 SWIGGY Rs. 450.00\n";
    expect(parseStatementText(text, { homeCountry: "US" }).currency).toBe("INR");
    expect(parseStatementText("Statement\n01/02/2026 COFFEE 4.50\n", { homeCountry: "US" }).currency).toBe("USD");
    expect(parseStatementText("Statement\n01/02/2026 COFFEE 4.50\n").currency).toBe("INR");
  });
});

describe("fee tip wording by currency", () => {
  const fee = (currency: string, descriptionRaw: string, amount: number) =>
    txn({ postedOn: "2026-10-03", amount, currency, category: "fees_charges", merchant: "Bank fee/charge", descriptionRaw });

  it("USD users get US card terms and no GST", () => {
    const s = computeSavings({ txns: [fee("USD", "FOREIGN TRANSACTION FEE", 27.6), fee("USD", "LATE FEE", 40)], currency: "USD", today: "2026-11-10" });
    const tips = s.tips.filter((t) => t.kind === "fee");
    expect(tips.map((t) => t.title)).toContain("Use a card with no foreign transaction fee");
    for (const t of tips) expect(t.body).not.toMatch(/GST|forex/i);
    expect(feeLabel("forex", "USD")).toBe("Foreign transaction fees");
  });

  it("INR users keep the original GST / forex wording", () => {
    const s = computeSavings({ txns: [fee("INR", "CROSS CURRENCY MARKUP", 412)], currency: "INR", today: "2026-11-10" });
    const tip = s.tips.find((t) => t.id === "fee:forex")!;
    expect(tip.title).toBe("Use a zero-forex card for foreign spends");
    expect(tip.body).toContain("(with GST)");
    expect(feeLabel("forex", "INR")).toBe("Forex markup");
  });
});
