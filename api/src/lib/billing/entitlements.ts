// DB side of SpendVault Plus: the caller's effective plan and the gates routes
// use. The split itself lives in lib/plan.ts.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { env } from "../../env.js";
import { effectivePlan, featureMap, hasFeature, limitsFor, plusRequired, type Plan, type PlanFields, type PlusFeature } from "../plan.js";

type UserPlanRow = PlanFields & {
  planInterval: string | null;
  planCancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
};

export async function planOf(userId: string): Promise<Plan> {
  if (!env.BILLING) return "plus";
  const [u] = await db
    .select({ plan: users.plan, planStatus: users.planStatus, planRenewsAt: users.planRenewsAt })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return u ? effectivePlan(u, true) : "free";
}

/** At least one of these users is on Plus (a household shares its owner's plan). */
export async function anyOnPlus(userIds: readonly string[]): Promise<boolean> {
  if (!env.BILLING) return true;
  if (userIds.length === 0) return false;
  const rows = await db
    .select({ plan: users.plan, planStatus: users.planStatus, planRenewsAt: users.planRenewsAt })
    .from(users)
    .where(and(inArray(users.id, [...userIds]), isNull(users.deletedAt)));
  return rows.some((u) => effectivePlan(u, true) === "plus");
}

/** preHandler: 402 plus_required unless the caller's plan has `feature`. Use after requireAuth. */
export const requirePlus = (feature: PlusFeature) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.userId) return;
  if (!hasFeature(await planOf(req.userId), feature)) return reply.code(402).send(plusRequired(feature));
};

/** The `billing` block of GET /me. */
export function billingSummary(u: UserPlanRow) {
  const plan = effectivePlan(u, env.BILLING);
  return {
    plan,
    billing: {
      enabled: env.BILLING,
      status: env.BILLING ? u.planStatus : null,
      interval: env.BILLING && (u.planInterval === "month" || u.planInterval === "year") ? u.planInterval : null,
      renewsAt: env.BILLING && u.planRenewsAt ? u.planRenewsAt.toISOString() : null,
      cancelAtPeriodEnd: env.BILLING ? u.planCancelAtPeriodEnd : false,
      hasCustomer: Boolean(u.stripeCustomerId),
      features: featureMap(plan),
      limits: limitsFor(plan),
    },
  };
}
