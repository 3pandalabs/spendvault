import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { alerts, users } from "../db/schema.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { notFound } from "../lib/errors.js";
import { computeDashboard } from "../lib/insights/dashboard.js";
import { alertView, loadAccountLabels, loadAvailableMonths, loadTxns } from "../lib/insights/load.js";
import { computeSavings } from "../lib/insights/savings.js";
import { recomputeAlertsForUser } from "../lib/insights/sweep.js";
import { addDays, addMonths, monthEnd, monthOf, monthStart, todayInKolkata } from "../lib/insights/util.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recomputeLimiter = keyedLimiter(10, 60 * 60_000);

async function baseCurrency(userId: string): Promise<string> {
  const [u] = await db
    .select({ c: users.baseCurrency })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return u?.c ?? "INR";
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/dashboard",
    {
      preHandler: requireAuth,
      schema: { querystring: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }) },
    },
    async (req) => {
      const userId = req.userId!;
      const currency = await baseCurrency(userId);
      const today = todayInKolkata();
      const availableMonths = await loadAvailableMonths(userId, currency);
      const month = req.query.month ?? availableMonths[0] ?? monthOf(today);
      const [txns, accounts, recent] = await Promise.all([
        loadTxns(userId, currency, monthStart(addMonths(month, -11)), monthEnd(month)),
        loadAccountLabels(userId),
        db
          .select()
          .from(alerts)
          .where(and(eq(alerts.userId, userId), isNull(alerts.dismissedAt)))
          .orderBy(desc(alerts.createdAt))
          .limit(5),
      ]);
      const data = computeDashboard({ txns, currency, month, today, availableMonths, accounts });
      return { ...data, recentAlerts: recent.map(alertView) };
    },
  );

  // ---------------------------------------------------------------- alerts

  app.get(
    "/alerts",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          includeDismissed: z.enum(["true", "false"]).default("false"),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const rows = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.userId, req.userId!), req.query.includeDismissed === "true" ? undefined : isNull(alerts.dismissedAt)))
        .orderBy(desc(alerts.createdAt), desc(alerts.id))
        .limit(req.query.limit);
      return { items: rows.map(alertView) };
    },
  );

  app.post(
    "/alerts/:id/dismiss",
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) throw notFound();
      const [row] = await db
        .select({ id: alerts.id, dismissedAt: alerts.dismissedAt })
        .from(alerts)
        .where(and(eq(alerts.id, req.params.id), eq(alerts.userId, req.userId!)))
        .limit(1);
      if (!row) throw notFound();
      if (!row.dismissedAt) {
        await db
          .update(alerts)
          .set({ dismissedAt: new Date() })
          .where(and(eq(alerts.id, row.id), eq(alerts.userId, req.userId!)));
      }
      return reply.code(204).send();
    },
  );

  app.post("/alerts/recompute", { preHandler: requireAuth }, async (req, reply) => {
    if (!recomputeLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
    return { created: await recomputeAlertsForUser(req.userId!) };
  });

  // ---------------------------------------------------------------- savings

  app.get("/savings", { preHandler: requireAuth }, async (req) => {
    const userId = req.userId!;
    const currency = await baseCurrency(userId);
    const today = todayInKolkata();
    const txns = await loadTxns(userId, currency, addDays(today, -400));
    return computeSavings({ txns, currency, today });
  });
}
