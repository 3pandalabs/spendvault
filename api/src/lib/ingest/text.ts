// Date / amount / last4 helpers shared by every rules parser. Pure module.
import type { DateOrder } from "./types.js";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

/** Source of a regex matching one date token in any supported format. */
export const DATE_SRC =
  `(?:\\d{4}-\\d{1,2}-\\d{1,2}` +
  `|\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})(?!\\d)` +
  `|\\d{1,2}[ /-]?${MON}[ /,-]*(?:\\d{4}|\\d{2})(?!\\d)` +
  `|${MON} \\d{1,2},? \\d{4})`;

/** Finds date tokens inside free text. */
export const dateFinder = () => new RegExp(`(?<![\\w/.-])${DATE_SRC}(?![\\w/])`, "gi");

const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

function monthNum(s: string): number | undefined {
  return MONTHS[s.toLowerCase().replace(/\.$/, "").slice(0, 3)];
}

/**
 * Parse one date token. `order` decides dd/mm vs mm/dd for all-numeric dates
 * when both parts are <= 12. `refYear` enables year-less US "MM/DD" dates.
 */
export function parseDate(raw: string, order: DateOrder = "DMY", refYear?: number): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return order === "MDY" ? iso(y, a, b) : iso(y, b, a);
  }
  m = s.match(/^(\d{1,2})[ /-]?([a-z]{3,9})\.?[ /,-]*(\d{4}|\d{2})$/i);
  if (m) {
    const mo = monthNum(m[2]);
    return mo ? iso(+m[3], mo, +m[1]) : null;
  }
  m = s.match(/^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i);
  if (m) {
    const mo = monthNum(m[1]);
    return mo ? iso(+m[3], mo, +m[2]) : null;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m && refYear) {
    return order === "MDY" ? iso(refYear, +m[1], +m[2]) : iso(refYear, +m[2], +m[1]);
  }
  return null;
}

/** All dates found in a piece of text, in order. */
export function findDates(text: string, order: DateOrder = "DMY"): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(dateFinder())) {
    const d = parseDate(m[0], order);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Decide dd/mm vs mm/dd from a set of numeric date strings: any first part > 12
 * means DMY, any second part > 12 means MDY; otherwise `fallback`.
 */
export function inferDateOrder(samples: string[], fallback: DateOrder): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return "DMY";
  if (mdy > dmy) return "MDY";
  return fallback;
}

/**
 * A money amount with exactly 2 decimals (statements always print paise/cents),
 * Indian (1,23,456.78) or Western (123,456.78) grouping, optional sign,
 * currency symbol, parentheses and a trailing Cr/Dr marker.
 */
export const amountFinder = () =>
  /(?<![\w.,/:-])(-|\+)?\(?(?:₹|Rs\.?|INR|USD|\$)?\s?(-)?(\d{1,3}(?:,\d{2,3})+|\d+)\.(\d{2})\)?(?:\s?(Cr|CR|cr|Dr|DR|dr)\b)?(?![\d,]|\.\d)/g;

export type AmountToken = { value: number; negative: boolean; marker: "cr" | "dr" | null; index: number; end: number; raw: string };

export function findAmounts(text: string): AmountToken[] {
  const out: AmountToken[] = [];
  for (const m of text.matchAll(amountFinder())) {
    const value = Number(`${m[3].replace(/,/g, "")}.${m[4]}`);
    const negative = m[1] === "-" || m[2] === "-" || (m[0].includes("(") && m[0].includes(")"));
    const marker = m[5] ? (m[5].toLowerCase() as "cr" | "dr") : null;
    out.push({ value, negative, marker, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, raw: m[0] });
  }
  return out;
}

/** Parse a spreadsheet cell / loose amount string ("1,234.50", "(12.00)", "-5", "₹ 499", "12.00 Cr"). */
export function parseLooseAmount(raw: unknown): { value: number; negative: boolean; marker: "cr" | "dr" | null } | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: Math.abs(raw), negative: raw < 0, marker: null } : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s === "-" || s === "--") return null;
  let marker: "cr" | "dr" | null = null;
  const mk = s.match(/\s*\b(cr|dr)\.?$/i);
  if (mk) {
    marker = mk[1].toLowerCase() as "cr" | "dr";
    s = s.slice(0, mk.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr|usd|\$/gi, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? { value, negative, marker } : null;
}

/** Card / account last 4 from free text. */
export function findLast4(text: string): string | null {
  const masked = text.match(/(?:[xX*•]{2,}[\s-]?)+(\d{4})(?!\d)/);
  if (masked) return masked[1];
  const ending = text.match(/ending\s*(?:in|with)?\s*[:-]?\s*(\d{4})(?!\d)/i);
  if (ending) return ending[1];
  // "Card No: 4893 7712 3456 4417" / "Account Number 00000012345678901": last 4 of the run.
  const labelled = text.match(/(?:card\s*(?:no\.?|number|num)|account\s*(?:no\.?|number)|a\/c\s*(?:no\.?)?)\s*[:.-]?\s*(\d[\d\s-]{2,30}\d)(?![\d])/i);
  if (labelled) {
    const digits = labelled[1].replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(-4);
  }
  return null;
}

/** Lowercase alphanumerics, single-spaced. Used for fingerprints and matching. */
export const normalizeDescription = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
