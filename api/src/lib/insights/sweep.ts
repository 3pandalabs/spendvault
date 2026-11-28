// Alert sweep: recompute spikes for recently active users and send at most one
// digest email per user per ~day. DB + mail; the analytics are pure (spikes.ts).
// Logs ids and counts only: never amounts, merchants or alert text.
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { alerts, users } from "../../db/schema.js";
import { env } from "../../env.js";
import { sendMail } from "../mailer.js";
import { toDbAmount, toNum } from "../money.js";
import { buildDigest } from "./digest.js";
import { loadBudgets, loadTxns, monthlyRolloverOf } from "./load.js";
import { effectivePlan, hasFeature } from "../plan.js";
import { detectSpikes } from "./spikes.js";
import { addDays } from "./util.js";
import { cardDueAlerts } from "./cards.js";
import { refundAlerts } from "./refunds.js";
import { trialAlerts } from "./trials.js";
import { buildPeriodDigest, digestsDue, digestWorthSending, summarizePeriod, type Period } from "./periodDigest.js";
import { returnWindowAlerts } from "../receipts/returns.js";
import { loadCardDues, loadReturnAlertReceipts, syncRefundWatches, watchInput } from "../toolsDb.js";
import { hourIn, todayFor, userTimeZone } from "../userTime.js";

const HOUR = 3_600_000;
const log = (msg: string, fields: Record<string, string | number> = {}) =>
  console.log(JSON.stringify({ level: "info", component: "insights-sweep", msg, ...fields }));

