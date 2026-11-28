// 0003 tools: card dues, refund watches, savings goals, Ask SpendVault.
// Every query is scoped to the caller; anything else is a 404.
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { askUsage, goalContributions, receipts, refundWatches, savingsGoals, transactions } from "../db/schema.js";
import { env } from "../env.js";
import { askDataFor } from "../lib/ask/db.js";
import { askSpendVault, MAX_QUESTION_CHARS } from "../lib/ask/run.js";
import { globalLimiter } from "../plugins/rateLimit.js";
import { invalid, notFound } from "../lib/errors.js";
import { num, toDbAmount, toNum } from "../lib/money.js";
import { loadCardDues, loadGoals, refundWatchViews, syncRefundWatches, userBasicsRow } from "../lib/toolsDb.js";
import { todayFor } from "../lib/userTime.js";

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().min(0).max(1e11);

/** Ask SpendVault questions per user per rolling 24 hours (free tier). */
export const ASK_DAILY_LIMIT = 20;
const askGlobal = globalLimiter(600, 60 * 60_000); // whole API: 600 questions/hour ceiling

let client: Anthropic | null = null;
const llm = () => (env.ANTHROPIC_API_KEY ? (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 })) : null);

async function basics(userId: string) {
  const u = await userBasicsRow(userId);
  if (!u) throw notFound();
  return { currency: u.baseCurrency, monthlyBudget: toNum(u.monthlyBudget), today: todayFor(u) };
}

async function askedToday(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(askUsage)
    .where(and(eq(askUsage.userId, userId), gt(askUsage.createdAt, sql`now() - interval '24 hours'`)));
  return r?.n ?? 0;
}

