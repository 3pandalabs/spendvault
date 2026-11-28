// Weekly / monthly summary emails. Pure (no env): the caller passes URLs.
//
// Periods: weekly = the last full Monday–Sunday week, monthly = the last full
// calendar month, both in the user's time zone. One email per user per
// period: users.last_weekly_digest / last_monthly_digest hold the period key.

import type { Mail } from "../mailer.js";
import { categoryLabel, dayLabel, formatMoney, monthLabel, monthOf, round2, spendEntries, sumBy, usable, addDays, addMonths, monthEnd, monthStart, type Txn } from "./util.js";

export type DigestKind = "weekly" | "monthly";

export type Period = { kind: DigestKind; key: string; from: string; to: string; prevFrom: string; prevTo: string; label: string };

/** ISO weekday 1 (Mon) .. 7 (Sun) of a YYYY-MM-DD. */
const weekday = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};

/** The last complete period before `today`. Key: week start date / YYYY-MM. */
export function lastCompletePeriod(kind: DigestKind, today: string): Period {
  if (kind === "weekly") {
    const thisMonday = addDays(today, 1 - weekday(today));
    const from = addDays(thisMonday, -7);
    const to = addDays(thisMonday, -1);
    return { kind, key: from, from, to, prevFrom: addDays(from, -7), prevTo: addDays(from, -1), label: `the week of ${dayLabel(from, false)}` };
  }
  const m = addMonths(monthOf(today), -1);
  const p = addMonths(m, -1);
  return { kind, key: m, from: monthStart(m), to: monthEnd(m), prevFrom: monthStart(p), prevTo: monthEnd(p), label: monthLabel(m) };
}

export type DigestSummary = {
  period: Period;
  currency: string;
  spend: number;
  previousSpend: number;
  /** % change vs the previous period (null when there's nothing to compare). */
  changePct: number | null;
  txnCount: number;
  income: number;
  topCategories: Array<{ category: string; label: string; amount: number }>;
};

function spendIn(entries: ReturnType<typeof spendEntries>, from: string, to: string) {
  const byCat = sumBy(
    entries.filter((e) => e.date >= from && e.date <= to),
    (e) => e.category,
  );
  let total = 0;
  for (const v of byCat.values()) total += Math.max(0, v);
  return { total: round2(total), byCat };
}

export function summarizePeriod(txns: readonly Txn[], currency: string, period: Period): DigestSummary {
  const rows = usable(txns, currency);
  const entries = spendEntries(rows);
  const cur = spendIn(entries, period.from, period.to);
  const prev = spendIn(entries, period.prevFrom, period.prevTo);
  const inPeriod = rows.filter((t) => t.postedOn >= period.from && t.postedOn <= period.to);
  const refundIds = new Set(entries.filter((e) => e.amount < 0).map((e) => e.txn.id));
  const income = inPeriod.filter((t) => t.direction === "credit" && t.category === "income" && !refundIds.has(t.id)).reduce((s, t) => s + t.amount, 0);
  const topCategories = [...cur.byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([category, v]) => ({ category, label: categoryLabel(category), amount: round2(v) }));
  const hasPrev = rows.some((t) => t.postedOn >= period.prevFrom && t.postedOn <= period.prevTo);
  return {
    period,
    currency,
    spend: cur.total,
    previousSpend: prev.total,
    changePct: hasPrev && prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null,
    txnCount: inPeriod.length,
    income: round2(income),
    topCategories,
  };
}

export type DigestExtras = {
  newSubscriptions: Array<{ merchant: string; amount: number | null }>;
  upcomingDues: Array<{ label: string; dueDate: string; amount: number | null }>;
  alertCount: number;
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nothing happened in the period → no email. */
export const digestWorthSending = (s: DigestSummary) => s.txnCount > 0;

export function buildPeriodDigest(to: string, displayName: string, s: DigestSummary, x: DigestExtras, urls: { app: string; settings: string }): Mail {
  const fmt = (n: number) => formatMoney(n, s.currency);
  const what = s.period.kind === "weekly" ? "week" : "month";
  const subject = `SpendVault: ${fmt(s.spend)} spent in ${s.period.label}`;
  const hi = `Hi ${displayName.split(/\s+/)[0] || "there"},`;
  const change =
    s.changePct === null
      ? ""
      : s.changePct === 0
        ? ` That's the same as the ${what} before.`
        : ` That's ${Math.abs(s.changePct)}% ${s.changePct > 0 ? "more" : "less"} than the ${what} before (${fmt(s.previousSpend)}).`;
  const lines: Array<{ head: string; items: string[] }> = [];
  if (s.topCategories.length) lines.push({ head: "Top categories", items: s.topCategories.map((c) => `${c.label}: ${fmt(c.amount)}`) });
  if (x.newSubscriptions.length) lines.push({ head: "New subscriptions", items: x.newSubscriptions.map((n) => `${n.merchant}${n.amount !== null ? ` ${fmt(n.amount)}` : ""}`) });
  if (x.upcomingDues.length) lines.push({ head: "Card payments coming up", items: x.upcomingDues.map((d) => `${d.label}: due ${dayLabel(d.dueDate)}${d.amount !== null ? ` (${fmt(d.amount)})` : ""}`) });
  if (x.alertCount) lines.push({ head: "Alerts", items: [`${x.alertCount} new alert${x.alertCount === 1 ? "" : "s"} this ${what}`] });
  const intro = `You spent ${fmt(s.spend)} in ${s.period.label} across ${s.txnCount} transaction${s.txnCount === 1 ? "" : "s"}.${change}`;
  const footer = `You get this ${s.period.kind} summary because it's on in SpendVault settings: ${urls.settings}`;
  return {
    to,
    subject,
    text: `${hi}\n\n${intro}\n\n${lines.map((l) => `${l.head}\n${l.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}\n\nOpen SpendVault:\n${urls.app}\n\n${footer}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px;">
  <p style="font-size:15px;line-height:1.6;">${esc(hi)}</p>
  <p style="font-size:15px;line-height:1.6;">${esc(intro)}</p>
  ${lines
    .map(
      (l) => `<p style="font-size:14px;font-weight:600;margin:16px 0 4px;">${esc(l.head)}</p>
  <ul style="font-size:14px;line-height:1.6;margin:0;padding-left:20px;color:#374151;">${l.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
    )
    .join("\n  ")}
  <p style="margin:24px 0;"><a href="${esc(urls.app)}" style="background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">Open SpendVault</a></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><span style="word-break:break-all;">${esc(urls.app)}</span></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">You get this ${esc(s.period.kind)} summary because it's on in <a href="${esc(urls.settings)}">SpendVault settings</a>.</p>
</div>`,
  };
}

/** Which digests are due for a user today (local date + hour). Sent from 8am local, once per period key. */
export function digestsDue(
  u: { digestWeekly: boolean; digestMonthly: boolean; lastWeeklyDigest: string | null; lastMonthlyDigest: string | null; createdOn: string },
  today: string,
  localHour: number,
): Period[] {
  if (localHour < 8) return [];
  const out: Period[] = [];
  if (u.digestWeekly) {
    const p = lastCompletePeriod("weekly", today);
    if (u.lastWeeklyDigest !== p.key && u.createdOn <= p.to) out.push(p);
  }
  if (u.digestMonthly) {
    const p = lastCompletePeriod("monthly", today);
    if (u.lastMonthlyDigest !== p.key && u.createdOn <= p.to) out.push(p);
  }
  return out;
}
