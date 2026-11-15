import { describe, expect, it } from "vitest";
import {
  amountTolerance,
  looseScore,
  matchWindow,
  merchantSimilarity,
  pickMatch,
  rankCandidates,
  type MatchCandidate,
  type MatchReceipt,
} from "../../src/lib/receipts/match.js";

let n = 0;
const c = (p: Partial<MatchCandidate> & { postedOn: string; amount: number }): MatchCandidate => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  merchant: "Some Shop",
  descriptionRaw: "SOME SHOP",
  currency: "INR",
  direction: "debit",
  ...p,
});

const receipt: MatchReceipt = { total: 4200, purchasedOn: "2026-11-12", receivedOn: "2026-11-12", merchant: "Avenue Supermarts Ltd", currency: "INR" };

describe("merchantSimilarity", () => {
  it("matches the same shop written differently", () => {
    expect(merchantSimilarity("DMart", "D-MART")).toBe(1);
    expect(merchantSimilarity("Avenue Supermarts Ltd", "AVENUE SUPERMARTS LTD THANE")).toBeGreaterThanOrEqual(0.9);
    expect(merchantSimilarity("Swiggy", "SWIGGY BANGALORE")).toBeGreaterThanOrEqual(0.9);
    expect(merchantSimilarity("Starbucks Coffee", "STARBUCKS")).toBeGreaterThanOrEqual(0.85);
  });
  it("scores unrelated shops low", () => {
    expect(merchantSimilarity("DMart", "Uber")).toBeLessThan(0.3);
    expect(merchantSimilarity("Pvt Ltd", "Uber")).toBe(0);
  });
});

describe("matching", () => {
  it("tolerance and window", () => {
    expect(amountTolerance(4200)).toBe(42);
    expect(amountTolerance(50)).toBe(1);
    expect(matchWindow(receipt)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(matchWindow({ purchasedOn: null, receivedOn: "2026-11-12" })).toEqual({ from: "2026-11-02", to: "2026-11-13" });
  });

  it("links the DMart card charge (canonical merchant name via the built-in map)", () => {
    const dmart = c({ postedOn: "2026-11-13", amount: 4200, merchant: "DMart", descriptionRaw: "POS DMART THANE" });
    const other = c({ postedOn: "2026-11-12", amount: 4200, merchant: "Uber", descriptionRaw: "UBER TRIP" });
    expect(pickMatch(receipt, [other, dmart])?.id).toBe(dmart.id);
  });

  it("excludes amounts outside tolerance, dates outside ±3 days, credits, other currencies and rejected ids", () => {
    const tooMuch = c({ postedOn: "2026-11-12", amount: 4300, merchant: "DMart" });
    const tooLate = c({ postedOn: "2026-11-16", amount: 4200, merchant: "DMart" });
    const credit = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart", direction: "credit" });
    const usd = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart", currency: "USD" });
    const rejected = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart" });
    const r = { ...receipt, rejected: [rejected.id] };
    expect(rankCandidates(r, [tooMuch, tooLate, credit, usd, rejected])).toEqual([]);
    expect(pickMatch(r, [tooMuch, tooLate, credit, usd, rejected])).toBeNull();
  });

  it("accepts small round-off differences", () => {
    const t = c({ postedOn: "2026-11-12", amount: 4199.5, merchant: "DMart" });
    expect(pickMatch(receipt, [t])?.id).toBe(t.id);
  });

  it("without a merchant signal: links a single dated candidate, refuses when ambiguous or undated", () => {
    const r: MatchReceipt = { ...receipt, merchant: null };
    const a = c({ postedOn: "2026-11-12", amount: 4200, merchant: "Pos 12345" });
    const b = c({ postedOn: "2026-11-13", amount: 4200, merchant: "Pos 67890" });
    expect(pickMatch(r, [a])?.id).toBe(a.id);
    expect(pickMatch(r, [a, b])).toBeNull();
    expect(pickMatch({ ...r, purchasedOn: null }, [a])).toBeNull();
  });

  it("two identical merchant matches are ambiguous", () => {
    const a = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart" });
    const b = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart" });
    expect(pickMatch(receipt, [a, b])).toBeNull();
  });

  it("ranks the closer date first", () => {
    const near = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart" });
    const far = c({ postedOn: "2026-11-15", amount: 4200, merchant: "DMart" });
    expect(rankCandidates(receipt, [far, near])[0].id).toBe(near.id);
  });

  it("looseScore ranks plausible picker candidates", () => {
    const close = c({ postedOn: "2026-11-12", amount: 4200, merchant: "DMart" });
    const off = c({ postedOn: "2026-11-19", amount: 3900, merchant: "Uber" });
    expect(looseScore(receipt, close)).toBeGreaterThan(looseScore(receipt, off));
  });
});