export async function toolRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------- cards

  app.get("/cards", { preHandler: requireAuth }, async (req) => {
    const { today } = await basics(req.userId!);
    return { items: await loadCardDues(req.userId!, today) };
  });

  // ---------------------------------------------------------------- refunds

  app.get("/refunds", { preHandler: requireAuth }, async (req) => {
    const { today } = await basics(req.userId!);
    const rows = await syncRefundWatches(req.userId!);
    return { items: await refundWatchViews(req.userId!, rows, today) };
  });

  app.post(
    "/refunds",
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({ transactionId: UUID.optional(), receiptId: UUID.optional(), returnedOn: DATE.optional(), amount: money.optional() })
          .refine((b) => b.transactionId || b.receiptId, "transactionId or receiptId"),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const { today } = await basics(userId);
      const b = req.body;
      let merchant: string | null = null;
      let amount: number | null = null;
      let currency: string | null = null;
      let transactionId: string | null = b.transactionId ?? null;
      let receiptId: string | null = b.receiptId ?? null;
      if (receiptId) {
        const [r] = await db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId))).limit(1);
        if (!r) throw notFound();
        merchant = r.merchant;
        amount = toNum(r.total);
        currency = r.currency;
        transactionId ??= r.transactionId;
      }
      if (transactionId) {
        const [t] = await db.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId))).limit(1);
        if (!t) throw notFound();
        if (t.direction !== "debit") throw invalid("refund_debits_only");
        merchant ??= t.merchant;
        amount ??= num(t.amount);
        currency = t.currency;
        if (!receiptId) {
          const [r] = await db.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.transactionId, t.id), eq(receipts.userId, userId))).limit(1);
          receiptId = r?.id ?? null;
        }
      }
      const expected = b.amount ?? amount;
      if (!expected || expected <= 0) throw invalid("amount_required");
      const existing = await db
        .select()
        .from(refundWatches)
        .where(
          and(
            eq(refundWatches.userId, userId),
            transactionId ? eq(refundWatches.transactionId, transactionId) : eq(refundWatches.receiptId, receiptId!),
          ),
        )
        .limit(1);
      if (existing.length) return reply.code(409).send({ error: "already_returned", code: "CONFLICT" });
      await db.insert(refundWatches).values({
        userId,
        transactionId,
        receiptId,
        merchant: (merchant ?? "Merchant").slice(0, 120),
        amount: toDbAmount(expected),
        currency: currency ?? "USD",
        returnedOn: b.returnedOn ?? today,
      });
      const rows = await syncRefundWatches(userId);
      const views = await refundWatchViews(userId, rows, today);
      const mine = views.find((v) => (transactionId ? v.transactionId === transactionId : v.receiptId === receiptId));
      return reply.code(201).send(mine);
    },
  );

  /** Stop waiting (refund came some other way, or you kept the item after all). */
  app.post("/refunds/:id/close", { preHandler: requireAuth, schema: { params: z.object({ id: UUID }) } }, async (req) => {
    const { today } = await basics(req.userId!);
    const [w] = await db
      .update(refundWatches)
      .set({ resolvedAt: new Date() })
      .where(and(eq(refundWatches.id, req.params.id), eq(refundWatches.userId, req.userId!)))
      .returning();
    if (!w) throw notFound();
    return (await refundWatchViews(req.userId!, [w], today))[0];
  });

  app.delete("/refunds/:id", { preHandler: requireAuth, schema: { params: z.object({ id: UUID }) } }, async (req, reply) => {
    const del = await db.delete(refundWatches).where(and(eq(refundWatches.id, req.params.id), eq(refundWatches.userId, req.userId!))).returning({ id: refundWatches.id });
    if (!del.length) throw notFound();
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- goals

  const goalView = async (userId: string, id: string, today: string) => {
    const g = (await loadGoals(userId, today)).find((x) => x.id === id);
    if (!g) throw notFound();
    return g;
  };

  app.get("/goals", { preHandler: requireAuth }, async (req) => {
    const { today, currency } = await basics(req.userId!);
    return { currency, items: await loadGoals(req.userId!, today) };
  });

  const goalBody = z.object({ name: z.string().trim().min(1).max(80), targetAmount: money.refine((n) => n > 0, "must be > 0"), targetDate: DATE.nullable().optional() });

  app.post("/goals", { preHandler: requireAuth, schema: { body: goalBody.extend({ startingAmount: money.optional() }) } }, async (req, reply) => {
    const userId = req.userId!;
    const { today, currency } = await basics(userId);
    const count = await db.select({ n: sql<number>`count(*)::int` }).from(savingsGoals).where(eq(savingsGoals.userId, userId));
    if ((count[0]?.n ?? 0) >= 20) throw invalid("too_many_goals");
    const [g] = await db
      .insert(savingsGoals)
      .values({ userId, name: req.body.name, targetAmount: toDbAmount(req.body.targetAmount), targetDate: req.body.targetDate ?? null, currency })
      .returning();
    if (req.body.startingAmount && req.body.startingAmount > 0) {
      await db.insert(goalContributions).values({ goalId: g.id, userId, amount: toDbAmount(req.body.startingAmount), contributedOn: today, note: "Starting amount" });
    }
    return reply.code(201).send(await goalView(userId, g.id, today));
  });

  app.patch("/goals/:id", { preHandler: requireAuth, schema: { params: z.object({ id: UUID }), body: goalBody.partial().strict() } }, async (req) => {
    const { today } = await basics(req.userId!);
    const b = req.body;
    const [g] = await db
      .update(savingsGoals)
      .set({
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.targetAmount !== undefined ? { targetAmount: toDbAmount(b.targetAmount) } : {}),
        ...(b.targetDate !== undefined ? { targetDate: b.targetDate } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(savingsGoals.id, req.params.id), eq(savingsGoals.userId, req.userId!)))
      .returning({ id: savingsGoals.id });
    if (!g) throw notFound();
    return goalView(req.userId!, g.id, today);
  });

  app.delete("/goals/:id", { preHandler: requireAuth, schema: { params: z.object({ id: UUID }) } }, async (req, reply) => {
    const del = await db.delete(savingsGoals).where(and(eq(savingsGoals.id, req.params.id), eq(savingsGoals.userId, req.userId!))).returning({ id: savingsGoals.id });
    if (!del.length) throw notFound();
    return reply.code(204).send();
  });

  app.post(
    "/goals/:id/contributions",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: UUID }),
        body: z.object({ amount: z.number().finite().min(-1e11).max(1e11).refine((n) => n !== 0, "non-zero"), contributedOn: DATE.optional(), note: z.string().trim().max(120).nullable().optional() }),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const { today } = await basics(userId);
      const [g] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(and(eq(savingsGoals.id, req.params.id), eq(savingsGoals.userId, userId))).limit(1);
      if (!g) throw notFound();
      await db.insert(goalContributions).values({ goalId: g.id, userId, amount: toDbAmount(req.body.amount), contributedOn: req.body.contributedOn ?? today, note: req.body.note || null });
      return reply.code(201).send(await goalView(userId, g.id, today));
    },
  );

  app.delete(
    "/goals/:id/contributions/:cid",
    { preHandler: requireAuth, schema: { params: z.object({ id: UUID, cid: UUID }) } },
    async (req) => {
      const userId = req.userId!;
      const { today } = await basics(userId);
      const del = await db
        .delete(goalContributions)
        .where(and(eq(goalContributions.id, req.params.cid), eq(goalContributions.goalId, req.params.id), eq(goalContributions.userId, userId)))
        .returning({ id: goalContributions.id });
      if (!del.length) throw notFound();
      return goalView(userId, req.params.id, today);
    },
  );

  // ---------------------------------------------------------------- Ask SpendVault

  app.get("/ask/usage", { preHandler: requireAuth }, async (req) => ({
    available: Boolean(env.ANTHROPIC_API_KEY),
    used: await askedToday(req.userId!),
    limit: ASK_DAILY_LIMIT,
  }));

  app.post(
    "/ask",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          question: z.string().trim().min(2).max(MAX_QUESTION_CHARS),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(12).optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const c = llm();
      if (!c) return reply.code(503).send({ error: "llm_unavailable", code: "UNAVAILABLE" });
      const used = await askedToday(userId);
      if (used >= ASK_DAILY_LIMIT) return reply.code(429).send({ error: "ask_limit_reached", code: "RATE_LIMITED" });
      if (!askGlobal()) return reply.code(429).send({ error: "rate_limited" });
      const { currency, today, monthlyBudget } = await basics(userId);
      try {
        const r = await askSpendVault(c, env.ANTHROPIC_MODEL, { question: req.body.question, history: req.body.history, data: askDataFor(userId, currency, today, monthlyBudget) });
        await db.insert(askUsage).values({ userId, model: env.ANTHROPIC_MODEL, inputTokens: r.inputTokens, outputTokens: r.outputTokens, toolCalls: r.toolCalls, ok: r.stop === "answered" });
        // Ids and counts only: never the question or the answer.
        req.log.info({ userId, toolCalls: r.toolCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, stop: r.stop }, "ask answered");
        return { answer: r.answer, toolsUsed: r.toolsUsed, usage: { used: used + 1, limit: ASK_DAILY_LIMIT } };
      } catch (err) {
        await db.insert(askUsage).values({ userId, model: env.ANTHROPIC_MODEL, ok: false });
        req.log.warn({ userId, err: err instanceof Anthropic.APIError ? `api_${err.status}` : (err as Error).name }, "ask failed");
        return reply.code(502).send({ error: "ask_failed", code: "UPSTREAM" });
      }
    },
  );
}
