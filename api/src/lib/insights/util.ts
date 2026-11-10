// Pure helpers shared by the insights modules: dates on plain YYYY-MM-DD
// strings, robust statistics, and money formatting. No env/db imports.

import { CATEGORIES, NON_SPEND, type Category } from "../categories.js";

/** A transaction as the insights engine sees it (amount positive, major units). */
export type Txn = {
  id: string;
  accountId: string | null;
  postedOn: string; // YYYY-MM-DD
  merchant: string;
  category: string;
  amount: number;
  direction: "debit" | "credit";
  currency: string;
  descriptionRaw: string;
  sourceKind: string; // statement | alert | csv
  supersededBy?: string | null;
};

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);
export const monthOf = (d: string) => d.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const idx = +month.slice(0, 4) * 12 + (+month.slice(5, 7) - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** Today's calendar date in Asia/Kolkata (UTC+5:30, no DST). */
export const todayInKolkata = (now: Date = new Date()) => fromMs(now.getTime() + 5.5 * 3_600_000);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" → "November 2026" */
export const monthLabel = (month: string) => `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;
export const monthName = (month: string) => MONTHS[+month.slice(5, 7) - 1];
/** "2026-11-03" → "3 Nov 2026" */
export const dayLabel = (d: string, withYear = true) =>
  `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)}${withYear ? ` ${d.slice(0, 4)}` : ""}`;

// ---------------------------------------------------------------- stats

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation (raw, unscaled). */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** MAD scaled to be comparable to a standard deviation (×1.4826). */
export const scaledMad = (xs: readonly number[]) => mad(xs) * 1.4826;

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- money

/**
 * Thresholds are written in rupees; USD users get them scaled down ~40×
 * (₹1,000 → $25), which is roughly purchasing-power comparable.
 */
export const threshold = (inr: number, currency: string) => (currency === "INR" ? inr : inr / 40);

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/**
 * ₹12,340 / ₹1,23,456 (Indian grouping) or $1,234. Whole units, except small
 * amounts with paise/cents (₹99.50, $9.99) keep 2 decimals.
 */
export function formatMoney(amount: number, currency: string): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const keepCents = abs < 100 && Math.round(abs * 100) % 100 !== 0;
  const fixed = keepCents ? abs.toFixed(2) : Math.round(abs).toString();
  const [i, f] = fixed.split(".");
  const grouped = currency === "INR" ? groupIndian(i) : i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  return `${neg ? "-" : ""}${symbol}${grouped}${f ? `.${f}` : ""}`;
}

// ---------------------------------------------------------------- categories

export const categoryLabel = (c: string) => (c in CATEGORIES ? CATEGORIES[c as Category].label : c);
export const isEssential = (c: string) => (c in CATEGORIES ? CATEGORIES[c as Category].essential : false);
export const isSpendCategory = (c: string) => !NON_SPEND.has(c as Category);

export const merchantKey = (m: string) => m.trim().toLowerCase();

/** Merchant names that are generic buckets, never a real counterparty. */
const GENERIC_MERCHANTS = new Set(["income/refund", "transfer", "card bill payment", "bank fee/charge", "atm withdrawal"]);

/** Non-superseded rows in one currency: the only rows any insight looks at. */
export const usable = (txns: readonly Txn[], currency: string) =>
  txns.filter((t) => !t.supersededBy && t.currency === currency);

/** A spend debit: direction debit and category not NON_SPEND. */
export const isSpendDebit = (t: Txn) => t.direction === "debit" && isSpendCategory(t.category);

export type SpendEntry = { txn: Txn; date: string; category: string; merchant: string; accountId: string | null; amount: number };

/**
 * Signed spend entries. Debits in spend categories count positive. A refund
 * (a credit categorized `income`) counts NEGATIVE against a merchant's spend
 * category only when that merchant has spend debits in the same data set
 * (clean attribution by merchant name, e.g. an Amazon refund nets against
 * Amazon's "shopping"). Every other credit is income, not negative spend.
 * Totals built from these are floored at 0 per bucket by callers.
 */
export function spendEntries(txns: readonly Txn[]): SpendEntry[] {
  const merchantCat = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!isSpendDebit(t)) continue;
    const k = merchantKey(t.merchant);
    const m = merchantCat.get(k) ?? new Map<string, number>();
    m.set(t.category, (m.get(t.category) ?? 0) + 1);
    merchantCat.set(k, m);
  }
  const out: SpendEntry[] = [];
  for (const t of txns) {
    const base = { txn: t, date: t.postedOn, merchant: t.merchant, accountId: t.accountId };
    if (isSpendDebit(t)) {
      out.push({ ...base, category: t.category, amount: t.amount });
    } else if (isRefund(t, merchantCat)) {
      const cats = [...merchantCat.get(merchantKey(t.merchant))!.entries()].sort((a, b) => b[1] - a[1]);
      out.push({ ...base, category: cats[0][0], amount: -t.amount });
    }
  }
  return out;
}

function isRefund(t: Txn, merchantCat: Map<string, Map<string, number>>): boolean {
  if (t.direction !== "credit" || t.category !== "income") return false;
  const k = merchantKey(t.merchant);
  return !GENERIC_MERCHANTS.has(k) && merchantCat.has(k);
}

/** Credits that are income (not attributed refunds). */
export function incomeTxns(txns: readonly Txn[]): Txn[] {
  const refundIds = new Set(spendEntries(txns).filter((e) => e.amount < 0).map((e) => e.txn.id));
  return txns.filter((t) => t.direction === "credit" && t.category === "income" && !refundIds.has(t.id));
}

export function sumBy<K>(entries: readonly SpendEntry[], key: (e: SpendEntry) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + e.amount);
  return m;
}
