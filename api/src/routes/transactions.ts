import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { accounts, categoryRules, transactions } from "../db/schema.js";
import { CATEGORIES, CATEGORY_KEYS, NON_SPEND, isCategory } from "../lib/categories.js";
import { notFound } from "../lib/errors.js";
import { institutionName } from "../lib/institutions.js";
import { num } from "../lib/money.js";
import { recomputeAlertsForUser } from "../lib/insights/sweep.js";

type TxnRow = typeof transactions.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The `Transaction` shape from ROUTES.md. */
export function transactionView(t: TxnRow) {
  return {
    id: t.id,
    accountId: t.accountId,
    documentId: t.documentId,
    postedOn: t.postedOn,
    descriptionRaw: t.descriptionRaw,
    merchant: t.merchant,
    category: t.category,
    amount: num(t.amount),
    direction: t.direction,
    currency: t.currency,
    sourceKind: t.sourceKind,
    categoryLocked: t.categoryLocked,
  };
}

/** The `Account` shape from ROUTES.md. */
export function accountView(a: AccountRow, txnCount: number, lastTxnOn: string | null) {
  return {
    id: a.id,
    institution: a.institution,
    institutionName: institutionName(a.institution),
    kind: a.kind,
    last4: a.last4,
    label: a.label,
    currency: a.currency,
    txnCount,
    lastTxnOn,
  };
}

async function accountWithCounts(userId: string, a: AccountRow) {
  const r = await db.execute<{ n: number; last: string | null }>(sql`
    SELECT count(*)::int AS n, max(posted_on)::text AS last FROM transactions
    WHERE user_id = ${userId} AND account_id = ${a.id} AND superseded_by IS NULL`);
  return accountView(a, r.rows[0]?.n ?? 0, r.rows[0]?.last ?? null);
}

// Cursor = base64url JSON of the last row's (postedOn, id).
const encodeCursor = (t: { postedOn: string; id: string }) => Buffer.from(JSON.stringify([t.postedOn, t.id])).toString("base64url");
function decodeCursor(c: string): { postedOn: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && DATE.test(v[0]) && typeof v[1] === "string" && UUID.test(v[1])) {
      return { postedOn: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function transactionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/categories", async () => ({
    items: CATEGORY_KEYS.map((key) => ({
      key,
      label: CATEGORIES[key].label,
      essential: CATEGORIES[key].essential,
      spend: !NON_SPEND.has(key),
    })),
  }));

  // ---------------------------------------------------------------- accounts

  app.get("/accounts", { preHandler: requireAuth }, async (req) => {
    const userId = req.userId!;
    const [rows, counts] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.createdAt),
      db.execute<{ account_id: string; n: number; last: string | null }>(sql`
        SELECT account_id, count(*)::int AS n, max(posted_on)::text AS last FROM transactions
        WHERE user_id = ${userId} AND superseded_by IS NULL AND account_id IS NOT NULL GROUP BY account_id`),
    ]);
    const byAcct = new Map(counts.rows.map((r) => [r.account_id, r]));
    return { items: rows.map((a) => accountView(a, byAcct.get(a.id)?.n ?? 0, byAcct.get(a.id)?.last ?? null)) };
  });

  app.patch(
    "/accounts/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ label: z.string().trim().max(60).nullable() }),
      },
    },
    async (req) => {
      if (!UUID.test(req.params.id)) throw notFound();
      const label = req.body.label ? req.body.label : null;
      const [a] = await db
        .update(accounts)
        .set({ label })
        .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
        .returning();
      if (!a) throw notFound();
      return accountWithCounts(req.userId!, a);
    },
  );

  // ---------------------------------------------------------------- transactions

  app.get(
    "/transactions",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          from: z.string().regex(DATE).optional(),
          to: z.string().regex(DATE).optional(),
          category: z.string().max(40).optional(),
          accountId: z.string().max(40).optional(),
          q: z.string().trim().max(100).optional(),
          direction: z.enum(["debit", "credit"]).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          cursor: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const qs = req.query;
      if (qs.accountId && !UUID.test(qs.accountId)) return { items: [], nextCursor: null };
      const cursor = qs.cursor ? decodeCursor(qs.cursor) : null;
      if (qs.cursor && !cursor) return reply.code(400).send({ error: "invalid_cursor", code: "VALIDATION" });
      const like = qs.q ? `%${escapeLike(qs.q)}%` : null;
      const rows = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, req.userId!),
            isNull(transactions.supersededBy),
            qs.from ? gte(transactions.postedOn, qs.from) : undefined,
            qs.to ? lte(transactions.postedOn, qs.to) : undefined,
            qs.category ? eq(transactions.category, qs.category) : undefined,
            qs.accountId ? eq(transactions.accountId, qs.accountId) : undefined,
            qs.direction ? eq(transactions.direction, qs.direction) : undefined,
            like ? or(ilike(transactions.merchant, like), ilike(transactions.descriptionRaw, like)) : undefined,
            cursor ? sql`(${transactions.postedOn}, ${transactions.id}) < (${cursor.postedOn}::date, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(transactions.postedOn), desc(transactions.id))
        .limit(qs.limit + 1);
      const page = rows.slice(0, qs.limit);
      return {
        items: page.map(transactionView),
        nextCursor: rows.length > qs.limit ? encodeCursor(page[page.length - 1]) : null,
      };
    },
  );

  app.patch(
    "/transactions/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          category: z.string().refine(isCategory, "unknown category"),
          applyToMerchant: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const userId = req.userId!;
      if (!UUID.test(req.params.id)) throw notFound();
      const { category, applyToMerchant } = req.body;
      const updated = await db.transaction(async (tx) => {
        const [t] = await tx
          .update(transactions)
          .set({ category, categoryLocked: true })
          .where(and(eq(transactions.id, req.params.id), eq(transactions.userId, userId)))
          .returning();
        if (!t) return null;
        if (applyToMerchant) {
          const key = t.merchant.trim().toLowerCase();
          await tx
            .insert(categoryRules)
            .values({ userId, merchant: key, category })
            .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.merchant], set: { category } });
          await tx
            .update(transactions)
            .set({ category })
            .where(
              and(
                eq(transactions.userId, userId),
                eq(transactions.categoryLocked, false),
                sql`lower(trim(${transactions.merchant})) = ${key}`,
              ),
            );
        }
        return t;
      });
      if (!updated) throw notFound();
      // Categories feed the spike detector; refresh this user's alerts (fail-soft).
      void recomputeAlertsForUser(userId).catch((err) => req.log.warn({ userId, err: String(err) }, "alert recompute failed"));
      return transactionView(updated);
    },
  );
}
