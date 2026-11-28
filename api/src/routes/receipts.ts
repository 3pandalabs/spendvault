import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { RECEIPT_STATUSES, documents, receiptItems, receipts, transactions } from "../db/schema.js";
import { env } from "../env.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { decrypt } from "../lib/crypto.js";
import { isCategory } from "../lib/categories.js";
import { enqueueSafely } from "../lib/ingest/queue.js";
import { registerRateLimit } from "../plugins/rateLimit.js";
import { toDbAmount } from "../lib/money.js";
import {
  candidatesFor,
  matchReceipt,
  receiptDocColumns,
  receiptItemCount,
  receiptItemView,
  receiptView,
  rematchReceiptsForUser,
  type ReceiptRow,
} from "../lib/receipts/db.js";
import { transactionView } from "./transactions.js";

// Receipts (api/ROUTES.md "Receipts") + GET /transactions/:id, the
// transaction detail view that carries the linked receipt's line items.
// Every query is scoped by user id; anything else is a 404.

const MINUTE = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const idParam = z.object({ id: z.string().uuid() });
const rematchLimiter = keyedLimiter(20, 60 * MINUTE);
const notFound = { error: "not_found", code: "NOT_FOUND" } as const;

type DocCols = { source: (typeof documents.$inferSelect)["source"]; filename: string | null; mimeType: string; hasOriginal: boolean; createdAt: Date };

async function ownReceipt(userId: string, id: string): Promise<{ r: ReceiptRow; d: DocCols } | null> {
  const [row] = await db
    .select({ r: receipts, ...receiptDocColumns })
    .from(receipts)
    .innerJoin(documents, eq(documents.id, receipts.documentId))
    .where(and(eq(receipts.id, id), eq(receipts.userId, userId)))
    .limit(1);
  if (!row) return null;
  const { r, ...d } = row;
  return { r, d };
}

/** The `ReceiptDetail` shape from ROUTES.md. */
export async function receiptDetail(userId: string, id: string) {
  const own = await ownReceipt(userId, id);
  if (!own) return null;
  const items = await db
    .select()
    .from(receiptItems)
    .where(and(eq(receiptItems.receiptId, own.r.id), eq(receiptItems.userId, userId)))
    .orderBy(asc(receiptItems.position));
  let transaction = null;
  if (own.r.transactionId) {
    const [t] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, own.r.transactionId), eq(transactions.userId, userId)))
      .limit(1);
    transaction = t ? transactionView(t, own.r.id) : null;
  }
  return { ...receiptView(own.r, own.d, items.length), items: items.map(receiptItemView), transaction };
}

// Cursor = base64url "createdAtISO|id" (same scheme as /documents).
const encodeCursor = (r: ReceiptRow) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  const [ts, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  const createdAt = new Date(ts);
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}

