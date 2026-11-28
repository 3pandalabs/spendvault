// SpendVault Plus billing: Stripe Checkout (subscription mode), the Customer
// Portal, and the signed, idempotent webhook. Behind BILLING (default off).
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { stripeEvents, users } from "../db/schema.js";
import { env } from "../env.js";
import { billingSummary } from "../lib/billing/entitlements.js";
import { createCheckoutSession, createPortalSession, priceIdFor, stripeConfigured } from "../lib/billing/stripe.js";
import { reduceStripeEvent, verifyStripeSignature, type PlanUpdate, type StripeEvent } from "../lib/billing/stripeEvents.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { FEATURE_PLANS, FREE_CORE, FREE_LIMITS, INTERVALS, PLUS_FEATURES, PLUS_PRICES, priceCurrencyFor } from "../lib/plan.js";

const checkoutLimiter = keyedLimiter(10, 60 * 60_000);

/** Applies one reduced event inside the transaction that recorded its id. Returns what happened (for logs). */
async function applyUpdate(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], eventId: string, u: PlanUpdate): Promise<string> {
  let [row] = u.userId
    ? await tx.select().from(users).where(and(eq(users.id, u.userId), isNull(users.deletedAt))).limit(1)
    : [];
  if (!row && u.customerId) [row] = await tx.select().from(users).where(eq(users.stripeCustomerId, u.customerId)).limit(1);
  if (!row) return "no_user";
  await tx.update(stripeEvents).set({ userId: row.id }).where(eq(stripeEvents.id, eventId));

  const set: Partial<typeof users.$inferInsert> = {};
  if (u.customerId && !row.stripeCustomerId) set.stripeCustomerId = u.customerId;
  // An event about an older subscription must not downgrade the current one.
  const otherSub = Boolean(u.subscriptionId && row.stripeSubscriptionId && u.subscriptionId !== row.stripeSubscriptionId);
  const stale = row.planEventAt !== null && u.eventAt.getTime() < row.planEventAt.getTime();
  if (!stale && !(otherSub && u.plan === "free")) {
    if (u.subscriptionId) set.stripeSubscriptionId = u.subscriptionId;
    set.plan = u.plan;
    set.planStatus = u.status;
    if (u.interval) set.planInterval = u.interval;
    if (u.renewsAt) set.planRenewsAt = u.renewsAt;
    set.planCancelAtPeriodEnd = u.cancelAtPeriodEnd;
    set.planEventAt = u.eventAt;
  }
  if (Object.keys(set).length) await tx.update(users).set(set).where(eq(users.id, row.id));
  return stale ? "stale" : "applied";
}

export async function billingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Public: what Plus costs and includes (the Plan page and the home page).
  app.get("/billing/plans", async () => ({
    enabled: env.BILLING,
    prices: PLUS_PRICES,
    features: PLUS_FEATURES.map((key) => ({ key, label: FEATURE_PLANS[key].label, plan: FEATURE_PLANS[key].plan })),
    freeCore: FREE_CORE,
    freeLimits: FREE_LIMITS,
  }));

  app.post(
    "/billing/checkout",
    { preHandler: requireAuth, schema: { body: z.object({ interval: z.enum(INTERVALS) }).strict() } },
    async (req, reply) => {
      const userId = req.userId!;
      if (!env.BILLING) return reply.code(409).send({ error: "billing_off", code: "CONFLICT" });
      if (!stripeConfigured()) return reply.code(503).send({ error: "billing_unavailable", code: "UNAVAILABLE" });
      if (!checkoutLimiter(userId)) return reply.code(429).send({ error: "rate_limited" });
      const [u] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
      if (!u) return reply.code(401).send({ error: "not_authenticated" });
      if (billingSummary(u).plan === "plus") return reply.code(409).send({ error: "already_plus", code: "CONFLICT" });
      const cur = priceCurrencyFor(u.baseCurrency);
      const priceId = priceIdFor(cur, req.body.interval);
      if (!priceId) return reply.code(503).send({ error: "billing_unavailable", code: "UNAVAILABLE" });
      try {
        const s = await createCheckoutSession({ userId, email: u.email, customerId: u.stripeCustomerId, priceId, returnUrl: `${env.WEB_ORIGIN}/plan` });
        req.log.info({ userId, interval: req.body.interval, currency: cur }, "plus checkout created");
        return { url: s.url };
      } catch (err) {
        req.log.warn({ userId, err: (err as Error).message }, "plus checkout failed");
        return reply.code(502).send({ error: "billing_failed", code: "UPSTREAM" });
      }
    },
  );

  app.post("/billing/portal", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.userId!;
    if (!env.BILLING) return reply.code(409).send({ error: "billing_off", code: "CONFLICT" });
    if (!stripeConfigured()) return reply.code(503).send({ error: "billing_unavailable", code: "UNAVAILABLE" });
    const [u] = await db.select({ customerId: users.stripeCustomerId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u?.customerId) return reply.code(409).send({ error: "no_subscription", code: "CONFLICT" });
    try {
      return { url: (await createPortalSession(u.customerId, `${env.WEB_ORIGIN}/plan`)).url };
    } catch (err) {
      req.log.warn({ userId, err: (err as Error).message }, "plus portal failed");
      return reply.code(502).send({ error: "billing_failed", code: "UPSTREAM" });
    }
  });

  // Webhook in a child scope: the JSON parser here keeps the RAW string for the signature.
  await fastify.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "string" }, (_req: FastifyRequest, body: string, done: (err: Error | null, body?: string) => void) =>
      done(null, body),
    );

    hooks.post("/webhooks/stripe", async (req, reply) => {
      if (!env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "billing_unavailable" });
      const raw = req.body;
      const sig = req.headers["stripe-signature"];
      if (typeof raw !== "string" || !verifyStripeSignature(raw, typeof sig === "string" ? sig : undefined, env.STRIPE_WEBHOOK_SECRET)) {
        req.log.warn("rejected an unverified Stripe webhook");
        return reply.code(400).send({ error: "invalid_signature" });
      }
      let event: StripeEvent;
      try {
        event = JSON.parse(raw) as StripeEvent;
      } catch {
        return reply.code(400).send({ error: "invalid_json" });
      }
      const r = reduceStripeEvent(event);
      if (r.kind === "ignore") return reply.code(200).send({ ok: true, ignored: r.reason });
      const eventId = event.id!;
      const outcome = await db.transaction(async (tx) => {
        // Claim the event id first: a redelivery (or a concurrent one) does nothing.
        const claimed = await tx.insert(stripeEvents).values({ id: eventId, type: event.type! }).onConflictDoNothing().returning({ id: stripeEvents.id });
        if (!claimed.length) return "duplicate";
        return applyUpdate(tx, eventId, r.update);
      });
      req.log.info({ eventType: event.type, outcome, plan: r.update.plan }, "stripe event");
      return reply.code(200).send({ ok: true, outcome });
    });
  });
}