/** Runs the detector for one user; inserts new alerts (dedupe on key). Returns how many were created. */
export async function recomputeAlertsForUser(userId: string): Promise<number> {
  const [u] = await db
    .select({
      baseCurrency: users.baseCurrency,
      monthlyBudget: users.monthlyBudget,
      timezone: users.timezone,
      budgetRolloverUnspent: users.budgetRolloverUnspent,
      budgetRolloverOverspend: users.budgetRolloverOverspend,
      budgetRolloverSince: users.budgetRolloverSince,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return 0;
  const today = todayFor(u);
  const [txns, budgetRows, dues, receiptRows, watches] = await Promise.all([
    loadTxns(userId, u.baseCurrency, addDays(today, -400)),
    loadBudgets(userId),
    loadCardDues(userId, today),
    loadReturnAlertReceipts(userId, addDays(today, -400)),
    syncRefundWatches(userId),
  ]);
  const candidates = [
    ...detectSpikes({ txns, currency: u.baseCurrency, today, budgets: budgetRows, monthlyBudget: toNum(u.monthlyBudget), monthlyRollover: monthlyRolloverOf(u) }),
    // Reminders (0003): card dues, return windows/warranties, missing refunds, trials that turned paid.
    ...cardDueAlerts(dues, today),
    ...returnWindowAlerts(receiptRows, today),
    ...refundAlerts(watches.filter((w) => !w.resolvedAt).map(watchInput), today),
    ...trialAlerts(txns, u.baseCurrency, today),
  ];
  if (candidates.length === 0) return 0;
  const inserted = await db
    .insert(alerts)
    .values(
      candidates.map((c) => ({
        userId,
        kind: c.kind,
        dedupeKey: c.dedupeKey,
        title: c.title,
        body: c.body,
        category: c.category ?? null,
        merchant: c.merchant ?? null,
        amount: c.amount === undefined ? null : toDbAmount(c.amount),
        baseline: c.baseline === undefined ? null : toDbAmount(c.baseline),
        periodStart: c.periodStart ?? null,
        data: c.data ?? null,
      })),
    )
    .onConflictDoNothing({ target: [alerts.userId, alerts.dedupeKey] })
    .returning({ id: alerts.id });
  return inserted.length;
}

const DIGEST_MAX_ITEMS = 10;

async function sendDigests(): Promise<void> {
  const due = await db.execute<{ id: string; email: string; display_name: string }>(sql`
    SELECT u.id, u.email, u.display_name FROM users u
    WHERE u.alert_emails AND u.deleted_at IS NULL
      AND (u.last_digest_at IS NULL OR u.last_digest_at < now() - interval '20 hours'
           -- a "due tomorrow/today" card reminder doesn't wait for the daily slot
           OR EXISTS (SELECT 1 FROM alerts c WHERE c.user_id = u.id AND c.kind = 'card_due' AND c.emailed_at IS NULL
                      AND c.dismissed_at IS NULL AND c.dedupe_key LIKE '%:1'))
      AND EXISTS (SELECT 1 FROM alerts a WHERE a.user_id = u.id AND a.emailed_at IS NULL
                  AND a.dismissed_at IS NULL AND a.created_at > now() - interval '7 days')
    LIMIT 500`);
  for (const u of due.rows) {
    try {
      const pending = await db
        .select({ id: alerts.id, title: alerts.title, body: alerts.body })
        .from(alerts)
        .where(
          and(
            eq(alerts.userId, u.id),
            isNull(alerts.emailedAt),
            isNull(alerts.dismissedAt),
            gt(alerts.createdAt, sql`now() - interval '7 days'`),
          ),
        )
        .orderBy(desc(alerts.createdAt))
        .limit(DIGEST_MAX_ITEMS);
      if (pending.length === 0) continue;
      const mail = buildDigest(u.email, u.display_name, pending, `${env.WEB_ORIGIN}/alerts`);
      const res = await sendMail([mail], (msg) => log("mailer", { userId: u.id, detail: msg.slice(0, 120) }));
      if (res.skipped) continue; // mailer not configured: leave alerts un-emailed
      // Attempted: don't retry for 20h, even on failure (no hourly hammering).
      await db.update(users).set({ lastDigestAt: new Date() }).where(eq(users.id, u.id));
      if (res.delivered > 0) {
        await db
          .update(alerts)
          .set({ emailedAt: new Date() })
          .where(and(eq(alerts.userId, u.id), inArray(alerts.id, pending.map((p) => p.id))));
      }
      log("digest", { userId: u.id, alerts: pending.length, delivered: res.delivered, failed: res.failed });
    } catch (err) {
      log("digest failed", { userId: u.id, error: String(err).slice(0, 200) });
    }
  }
}

// ---------------------------------------------------------------- weekly / monthly digests

async function sendPeriodDigests(now = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      baseCurrency: users.baseCurrency,
      timezone: users.timezone,
      digestWeekly: users.digestWeekly,
      digestMonthly: users.digestMonthly,
      lastWeeklyDigest: users.lastWeeklyDigest,
      lastMonthlyDigest: users.lastMonthlyDigest,
      createdAt: users.createdAt,
      plan: users.plan,
      planStatus: users.planStatus,
      planRenewsAt: users.planRenewsAt,
    })
    .from(users)
    .where(and(isNull(users.deletedAt), sql`(${users.digestWeekly} OR ${users.digestMonthly})`))
    .limit(2000);
  let sent = 0;
  for (const u of rows) {
    // Weekly/monthly summaries are a Plus feature (lib/plan.ts); BILLING=off → everyone.
    if (!hasFeature(effectivePlan(u, env.BILLING, now), "digests")) continue;
    try {
      const tz = userTimeZone(u);
      const today = todayFor(u, now);
      const due = digestsDue({ ...u, createdOn: u.createdAt.toISOString().slice(0, 10) }, today, hourIn(tz, now));
      for (const p of due) sent += await sendOneDigest(u, p, today);
    } catch (err) {
      log("period digest failed", { userId: u.id, error: String(err).slice(0, 200) });
    }
  }
  return sent;
}