export async function receiptRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/receipts",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          match: z.enum(["all", "matched", "unmatched"]).default("all"),
          status: z.enum(RECEIPT_STATUSES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { match, status, limit, cursor } = req.query;
      const c = cursor ? decodeCursor(cursor) : null;
      if (cursor && !c) return reply.code(400).send({ error: "invalid_cursor", code: "VALIDATION" });
      const rows = await db
        .select({ r: receipts, ...receiptDocColumns, itemCount: receiptItemCount })
        .from(receipts)
        .innerJoin(documents, eq(documents.id, receipts.documentId))
        .where(
          and(
            eq(receipts.userId, req.userId!),
            match === "matched" ? isNotNull(receipts.transactionId) : match === "unmatched" ? isNull(receipts.transactionId) : undefined,
            status ? eq(receipts.status, status) : undefined,
            c
              ? sql`(date_trunc('milliseconds', ${receipts.createdAt}), ${receipts.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(sql`date_trunc('milliseconds', ${receipts.createdAt})`), desc(receipts.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        items: page.map(({ r, itemCount, ...d }) => receiptView(r, d, itemCount)),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].r) : null,
      };
    },
  );

  app.post("/receipts/rematch", { preHandler: requireAuth }, async (req, reply) => {
    if (!rematchLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
    return { matched: await rematchReceiptsForUser(req.userId!) };
  });

  app.get("/receipts/:id", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const d = await receiptDetail(req.userId!, req.params.id);
    return d ?? reply.code(404).send(notFound);
  });

  app.get("/receipts/:id/image", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const [row] = await db
      .select({ contentEnc: documents.contentEnc, mimeType: documents.mimeType })
      .from(receipts)
      .innerJoin(documents, eq(documents.id, receipts.documentId))
      .where(and(eq(receipts.id, req.params.id), eq(receipts.userId, req.userId!), eq(documents.userId, req.userId!)))
      .limit(1);
    if (!row?.contentEnc) return reply.code(404).send(notFound);
    // Only inert types go out as-is (never e.g. image/svg+xml from a mislabelled upload).
    const safe = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(row.mimeType);
    reply.header("content-type", safe ? (row.mimeType === "text/plain" ? "text/plain; charset=utf-8" : row.mimeType) : "application/octet-stream");
    reply.header("cache-control", "private, no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-disposition", "inline");
    return reply.send(decrypt(row.contentEnc, env.DATA_KEY));
  });

  app.get("/receipts/:id/candidates", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const own = await ownReceipt(req.userId!, req.params.id);
    if (!own) return reply.code(404).send(notFound);
    const ranked = await candidatesFor(req.userId!, own.r, own.d.createdAt.toISOString().slice(0, 10));
    if (!ranked.length) return { items: [] };
    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, req.userId!), sql`${transactions.id} IN (${sql.join(ranked.map((c) => sql`${c.id}::uuid`), sql`, `)})`));
    const byId = new Map(rows.map((t) => [t.id, t]));
    return {
      items: ranked.flatMap((c) => {
        const t = byId.get(c.id);
        return t ? [{ ...transactionView(t), score: c.score }] : [];
      }),
    };
  });

  // Manual entry / correction. Typing a total on a pending or failed receipt makes it "manual".
  app.patch(
    "/receipts/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z
          .object({
            merchant: z.string().trim().max(120).nullable().optional(),
            purchasedOn: z.string().regex(DATE).nullable().optional(),
            total: z.number().finite().positive().max(1e10).optional(),
            tax: z.number().finite().nonnegative().max(1e10).nullable().optional(),
            currency: z.enum(["INR", "USD"]).optional(),
          })
          .refine((b) => Object.keys(b).length > 0, "empty patch"),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const own = await ownReceipt(userId, req.params.id);
      if (!own) return reply.code(404).send(notFound);
      const b = req.body;
      const becomesManual = b.total !== undefined && own.r.status !== "extracted";
      await db.transaction(async (tx) => {
        await tx
          .update(receipts)
          .set({
            ...(b.merchant !== undefined ? { merchant: b.merchant || null } : {}),
            ...(b.purchasedOn !== undefined ? { purchasedOn: b.purchasedOn } : {}),
            ...(b.total !== undefined ? { total: toDbAmount(b.total) } : {}),
            ...(b.tax !== undefined ? { tax: b.tax === null ? null : toDbAmount(b.tax) } : {}),
            ...(b.currency ? { currency: b.currency } : {}),
            ...(becomesManual ? { status: "manual" as const, parser: "manual", error: null } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(receipts.id, own.r.id), eq(receipts.userId, userId)));
        if (becomesManual) {
          // The document is done from the pipeline's point of view; the original stays.
          await tx
            .update(documents)
            .set({ status: "parsed", error: null, parser: "manual", processedAt: new Date() })
            .where(and(eq(documents.id, own.r.documentId), eq(documents.userId, userId)));
        }
      });
      if (!own.r.transactionId) await matchReceipt(userId, own.r.id);
      return receiptDetail(userId, own.r.id);
    },
  );

  app.patch(
    "/receipts/:id/items/:itemId",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
        body: z.object({ category: z.string().refine(isCategory, "unknown category") }),
      },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const own = await ownReceipt(userId, req.params.id);
      if (!own) return reply.code(404).send(notFound);
      const done = await db
        .update(receiptItems)
        .set({ category: req.body.category, categoryLocked: true })
        .where(and(eq(receiptItems.id, req.params.itemId), eq(receiptItems.receiptId, own.r.id), eq(receiptItems.userId, userId)))
        .returning({ id: receiptItems.id });
      if (!done.length) return reply.code(404).send(notFound);
      return receiptDetail(userId, own.r.id);
    },
  );

  app.post(
    "/receipts/:id/link",
    { preHandler: requireAuth, schema: { params: idParam, body: z.object({ transactionId: z.string().uuid() }) } },
    async (req, reply) => {
      const userId = req.userId!;
      const own = await ownReceipt(userId, req.params.id);
      if (!own) return reply.code(404).send(notFound);
      const [t] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.id, req.body.transactionId), eq(transactions.userId, userId)))
        .limit(1);
      if (!t) return reply.code(404).send(notFound);
      const [other] = await db
        .select({ id: receipts.id })
        .from(receipts)
        .where(and(eq(receipts.transactionId, t.id), sql`${receipts.id} <> ${own.r.id}::uuid`))
        .limit(1);
      if (other) return reply.code(409).send({ error: "transaction_already_linked", code: "CONFLICT" });
      await db
        .update(receipts)
        .set({
          transactionId: t.id,
          matchStatus: "confirmed",
          matchedAt: new Date(),
          rejectedTxnIds: own.r.rejectedTxnIds.filter((x) => x !== t.id),
          updatedAt: new Date(),
        })
        .where(and(eq(receipts.id, own.r.id), eq(receipts.userId, userId)));
      return receiptDetail(userId, own.r.id);
    },
  );

  app.post("/receipts/:id/confirm", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const userId = req.userId!;
    const own = await ownReceipt(userId, req.params.id);
    if (!own) return reply.code(404).send(notFound);
    if (!own.r.transactionId) return reply.code(409).send({ error: "not_linked", code: "CONFLICT" });
    await db
      .update(receipts)
      .set({ matchStatus: "confirmed", updatedAt: new Date() })
      .where(and(eq(receipts.id, own.r.id), eq(receipts.userId, userId)));
    return receiptDetail(userId, own.r.id);
  });

  app.post("/receipts/:id/unlink", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const userId = req.userId!;
    const own = await ownReceipt(userId, req.params.id);
    if (!own) return reply.code(404).send(notFound);
    const prev = own.r.transactionId;
    await db
      .update(receipts)
      .set({
        transactionId: null,
        matchStatus: "unmatched",
        matchedAt: null,
        // Remember the "no" so auto-match never re-links this pair.
        rejectedTxnIds: prev && !own.r.rejectedTxnIds.includes(prev) ? [...own.r.rejectedTxnIds, prev].slice(-50) : own.r.rejectedTxnIds,
        updatedAt: new Date(),
      })
      .where(and(eq(receipts.id, own.r.id), eq(receipts.userId, userId)));
    return receiptDetail(userId, own.r.id);
  });

  app.post(
    "/receipts/:id/extract",
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE } }, schema: { params: idParam } },
    async (req, reply) => {
      const userId = req.userId!;
      const own = await ownReceipt(userId, req.params.id);
      if (!own) return reply.code(404).send(notFound);
      if (!env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "llm_unavailable", code: "UNAVAILABLE" });
      if (!own.d.hasOriginal) return reply.code(409).send({ error: "original_deleted", code: "CONFLICT" });
      await db.transaction(async (tx) => {
        await tx.update(documents).set({ status: "received", error: null }).where(and(eq(documents.id, own.r.documentId), eq(documents.userId, userId)));
        await tx.update(receipts).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(receipts.id, own.r.id));
      });
      await enqueueSafely(own.r.documentId);
      return reply.code(202).send(await receiptDetail(userId, own.r.id));
    },
  );

  app.delete("/receipts/:id", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const userId = req.userId!;
    const own = await ownReceipt(userId, req.params.id);
    if (!own) return reply.code(404).send(notFound);
    // The document row holds the encrypted image; deleting it cascades to the receipt and items.
    await db.delete(documents).where(and(eq(documents.id, own.r.documentId), eq(documents.userId, userId)));
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- transaction detail

  app.get("/transactions/:id", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const userId = req.userId!;
    const [t] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, req.params.id), eq(transactions.userId, userId)))
      .limit(1);
    if (!t) return reply.code(404).send(notFound);
    const [r] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.transactionId, t.id), eq(receipts.userId, userId)))
      .limit(1);
    const receipt = r ? await receiptDetail(userId, r.id) : null;
    return { ...transactionView(t, r?.id ?? null), receipt };
  });
}

