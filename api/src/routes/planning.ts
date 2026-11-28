// Planning features: subscriptions, budgets, net worth, shared household.
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { budgets, NET_WORTH_KINDS, NET_WORTH_TYPES, netWorthItems, users } from "../db/schema.js";
import { isCategory, NON_SPEND } from "../lib/categories.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { invalid, notFound } from "../lib/errors.js";
import { acceptInvite, cancelInvite, createInvite, householdEnabled, householdView, leaveHousehold, previewInvite } from "../lib/household/db.js";
import { budgetLines, MAX_ROLLOVER_MONTHS, nextRollover, overallBudgetLine, suggestBudgets, totalSpend } from "../lib/insights/budgets.js";
import { loadBudgets, loadNetWorthInputs, loadTxns, monthlyRolloverOf, netWorthItemView } from "../lib/insights/load.js";
import { computeNetWorth } from "../lib/insights/networth.js";
import { computeSubscriptions } from "../lib/insights/subscriptions.js";
import { recomputeAlertsForUser } from "../lib/insights/sweep.js";
import { addDays, addMonths, monthEnd, monthOf, monthStart, round2 } from "../lib/insights/util.js";
import { todayFor } from "../lib/userTime.js";
import { planOf, requirePlus } from "../lib/billing/entitlements.js";
import { hasFeature, limitsFor, plusRequired } from "../lib/plan.js";
import { toDbAmount, toNum } from "../lib/money.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = z.number().finite().min(0).max(1e11);
const inviteLimiter = keyedLimiter(10, 60 * 60_000);

async function userBasics(userId: string) {
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
  if (!u) throw notFound();
  return { currency: u.baseCurrency, monthlyBudget: toNum(u.monthlyBudget), today: todayFor(u), monthlyRollover: monthlyRolloverOf(u) };
}

/** Budget changes may cross a line right now: refresh alerts in the background. */
const refreshAlerts = (userId: string, log: (o: object, m: string) => void) =>
  void recomputeAlertsForUser(userId).catch((err) => log({ userId, err: String(err).slice(0, 200) }, "alert recompute failed"));

