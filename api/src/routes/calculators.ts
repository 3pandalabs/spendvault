// Calculators (0005): the math runs in the browser (web/src/lib/calc.ts). The
// API only pre-fills from the caller's own data and keeps optional saved inputs.
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { calculatorScenarios } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { loadNetWorthInputs, loadTxns } from "../lib/insights/load.js";
import { computeNetWorth } from "../lib/insights/networth.js";
import { spendAverages } from "../lib/insights/prefill.js";
import { addMonths, monthStart } from "../lib/insights/util.js";
import { loadCardDues, loadGoals, userBasicsRow } from "../lib/toolsDb.js";
import { todayFor } from "../lib/userTime.js";

export const CALCULATORS = ["fire", "compound", "loan", "card_payoff", "emergency", "retirement", "inflation", "savings_goal"] as const;

/** Saved inputs: a flat map of ≤ 40 numbers / short strings / booleans (or arrays of such maps for card lists). */
const scalar = z.union([z.number().finite(), z.string().max(80), z.boolean(), z.null()]);
const inputsSchema = z
  .record(z.string().max(40), z.union([scalar, z.array(z.record(z.string().max(40), scalar)).max(20)]))
  .refine((o) => Object.keys(o).length <= 40, "too many fields")
  .refine((o) => JSON.stringify(o).length <= 8000, "too large");

export async function calculatorRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/calculators/prefill", { preHandler: requireAuth }, async (req) => {
    const userId = req.userId!;
    const u = await userBasicsRow(userId);
    if (!u) throw notFound();
    const today = todayFor(u);
    const currency = u.baseCurrency;
    const [txns, nwInputs, dues, goals] = await Promise.all([
      loadTxns(userId, currency, monthStart(addMonths(today.slice(0, 7), -6))),
      loadNetWorthInputs(userId),
      loadCardDues(userId, today),
      loadGoals(userId, today),
    ]);
    const nw = computeNetWorth({ currency, ...nwInputs });
    return {
      currency,
      ...spendAverages(txns, currency, today),
      netWorth: nw.hasData ? nw.netWorth : null,
      cards: dues
        .filter((d) => d.currency === currency && (d.statementBalance ?? 0) > 0)
        .map((d) => ({ accountId: d.accountId, label: d.label, balance: d.statementBalance, minimumDue: d.minimumDue })),
      goals: goals.map((g) => ({ id: g.id, name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate, saved: g.progress.saved })),
    };
  });

  app.get("/calculator-scenarios", { preHandler: requireAuth }, async (req) => {
    const rows = await db.select().from(calculatorScenarios).where(eq(calculatorScenarios.userId, req.userId!));
    return { items: rows.map((r) => ({ calculator: r.calculator, inputs: r.inputs, updatedAt: r.updatedAt.toISOString() })) };
  });

  app.put(
    "/calculator-scenarios/:calculator",
    { preHandler: requireAuth, schema: { params: z.object({ calculator: z.enum(CALCULATORS) }), body: z.object({ inputs: inputsSchema }).strict() } },
    async (req) => {
      const now = new Date();
      const [r] = await db
        .insert(calculatorScenarios)
        .values({ userId: req.userId!, calculator: req.params.calculator, inputs: req.body.inputs, updatedAt: now })
        .onConflictDoUpdate({ target: [calculatorScenarios.userId, calculatorScenarios.calculator], set: { inputs: req.body.inputs, updatedAt: now } })
        .returning();
      return { calculator: r.calculator, inputs: r.inputs, updatedAt: r.updatedAt.toISOString() };
    },
  );

  app.delete(
    "/calculator-scenarios/:calculator",
    { preHandler: requireAuth, schema: { params: z.object({ calculator: z.enum(CALCULATORS) }) } },
    async (req, reply) => {
      const del = await db
        .delete(calculatorScenarios)
        .where(and(eq(calculatorScenarios.userId, req.userId!), eq(calculatorScenarios.calculator, req.params.calculator)))
        .returning({ id: calculatorScenarios.id });
      if (!del.length) throw notFound();
      return reply.code(204).send();
    },
  );
}