async function sendOneDigest(u: { id: string; email: string; displayName: string; baseCurrency: string }, p: Period, today: string): Promise<number> {
  // Claim the period first: one email per user per period, even if two sweeps overlap.
  const claimed = await db
    .update(users)
    .set(p.kind === "weekly" ? { lastWeeklyDigest: p.key } : { lastMonthlyDigest: p.key })
    .where(
      and(
        eq(users.id, u.id),
        p.kind === "weekly" ? sql`${users.lastWeeklyDigest} IS DISTINCT FROM ${p.key}` : sql`${users.lastMonthlyDigest} IS DISTINCT FROM ${p.key}`,
      ),
    )
    .returning({ id: users.id });
  if (!claimed.length) return 0;
  const txns = await loadTxns(u.id, u.baseCurrency, p.prevFrom, p.to);
  const summary = summarizePeriod(txns, u.baseCurrency, p);
  if (!digestWorthSending(summary)) return 0;
  const inPeriod = and(eq(alerts.userId, u.id), sql`${alerts.createdAt} >= ${p.from}::date`, sql`${alerts.createdAt} < ${p.to}::date + 1`);
  const [subs, dues, counted] = await Promise.all([
    db.select({ merchant: alerts.merchant, amount: alerts.amount }).from(alerts).where(and(inPeriod, eq(alerts.kind, "new_subscription"))).limit(5),
    loadCardDues(u.id, today),
    db.select({ n: sql<number>`count(*)::int` }).from(alerts).where(inPeriod),
  ]);
  const mail = buildPeriodDigest(
    u.email,
    u.displayName,
    summary,
    {
      newSubscriptions: subs.map((s) => ({ merchant: s.merchant ?? "A new service", amount: toNum(s.amount) })),
      upcomingDues: dues
        .filter((d) => d.dueDate && (d.status === "due_soon" || d.status === "upcoming") && (d.daysUntilDue ?? 99) <= 14)
        .map((d) => ({ label: d.label, dueDate: d.dueDate!, amount: d.minimumDue ?? d.statementBalance })),
      alertCount: counted[0]?.n ?? 0,
    },
    { app: `${env.WEB_ORIGIN}/dashboard`, settings: `${env.WEB_ORIGIN}/settings` },
  );
  const res = await sendMail([mail], (msg) => log("mailer", { userId: u.id, detail: msg.slice(0, 120) }));
  log("period digest", { userId: u.id, kind: p.kind, delivered: res.delivered, failed: res.failed, skipped: res.skipped });
  return res.delivered;
}

// ---------------------------------------------------------------- sweep

const REMINDER_EVERY_MS = 6 * HOUR;
let lastReminderPass = 0;

/** Users who may need a reminder (card due, return window, warranty, refund, trial) even if nothing new arrived. */
async function reminderUsers(): Promise<string[]> {
  const r = await db.execute<{ user_id: string }>(sql`
    SELECT d.user_id FROM documents d JOIN users u ON u.id = d.user_id
      WHERE u.deleted_at IS NULL AND d.due_date BETWEEN current_date - 2 AND current_date + 7
    UNION SELECT r.user_id FROM receipts r JOIN users u ON u.id = r.user_id
      WHERE u.deleted_at IS NULL AND (r.purchased_on > current_date - 400 OR r.warranty_until BETWEEN current_date - 1 AND current_date + 32)
    UNION SELECT w.user_id FROM refund_watches w JOIN users u ON u.id = w.user_id
      WHERE u.deleted_at IS NULL AND w.resolved_at IS NULL AND w.returned_on > current_date - 130
    LIMIT 5000`);
  return r.rows.map((x) => x.user_id);
}

export async function runInsightsSweepOnce(): Promise<{ users: number; created: number }> {
  const active = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT t.user_id FROM transactions t JOIN users u ON u.id = t.user_id
    WHERE t.created_at > now() - interval '2 days' AND u.deleted_at IS NULL`);
  if (Date.now() - lastReminderPass >= REMINDER_EVERY_MS) {
    lastReminderPass = Date.now();
    const seen = new Set(active.rows.map((r) => r.user_id));
    for (const id of await reminderUsers()) if (!seen.has(id)) active.rows.push({ user_id: id });
  }
  let created = 0;
  for (const r of active.rows) {
    try {
      created += await recomputeAlertsForUser(r.user_id);
    } catch (err) {
      log("recompute failed", { userId: r.user_id, error: String(err).slice(0, 200) });
    }
  }
  await sendDigests();
  try {
    await sendPeriodDigests();
  } catch (err) {
    log("period digests failed", { error: String(err).slice(0, 200) });
  }
  return { users: active.rows.length, created };
}

let started = false;
let running = false;

/** Hourly sweep (plus one run shortly after start). Timers are unref'd. Idempotent. */
export function startInsightsSweep(): void {
  if (started) return;
  started = true;
  const run = () => {
    if (running) return;
    running = true;
    runInsightsSweepOnce()
      .then((r) => log("sweep done", r))
      .catch((err) => log("sweep failed", { error: String(err).slice(0, 200) }))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, HOUR).unref();
}
