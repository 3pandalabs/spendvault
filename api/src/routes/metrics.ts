import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { cpuPercentOfOneCore, requestsLastHour } from "../metrics/collector.js";

// Ops-only endpoint scraped server-side by admin.3pandalabs.com. Own bearer
// token (METRICS_TOKEN, optional -> 503), aggregate counts only, nothing that
// identifies a user or any amount of money. The envelope is shared across every
// 3PandaLabs app; only the `counts` keys are per-app.

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type CountsRow = {
  users: number;
  documents: number;
  documents_last_24h: number;
  documents_needing_password: number;
  documents_failed: number;
  transactions: number;
  alerts_last_7d: number;
  whatsapp_linked_users: number;
  active_sessions: number;
};

type DatabaseRow = { size_bytes: string; size_pretty: string; connections: number };

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async (req, reply) => {
    if (!env.METRICS_TOKEN) return reply.code(503).send({ error: "metrics_disabled" });
    const header = req.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!tokenMatches(presented, env.METRICS_TOKEN)) return reply.code(401).send({ error: "unauthorized" });

    const counts = await db.execute<CountsRow>(sql`
      select
        (select count(*) from users where deleted_at is null)::int as users,
        (select count(*) from documents)::int as documents,
        (select count(*) from documents where created_at > now() - interval '24 hours')::int as documents_last_24h,
        (select count(*) from documents where status = 'needs_password')::int as documents_needing_password,
        (select count(*) from documents where status = 'failed')::int as documents_failed,
        (select count(*) from transactions where superseded_by is null)::int as transactions,
        (select count(*) from alerts where created_at > now() - interval '7 days')::int as alerts_last_7d,
        (select count(*) from users where whatsapp_phone is not null)::int as whatsapp_linked_users,
        (select count(*) from sessions where expires_at > now())::int as active_sessions
    `);
    const database = await db.execute<DatabaseRow>(sql`
      select
        pg_database_size(current_database()) as size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as size_pretty,
        (select count(*) from pg_stat_activity where datname = current_database())::int as connections
    `);

    const c = counts.rows[0];
    const d = database.rows[0];
    const mem = process.memoryUsage();
    return {
      app: "spendvault",
      collectedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      counts: {
        users: c.users,
        documents: c.documents,
        documentsLast24h: c.documents_last_24h,
        documentsNeedingPassword: c.documents_needing_password,
        documentsFailed: c.documents_failed,
        transactions: c.transactions,
        alertsLast7d: c.alerts_last_7d,
        whatsappLinkedUsers: c.whatsapp_linked_users,
        activeSessions: c.active_sessions,
      },
      traffic: { apiRequestsLastHour: requestsLastHour() },
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, cpuPercentOfOneCore: cpuPercentOfOneCore() },
      database: { sizeBytes: Number(d.size_bytes), sizePretty: d.size_pretty, connections: d.connections },
    };
  });
}
