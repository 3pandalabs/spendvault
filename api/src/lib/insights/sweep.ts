// Alert sweep: recompute spikes for recently active users and send at most one
// digest email per user per ~day. DB + mail; the analytics are pure (spikes.ts).
// Logs ids and counts only: never amounts, merchants or alert text.
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { alerts, users } from "../../db/schema.js";
import { env } from "../../env.js";
import { sendMail } from "../mailer.js";
import { toDbAmount } from "../money.js";
import { buildDigest } from "./digest.js";
import { loadTxns } from "./load.js";
import { detectSpikes } from "./spikes.js";
import { addDays, todayInKolkata } from "./util.js";

const HOUR = 3_600_000;
const log = (msg: string, fields: Record<string, string | number> = {}) =>
  console.log(JSON.stringify({ level: "info", component: "insights-sweep", msg, ...fields }));

/** Runs the detector for one user; inserts new alerts (dedupe on key). Returns how many were created. */
export async function recomputeAlertsForUser(userId: string): Promise<number> {
  const [u] = await db
    .select({ baseCurrency: users.baseCurrency })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return 0;
  const today = todayInKolkata();
  const txns = await loadTxns(userId, u.baseCurrency, addDays(today, -400));
  const candidates = detectSpikes({ txns, currency: u.baseCurrency, today });
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
      AND (u.last_digest_at IS NULL OR u.last_digest_at < now() - interval '20 hours')
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

export async function runInsightsSweepOnce(): Promise<{ users: number; created: number }> {
  const active = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT t.user_id FROM transactions t JOIN users u ON u.id = t.user_id
    WHERE t.created_at > now() - interval '2 days' AND u.deleted_at IS NULL`);
  let created = 0;
  for (const r of active.rows) {
    try {
      created += await recomputeAlertsForUser(r.user_id);
    } catch (err) {
      log("recompute failed", { userId: r.user_id, error: String(err).slice(0, 200) });
    }
  }
  await sendDigests();
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
