// Receipt ↔ statement-transaction matching. Pure module (no env/db): the DB
// side (receipts/db.ts) loads candidates inside the window and asks pickMatch.
//
// A candidate is eligible when its amount is within a small tolerance of the
// receipt total and its date within ±3 days of the purchase date. Among
// eligible candidates the score blends amount closeness, date closeness and a
// fuzzy merchant-name similarity. Auto-linking needs either a merchant signal
// or a single unambiguous candidate; anything else is left for the user.
import { categorize } from "../categories.js";
import { round2 } from "../money.js";

export const DATE_WINDOW_DAYS = 3;
/** Receipts without a readable date: look back this far from when it arrived. */
export const UNDATED_LOOKBACK_DAYS = 10;
export const AUTO_MATCH_MIN_SCORE = 0.6;
export const MERCHANT_SIGNAL = 0.5;

export type MatchReceipt = {
  total: number;
  purchasedOn: string | null; // YYYY-MM-DD
  receivedOn: string; // YYYY-MM-DD (document created), fallback anchor
  merchant: string | null;
  currency: string;
  rejected?: readonly string[];
};

export type MatchCandidate = {
  id: string;
  postedOn: string;
  amount: number;
  merchant: string;
  descriptionRaw: string;
  currency: string;
  direction: string;
};

export type ScoredCandidate = { id: string; score: number; merchantScore: number; amountDiff: number; dayDiff: number };

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

/** ₹1 or 1% of the total, whichever is larger (round-off, tips, small surcharges). */
export const amountTolerance = (total: number) => round2(Math.max(1, total * 0.01));

/** Inclusive posted_on window to search. */
export function matchWindow(r: Pick<MatchReceipt, "purchasedOn" | "receivedOn">): { from: string; to: string } {
  if (r.purchasedOn) return { from: addDays(r.purchasedOn, -DATE_WINDOW_DAYS), to: addDays(r.purchasedOn, DATE_WINDOW_DAYS) };
  return { from: addDays(r.receivedOn, -UNDATED_LOOKBACK_DAYS), to: addDays(r.receivedOn, 1) };
}

const STOPWORDS = new Set(["pvt", "private", "ltd", "limited", "llp", "inc", "llc", "co", "company", "the", "and", "india", "store", "stores", "retail", "pos", "ecom", "www", "com", "in"]);

/** Lowercased alphanumeric tokens without legal-entity / filler words. */
export function merchantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    // Single letters stay ("D-Mart" → "d mart" → compact "dmart").
    .filter((w) => w.length > 0 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b && a.length > 0 ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 0..1 similarity of two merchant strings (substring, token overlap, bigram dice). */
export function merchantSimilarity(a: string, b: string): number {
  const ta = merchantTokens(a);
  const tb = merchantTokens(b);
  if (!ta.length || !tb.length) return 0;
  const ca = ta.join("");
  const cb = tb.join("");
  if (ca === cb) return 1;
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = shorter === ca ? cb : ca;
  if (shorter.length >= 4 && longer.includes(shorter)) return 0.9;
  const sb = new Set(tb);
  const overlap = ta.filter((t) => sb.has(t)).length / Math.min(ta.length, tb.length);
  return Math.max(overlap * 0.85, dice(ca, cb));
}

/** Best similarity between the receipt merchant and a transaction's merchant / raw description. */
export function receiptMerchantScore(receiptMerchant: string | null, c: Pick<MatchCandidate, "merchant" | "descriptionRaw">): number {
  if (!receiptMerchant?.trim()) return 0;
  // The built-in map knows "Avenue Supermarts" is DMart; compare that name too.
  const canonical = categorize(receiptMerchant, "debit").merchant;
  return Math.max(
    merchantSimilarity(receiptMerchant, c.merchant),
    merchantSimilarity(receiptMerchant, c.descriptionRaw),
    merchantSimilarity(canonical, c.merchant),
  );
}

/** null = not eligible (wrong direction/currency, outside amount or date tolerance, or rejected by the user). */
export function scoreCandidate(r: MatchReceipt, c: MatchCandidate): ScoredCandidate | null {
  if (c.direction !== "debit" || c.currency !== r.currency) return null;
  if (r.rejected?.includes(c.id)) return null;
  const tol = amountTolerance(r.total);
  const amountDiff = round2(Math.abs(c.amount - r.total));
  if (amountDiff > tol) return null;
  const w = matchWindow(r);
  if (c.postedOn < w.from || c.postedOn > w.to) return null;
  const anchor = r.purchasedOn ?? r.receivedOn;
  const days = Math.abs(dayDiff(anchor, c.postedOn));
  const amountScore = 1 - amountDiff / (tol * 2);
  const dateScore = r.purchasedOn ? 1 - days / (DATE_WINDOW_DAYS + 1) : 0.5;
  const merchantScore = receiptMerchantScore(r.merchant, c);
  const score = round2(0.4 * amountScore + 0.3 * dateScore + 0.3 * merchantScore);
  return { id: c.id, score, merchantScore: round2(merchantScore), amountDiff, dayDiff: days };
}

/** Eligible candidates, best first. */
export function rankCandidates(r: MatchReceipt, cands: readonly MatchCandidate[]): ScoredCandidate[] {
  return cands
    .map((c) => scoreCandidate(r, c))
    .filter((x): x is ScoredCandidate => x !== null)
    .sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff || a.id.localeCompare(b.id));
}

/** The candidate to auto-link, or null when nothing is eligible or the choice is ambiguous. */
export function pickMatch(r: MatchReceipt, cands: readonly MatchCandidate[]): ScoredCandidate | null {
  const ranked = rankCandidates(r, cands);
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (best.merchantScore >= MERCHANT_SIGNAL) {
    // Two equally good merchant matches (two identical DMart bills): don't guess.
    if (second && second.merchantScore >= MERCHANT_SIGNAL && best.score - second.score < 0.05) return null;
    return best.score >= AUTO_MATCH_MIN_SCORE ? best : null;
  }
  // No merchant signal: only a single eligible candidate on a dated receipt.
  if (ranked.length === 1 && r.purchasedOn && best.score >= 0.5) return best;
  return null;
}

/** Lenient 0..1 closeness for the "link to a different transaction" picker (no eligibility cut-offs). */
export function looseScore(r: MatchReceipt, c: MatchCandidate): number {
  const anchor = r.purchasedOn ?? r.receivedOn;
  const amountScore = Math.max(0, 1 - Math.abs(c.amount - r.total) / (r.total * 0.1 + 1));
  const dateScore = Math.max(0, 1 - Math.abs(dayDiff(anchor, c.postedOn)) / 8);
  return round2(0.4 * amountScore + 0.3 * dateScore + 0.3 * receiptMerchantScore(r.merchant, c));
}