export async function planningRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------- subscriptions

  app.get("/subscriptions", { preHandler: requireAuth }, async (req) => {
    const { currency, today } = await userBasics(req.userId!);
    const txns = await loadTxns(req.userId!, currency, addDays(today, -400));
    return computeSubscriptions({ txns, currency, today });
  });

  // ---------------------------------------------------------------- budgets

  async function budgetsView(userId: string, month: string) {
    const { currency, monthlyBudget, today, monthlyRollover } = await userBasics(userId);
    const cur = monthOf(today);
    const [lo, hi] = month < cur ? [month, cur] : [cur, month];
    // The month shown plus the 3 complete months before today (suggestions),
    // and up to MAX_ROLLOVER_MONTHS before the month shown (rollover).
    const from = monthStart(addMonths(lo, -Math.max(4, MAX_ROLLOVER_MONTHS)));
    const [rows, txns] = await Promise.all([loadBudgets(userId), loadTxns(userId, currency, from, monthEnd(hi))]);
    const items = budgetLines(txns, currency, month, rows);
    const overallLine = overallBudgetLine(txns, currency, month, monthlyBudget, monthlyRollover);
    const spent = totalSpend(txns, currency, month);
    const budgeted = round2(rows.reduce((s, b) => s + b.amount, 0));
    return {
      month,
      currency,
      monthlyBudget,
      totals: { budgeted, spent, spentInBudgeted: round2(items.reduce((s, l) => s + l.spent, 0)) },
      items,
      overall: {
        rolledOver: overallLine?.rolledOver ?? 0,
        available: overallLine?.available ?? null,
        remaining: overallLine?.remaining ?? null,
        status: overallLine?.status ?? null,
        rollover: monthlyRollover,
      },
      currentMonth: cur,
      suggestions: suggestBudgets({ txns, currency, today, existing: new Set(rows.map((r) => r.category)) }),
    };
  }

  app.get(
    "/budgets",
    { preHandler: requireAuth, schema: { querystring: z.object({ month: z.string().regex(MONTH).optional() }) } },
    async (req) => budgetsView(req.userId!, req.query.month ?? monthOf((await userBasics(req.userId!)).today)),
  );

  app.put(
    "/budgets/:category",
    { preHandler: requireAuth, schema: { params: z.object({ category: z.string().max(40) }), body: z.object({ amount: money }) } },
    async (req, reply) => {
      const cat = req.params.category;
      if (!isCategory(cat) || NON_SPEND.has(cat)) throw invalid("invalid_category");
      const plan = await planOf(req.userId!);
      if (!hasFeature(plan, "unlimited_budgets")) {
        // Free: up to FREE_LIMITS.budgets categories (BILLING=on only); editing an existing one is always fine.
        const rows = await loadBudgets(req.userId!);
        const cap = limitsFor(plan).budgets ?? Infinity;
        if (!rows.some((r) => r.category === cat) && rows.length >= cap) return reply.code(402).send(plusRequired("unlimited_budgets"));
      }
      await db
        .insert(budgets)
        .values({ userId: req.userId!, category: cat, amount: toDbAmount(req.body.amount) })
        .onConflictDoUpdate({ target: [budgets.userId, budgets.category], set: { amount: toDbAmount(req.body.amount), updatedAt: new Date() } });
      refreshAlerts(req.userId!, (o, m) => req.log.warn(o, m));
      return budgetsView(req.userId!, monthOf((await userBasics(req.userId!)).today));
    },
  );

  app.delete(
    "/budgets/:category",
    { preHandler: requireAuth, schema: { params: z.object({ category: z.string().max(40) }) } },
    async (req, reply) => {
      const del = await db
        .delete(budgets)
        .where(and(eq(budgets.userId, req.userId!), eq(budgets.category, req.params.category)))
        .returning({ id: budgets.id });
      if (del.length === 0) throw notFound();
      return reply.code(204).send();
    },
  );

  // Rollover (0005): carry unspent and/or overspent money into next month.
  const rolloverBody = z.object({ unspent: z.boolean(), overspend: z.boolean() }).strict();

  app.put(
    "/budgets/:category/rollover",
    { preHandler: requireAuth, schema: { params: z.object({ category: z.string().max(40) }), body: rolloverBody } },
    async (req) => {
      const userId = req.userId!;
      const { today } = await userBasics(userId);
      const [b] = await db.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.category, req.params.category))).limit(1);
      if (!b) throw notFound();
      const next = nextRollover({ unspent: b.rolloverUnspent, overspend: b.rolloverOverspend, since: b.rolloverSince }, req.body, monthOf(today));
      await db
        .update(budgets)
        .set({ rolloverUnspent: next.unspent, rolloverOverspend: next.overspend, rolloverSince: next.since, updatedAt: new Date() })
        .where(eq(budgets.id, b.id));
      refreshAlerts(userId, (o, m) => req.log.warn(o, m));
      return budgetsView(userId, monthOf(today));
    },
  );

  app.put("/budgets-total/rollover", { preHandler: requireAuth, schema: { body: rolloverBody } }, async (req) => {
    const userId = req.userId!;
    const { today, monthlyRollover } = await userBasics(userId);
    const next = nextRollover(monthlyRollover, req.body, monthOf(today));
    await db
      .update(users)
      .set({ budgetRolloverUnspent: next.unspent, budgetRolloverOverspend: next.overspend, budgetRolloverSince: next.since })
      .where(eq(users.id, userId));
    refreshAlerts(userId, (o, m) => req.log.warn(o, m));
    return budgetsView(userId, monthOf(today));
  });

  // Overall monthly budget (also settable via PATCH /me).
  app.put(
    "/budgets-total",
    { preHandler: requireAuth, schema: { body: z.object({ amount: money.nullable() }) } },
    async (req) => {
      const amt = req.body.amount;
      await db
        .update(users)
        .set({ monthlyBudget: amt === null || amt === 0 ? null : toDbAmount(amt) })
        .where(eq(users.id, req.userId!));
      refreshAlerts(req.userId!, (o, m) => req.log.warn(o, m));
      return budgetsView(req.userId!, monthOf((await userBasics(req.userId!)).today));
    },
  );

  // ---------------------------------------------------------------- net worth

  async function netWorthView(userId: string) {
    const { currency } = await userBasics(userId);
    const inputs = await loadNetWorthInputs(userId);
    return computeNetWorth({ currency, ...inputs });
  }

  app.get("/net-worth", { preHandler: requireAuth }, async (req) => netWorthView(req.userId!));

  const itemBody = z.object({
    kind: z.enum(NET_WORTH_KINDS),
    type: z.enum(NET_WORTH_TYPES),
    name: z.string().trim().min(1).max(80),
    amount: money,
  });

  app.post("/net-worth/items", { preHandler: requireAuth, schema: { body: itemBody } }, async (req, reply) => {
    const b = req.body;
    const [row] = await db
      .insert(netWorthItems)
      .values({ userId: req.userId!, kind: b.kind, type: b.type, name: b.name, amount: toDbAmount(b.amount) })
      .returning();
    return reply.code(201).send(netWorthItemView(row));
  });

  app.patch(
    "/net-worth/items/:id",
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }), body: itemBody.partial().strict() } },
    async (req) => {
      if (!UUID.test(req.params.id)) throw notFound();
      const { amount, ...rest } = req.body;
      const [row] = await db
        .update(netWorthItems)
        .set({ ...rest, ...(amount !== undefined ? { amount: toDbAmount(amount) } : {}), updatedAt: new Date() })
        .where(and(eq(netWorthItems.id, req.params.id), eq(netWorthItems.userId, req.userId!)))
        .returning();
      if (!row) throw notFound();
      return netWorthItemView(row);
    },
  );

  app.delete("/net-worth/items/:id", { preHandler: requireAuth, schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw notFound();
    const del = await db
      .delete(netWorthItems)
      .where(and(eq(netWorthItems.id, req.params.id), eq(netWorthItems.userId, req.userId!)))
      .returning({ id: netWorthItems.id });
    if (del.length === 0) throw notFound();
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- household

  const needHousehold = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!householdEnabled()) return reply.code(404).send({ error: "not_found" });
  };

  app.get("/household", { preHandler: [requireAuth, needHousehold] }, async (req) => ({ household: await householdView(req.userId!) }));

  app.post(
    "/household/invites",
    // Starting or growing a household is Plus; joining one a Plus member invited you to is free.
    { preHandler: [requireAuth, needHousehold, requirePlus("household")], schema: { body: z.object({ email: z.string().trim().email().max(200) }) } },
    async (req, reply) => {
      if (!inviteLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
      const r = await createInvite(req.userId!, req.body.email, (msg) => req.log.info({ userId: req.userId }, msg));
      return reply.code(201).send({ ...r, household: await householdView(req.userId!) });
    },
  );

  app.delete(
    "/household/invites/:id",
    { preHandler: [requireAuth, needHousehold], schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) throw notFound();
      await cancelInvite(req.userId!, req.params.id);
      return reply.code(204).send();
    },
  );

  app.get(
    "/household/join",
    { preHandler: [requireAuth, needHousehold], schema: { querystring: z.object({ token: z.string().min(10).max(200) }) } },
    async (req) => previewInvite(req.userId!, req.query.token),
  );

  app.post(
    "/household/join",
    { preHandler: [requireAuth, needHousehold], schema: { body: z.object({ token: z.string().min(10).max(200) }) } },
    async (req) => {
      await acceptInvite(req.userId!, req.body.token);
      req.log.info({ userId: req.userId }, "household joined");
      return { household: await householdView(req.userId!) };
    },
  );

  app.delete("/household/members/me", { preHandler: [requireAuth, needHousehold] }, async (req, reply) => {
    await leaveHousehold(req.userId!);
    req.log.info({ userId: req.userId }, "household left");
    return reply.code(204).send();
  });
}

