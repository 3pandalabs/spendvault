// Money is a number in major units in the API. USD uses en-US ($123,456);
// INR keeps Indian digit grouping (₹1,23,456). Dates are YYYY-MM-DD from the
// API and are shown in the signed-in user's locale: en-US by default, en-IN
// for INR users (AppShell calls setDisplayCurrency once /me has loaded).

const fmtCache = new Map<string, Intl.NumberFormat>();

function moneyFmt(currency: string, decimals: number) {
  const key = `${currency}:${decimals}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals === 2 ? 2 : 0,
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** $123,457 / ₹1,23,457 (no cents/paise) — for totals, charts and KPIs. */
export function money(v: number | null | undefined, currency = "USD"): string {
  if (v == null || Number.isNaN(v)) return "—";
  return moneyFmt(currency, 0).format(v);
}

/** $123,456.78 / ₹1,23,456.78 — for individual transactions. */
export function moneyExact(v: number | null | undefined, currency = "USD"): string {
  if (v == null || Number.isNaN(v)) return "—";
  return moneyFmt(currency, 2).format(v);
}

/** $1.2k / $3.4M / ₹1.2L / ₹3.4Cr — for chart axes where space is tight. */
export function moneyShort(v: number, currency = "USD"): string {
  const sym = currency === "USD" ? "$" : "₹";
  const a = Math.abs(v);
  if (currency === "USD") {
    if (a >= 1e6) return `${sym}${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}k`;
    return `${sym}${Math.round(v)}`;
  }
  if (a >= 1e7) return `${sym}${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sym}${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}k`;
  return `${sym}${Math.round(v)}`;
}

/** % change from `base` to `v`, or null when there's no baseline. */
export function pctChange(v: number, base: number): number | null {
  if (!base) return null;
  return ((v - base) / base) * 100;
}

export function pct(v: number | null, digits = 0): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

// ---- dates and counts follow the user's base currency ----

type DateFmts = { date: Intl.DateTimeFormat; day: Intl.DateTimeFormat; month: Intl.DateTimeFormat; monthShort: Intl.DateTimeFormat; ts: Intl.DateTimeFormat; count: Intl.NumberFormat };

function makeFmts(locale: string): DateFmts {
  return {
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
    month: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
    monthShort: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }),
    ts: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }),
    count: new Intl.NumberFormat(locale),
  };
}

let locale = "en-US";
let fmts = makeFmts(locale);

/**
 * Base currency to suggest at sign-up: INR for a browser on India time, USD
 * otherwise (the API's default too). Changeable any time in Settings.
 */
export function guessBaseCurrency(): "USD" | "INR" {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "INR" : "USD";
  } catch {
    return "USD";
  }
}

/** en-IN for INR users (4 Nov 2026, 1,23,456), en-US otherwise (Nov 4, 2026). Idempotent. */
export function setDisplayCurrency(currency: string | null | undefined) {
  const next = currency === "INR" ? "en-IN" : "en-US";
  if (next === locale) return;
  locale = next;
  fmts = makeFmts(next);
}

const asDate = (ymd: string) => new Date(`${ymd.length === 7 ? `${ymd}-01` : ymd.slice(0, 10)}T00:00:00Z`);

/** "Nov 4, 2026" (en-US) / "4 Nov 2026" (en-IN) */
export const fmtDate = (ymd: string | null | undefined) => (ymd ? fmts.date.format(asDate(ymd)) : "—");
/** "Nov 4" / "4 Nov" */
export const fmtDay = (ymd: string) => fmts.day.format(asDate(ymd));
/** "November 2026" from "2026-11" */
export const fmtMonth = (ym: string) => fmts.month.format(asDate(ym));
/** "Nov" from "2026-11" */
export const fmtMonthShort = (ym: string) => fmts.monthShort.format(asDate(ym));
/** "Nov 4, 3:12 PM" / "4 Nov, 3:12 pm" (local time) */
export const fmtTimestamp = (iso: string | null | undefined) => (iso ? fmts.ts.format(new Date(iso)) : "—");
/** 12,345 / 1,23,456 — plain counts. */
export const fmtCount = (n: number) => fmts.count.format(n);

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** First and last day ("YYYY-MM-DD") of a "YYYY-MM" month. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
