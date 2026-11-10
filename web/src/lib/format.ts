// Money is a number in major units in the API. INR uses Indian digit grouping
// (₹1,23,456); dates are YYYY-MM-DD and shown in en-IN.

const fmtCache = new Map<string, Intl.NumberFormat>();

function moneyFmt(currency: string, decimals: number) {
  const key = `${currency}:${decimals}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals === 2 ? 2 : 0,
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** ₹1,23,457 (no paise) — for totals, charts and KPIs. */
export function money(v: number | null | undefined, currency = "INR"): string {
  if (v == null || Number.isNaN(v)) return "—";
  return moneyFmt(currency, 0).format(v);
}

/** ₹1,23,456.78 — for individual transactions. */
export function moneyExact(v: number | null | undefined, currency = "INR"): string {
  if (v == null || Number.isNaN(v)) return "—";
  return moneyFmt(currency, 2).format(v);
}

/** ₹1.2L / ₹3.4Cr / $1.2k — for chart axes where space is tight. */
export function moneyShort(v: number, currency = "INR"): string {
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

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShortFmt = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });
const tsFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const asDate = (ymd: string) => new Date(`${ymd.length === 7 ? `${ymd}-01` : ymd.slice(0, 10)}T00:00:00Z`);

/** "4 Nov 2026" */
export const fmtDate = (ymd: string | null | undefined) => (ymd ? dateFmt.format(asDate(ymd)) : "—");
/** "4 Nov" */
export const fmtDay = (ymd: string) => dayFmt.format(asDate(ymd));
/** "November 2026" from "2026-11" */
export const fmtMonth = (ym: string) => monthFmt.format(asDate(ym));
/** "Nov" from "2026-11" */
export const fmtMonthShort = (ym: string) => monthShortFmt.format(asDate(ym));
/** "4 Nov, 3:12 pm" (local time) */
export const fmtTimestamp = (iso: string | null | undefined) => (iso ? tsFmt.format(new Date(iso)) : "—");

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
