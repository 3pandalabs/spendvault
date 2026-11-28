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
import { scopeUserIds } from "../lib/household/db.js";
import { budgetLines } from "../lib/insights/budgets.js";
import { alertView, loadAccountLabels, loadAvailableMonths, loadBudgets, loadNetWorthInputs, loadTxns } from "../lib/insights/load.js";
import { computeNetWorth } from "../lib/insights/networth.js";
import { detectRecurring } from "../lib/insights/recurring.js";
import { computeSafeToSpend } from "../lib/insights/safeToSpend.js";
import { toNum } from "../lib/money.js";
import { computeSavings } from "../lib/insights/savings.js";
import { loadItemizedTxns, receiptCounts, receiptSplits } from "../lib/receipts/db.js";
import { summarizeItemized } from "../lib/receipts/split.js";
import { recomputeAlertsForUser } from "../lib/insights/sweep.js";
import { addDays, addMonths, monthEnd, monthOf, monthStart } from "../lib/insights/util.js";
import { todayFor } from "../lib/userTime.js";
import { loadCardDues, loadUserSplits } from "../lib/toolsDb.js";
import { spendSplitParts } from "../lib/txnTools.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recomputeLimiter = keyedLimiter(10, 60 * 60_000);

async function userBasics(userId: string): Promise<{ currency: string; monthlyBudget: number | null; today: string }> {
  const [u] = await db
    .select({ c: users.baseCurrency, mb: users.monthlyBudget, tz: users.timezone })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  const currency = u?.c ?? "INR";
  return { currency, monthlyBudget: toNum(u?.mb), today: todayFor({ timezone: u?.tz, baseCurrency: currency }) };
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/dashboard",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
          scope: z.enum(["me", "household"]).optional(),
          member: z.string().max(40).optional(),
        }),
      },
    },
    async (req) => {
      const userId = req.userId!;
      const { currency, monthlyBudget, today } = await userBasics(userId);
      // Household scope: every member's rows (or one member's) in the caller's base currency.
      const scope = await scopeUserIds(userId, req.query.scope, req.query.member);
      const ids = scope.ids;
      const household = req.query.scope === "household" && scope.members.length > 0;
      const months = await Promise.all(ids.map((id) => loadAvailableMonths(id, currency)));
      const availableMonths = [...new Set(months.flat())].sort().reverse();
      const month = req.query.month ?? availableMonths[0] ?? monthOf(today);
      const nameOf = new Map(scope.members.map((m) => [m.userId, m.displayName.split(/\s+/)[0] || m.displayName]));
      const [txnLists, accountLists, recent, itemizedLists, counts] = await Promise.all([
        Promise.all(ids.map((id) => loadTxns(id, currency, monthStart(addMonths(month, -11)), monthEnd(month)))),
        Promise.all(
          ids.map((id) =>
            loadAccountLabels(id).then((list) => (household && id !== userId ? list.map((a) => ({ ...a, label: `${a.label} (${nameOf.get(id) ?? "partner"})` })) : list)),
          ),
        ),
        db
          .select()
          .from(alerts)
          .where(and(eq(alerts.userId, userId), isNull(alerts.dismissedAt)))
          .orderBy(desc(alerts.createdAt))
          .limit(5),
        Promise.all(ids.map((id) => loadItemizedTxns(id, monthStart(addMonths(month, -11)), monthEnd(month)))),
        receiptCounts(userId),
      ]);
      // User splits (Transactions > Split) win over receipt item splits for the same transaction.
      const userSplits = await loadUserSplits(ids);
      const txns = txnLists.flat().sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
      const accounts = accountLists.flat();
      const itemized = new Map(itemizedLists.flatMap((m) => [...m]));
      const splits = receiptSplits(itemized);
      const catOf = new Map(txns.map((t) => [t.id, t.category]));
      for (const [id, parts] of userSplits) if (catOf.has(id)) splits.set(id, spendSplitParts(catOf.get(id)!, parts));
      const data = computeDashboard({ txns, currency, month, today, availableMonths, accounts, splits });
      // Same rows as the spend totals (base currency, non-superseded), this month only.
      const inBase = new Set(txns.map((t) => t.id));
      const inMonth = [...itemized].filter(([id, t]) => inBase.has(id) && monthOf(t.postedOn) === month).map(([, t]) => t);
      // Personal planning numbers (never combined): only for the caller's own view of the current month.
      let safeToSpend = null;
      let budgetSummary = null;
      let netWorth = null;
      let upcomingDues: Awaited<ReturnType<typeof loadCardDues>> = [];
      if (!household) {
        upcomingDues = (await loadCardDues(userId, today)).filter((d) => ["overdue", "due_soon", "upcoming"].includes(d.status) && (d.daysUntilDue ?? 99) <= 14);
        const [budgetRows, nw, recentTxns] = await Promise.all([
          loadBudgets(userId),
          loadNetWorthInputs(userId),
          month === monthOf(today) ? loadTxns(userId, currency, addDays(today, -400)) : Promise.resolve(null),
        ]);
        if (recentTxns) {
          const categoryBudgetTotal = budgetRows.reduce((s, b) => s + b.amount, 0);
          safeToSpend = computeSafeToSpend({ txns: recentTxns, currency, today, recurring: detectRecurring(recentTxns, currency, today), monthlyBudget, categoryBudgetTotal });
        }
        if (budgetRows.length) {
          // Rollover needs earlier months: the 400-day window covers MAX_ROLLOVER_MONTHS.
          const lines = budgetLines(recentTxns ?? txns, currency, month, budgetRows);
          budgetSummary = { count: lines.length, over: lines.filter((l) => l.status === "over").length, near: lines.filter((l) => l.status === "near").length, top: lines.slice(0, 3) };
        }
        const n = computeNetWorth({ currency, ...nw });
        netWorth = n.hasData ? { netWorth: n.netWorth, assets: n.assets, liabilities: n.liabilities, asOf: n.asOf } : null;
      }
      return {
        ...data,
        scope: household ? "household" : "me",
        members: scope.members.map((m) => ({ userId: m.userId, displayName: m.displayName, isMe: m.userId === userId })),
        recentAlerts: household ? [] : recent.map(alertView),
        receipts: { ...counts, itemized: summarizeItemized(inMonth) },
        safeToSpend,
        budgets: budgetSummary,
        netWorth,
        upcomingDues,
      };
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
    const { currency, today } = await userBasics(userId);
    const txns = await loadTxns(userId, currency, addDays(today, -400));
    return computeSavings({ txns, currency, today });
  });
}
