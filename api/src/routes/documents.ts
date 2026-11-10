import multipart from "@fastify/multipart";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { DOCUMENT_STATUSES, documents, pdfPasswords, transactions, type DocumentSource } from "../db/schema.js";
import { env } from "../env.js";
import { encrypt } from "../lib/crypto.js";
import { INSTITUTIONS, institutionByKey, institutionFromText } from "../lib/institutions.js";
import { fileTypeOf, mimeFor } from "../lib/ingest/classify.js";
import { enqueueSafely } from "../lib/ingest/queue.js";
import { ingestEmail, storeDocument, type DocRow } from "../lib/ingest/store.js";
import { documentView } from "../lib/ingest/view.js";
import { registerRateLimit } from "../plugins/rateLimit.js";

// Documents, PDF passwords and the public institution list (api/ROUTES.md).

const MINUTE = 60_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const idParam = z.object({ id: z.string().uuid() });

function encodeCursor(d: DocRow): string {
  return Buffer.from(`${d.createdAt.toISOString()}|${d.id}`).toString("base64url");
}
function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  const [ts, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  const createdAt = new Date(ts);
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}

function passwordView(p: typeof pdfPasswords.$inferSelect) {
  return { id: p.id, institution: p.institution, label: p.label, lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null, createdAt: p.createdAt.toISOString() };
}

async function ownDocument(userId: string, id: string): Promise<DocRow | undefined> {
  const [d] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.userId, userId))).limit(1);
  return d;
}

/** Re-queue a user's documents waiting for a password (after a new one is saved). */
async function requeueNeedsPassword(userId: string): Promise<number> {
  const rows = await db
    .update(documents)
    .set({ status: "received", error: null })
    .where(
      inArray(
        documents.id,
        db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.userId, userId), eq(documents.status, "needs_password")))
          .orderBy(desc(documents.createdAt))
          .limit(50),
      ),
    )
    .returning({ id: documents.id });
  for (const r of rows) await enqueueSafely(r.id);
  return rows.length;
}

export async function documentRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  await fastify.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 10, fieldSize: 1024, parts: MAX_FILES + 10 },
  });
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/institutions", async () => ({
    items: INSTITUTIONS.map((i) => ({ key: i.key, name: i.name, country: i.country, kinds: i.kinds, passwordHint: i.passwordHint })),
  }));

  // ---------------------------------------------------------------- documents

  app.get(
    "/documents",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          status: z.enum(DOCUMENT_STATUSES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { status, limit, cursor } = req.query;
      const conds = [eq(documents.userId, req.userId!)];
      if (status) conds.push(eq(documents.status, status));
      if (cursor) {
        const c = decodeCursor(cursor);
        if (!c) return reply.code(400).send({ error: "invalid_cursor", code: "VALIDATION" });
        // Cursor timestamps carry ms; Postgres keeps µs. Compare at ms precision.
        conds.push(sql`(date_trunc('milliseconds', ${documents.createdAt}), ${documents.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
      }
      const rows = await db
        .select()
        .from(documents)
        .where(and(...conds))
        .orderBy(desc(sql`date_trunc('milliseconds', ${documents.createdAt})`), desc(documents.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return { items: page.map(documentView), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
    },
  );

  app.post(
    "/documents",
    { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: 60 * MINUTE } } },
    async (req, reply) => {
      if (!req.isMultipart()) return reply.code(400).send({ error: "multipart_required", code: "VALIDATION" });
      const userId = req.userId!;
      const files: Array<{ filename: string; mimetype: string; content: Buffer }> = [];
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            await part.toBuffer();
            continue;
          }
          files.push({ filename: part.filename, mimetype: part.mimetype, content: await part.toBuffer() });
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }
      if (!files.length) return reply.code(400).send({ error: "no_files", code: "VALIDATION" });
      const source: DocumentSource = fields.source === "share" ? "share" : "upload";
      const password = fields.password?.length ? fields.password.slice(0, 200) : undefined;
      const savePassword = fields.savePassword === "true" || fields.savePassword === "1";

      const typed = files.map((f) => ({ ...f, type: fileTypeOf(f.mimetype, f.filename, f.content.subarray(0, 8)) }));
      const bad = typed.find((f) => !f.type || f.type === "image" || f.content.length === 0);
      if (bad) return reply.code(400).send({ error: "unsupported_file_type", code: "VALIDATION" });

      const results: Array<{ doc: DocRow; created: boolean }> = [];
      for (const f of typed) {
        if (f.type === "eml") {
          const r = await ingestEmail(userId, f.content, source);
          results.push(...r.docs);
          continue;
        }
        const inst = institutionFromText(f.filename);
        results.push(
          await storeDocument({
            userId,
            source,
            kind: f.type === "text" ? "unknown" : "statement",
            content: f.content,
            mimeType: mimeFor(f.type!, f.mimetype),
            filename: f.filename,
            institution: inst?.key ?? null,
          }),
        );
      }

      const items: DocRow[] = [];
      for (const r of results) {
        if (r.created) {
          await enqueueSafely(r.doc.id, { password, savePassword });
        } else if (password && r.doc.status === "needs_password" && r.doc.contentEnc) {
          // Same locked PDF again, this time with a password: retry it.
          await db.update(documents).set({ status: "received", error: null }).where(eq(documents.id, r.doc.id));
          r.doc.status = "received";
          await enqueueSafely(r.doc.id, { password, savePassword });
        }
        if (!items.some((d) => d.id === r.doc.id)) items.push(r.doc);
      }
      return reply.code(201).send({ items: items.map(documentView) });
    },
  );

  app.get("/documents/:id", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const d = await ownDocument(req.userId!, req.params.id);
    if (!d) return reply.code(404).send({ error: "not_found", code: "NOT_FOUND" });
    return documentView(d);
  });

  app.post(
    "/documents/:id/retry",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE } },
      schema: {
        params: idParam,
        body: z.object({ password: z.string().min(1).max(200).optional(), savePassword: z.boolean().optional() }).default({}),
      },
    },
    async (req, reply) => {
      const d = await ownDocument(req.userId!, req.params.id);
      if (!d) return reply.code(404).send({ error: "not_found", code: "NOT_FOUND" });
      if (!d.contentEnc) return reply.code(409).send({ error: "original_deleted", code: "CONFLICT" });
      const [row] = await db
        .update(documents)
        .set({ status: "received", error: null })
        .where(and(eq(documents.id, d.id), eq(documents.userId, req.userId!)))
        .returning();
      await enqueueSafely(d.id, { password: req.body?.password, savePassword: req.body?.savePassword });
      return reply.code(202).send(documentView(row));
    },
  );

  app.delete(
    "/documents/:id",
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ deleteTransactions: z.enum(["true", "false"]).default("true") }) },
    },
    async (req, reply) => {
      const userId = req.userId!;
      const d = await ownDocument(userId, req.params.id);
      if (!d) return reply.code(404).send({ error: "not_found", code: "NOT_FOUND" });
      await db.transaction(async (tx) => {
        if (req.query.deleteTransactions === "true") {
          const gone = await tx
            .delete(transactions)
            .where(and(eq(transactions.userId, userId), eq(transactions.documentId, d.id)))
            .returning({ id: transactions.id });
          // Alerts these statement lines had superseded count again.
          if (gone.length) {
            await tx
              .update(transactions)
              .set({ supersededBy: null })
              .where(and(eq(transactions.userId, userId), inArray(transactions.supersededBy, gone.map((g) => g.id))));
          }
        }
        await tx.delete(documents).where(and(eq(documents.id, d.id), eq(documents.userId, userId)));
      });
      return reply.code(204).send();
    },
  );

  // ---------------------------------------------------------------- PDF passwords (write-only secrets)

  app.get("/pdf-passwords", { preHandler: requireAuth }, async (req) => {
    const rows = await db.select().from(pdfPasswords).where(eq(pdfPasswords.userId, req.userId!)).orderBy(desc(pdfPasswords.createdAt));
    return { items: rows.map(passwordView) };
  });

  app.post(
    "/pdf-passwords",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE } },
      schema: {
        body: z.object({
          institution: z.string().max(40).nullable().optional(),
          label: z.string().trim().min(1).max(120),
          password: z.string().min(1).max(200),
        }),
      },
    },
    async (req, reply) => {
      const inst = req.body.institution ?? null;
      if (inst !== null && !institutionByKey(inst)) return reply.code(400).send({ error: "unknown_institution", code: "VALIDATION" });
      const count = await db.select({ n: sql<number>`count(*)::int` }).from(pdfPasswords).where(eq(pdfPasswords.userId, req.userId!));
      if ((count[0]?.n ?? 0) >= 50) return reply.code(400).send({ error: "too_many_passwords", code: "VALIDATION" });
      const [row] = await db
        .insert(pdfPasswords)
        .values({ userId: req.userId!, institution: inst, label: req.body.label, secretEnc: encrypt(req.body.password, env.DATA_KEY) })
        .returning();
      await requeueNeedsPassword(req.userId!);
      return reply.code(201).send(passwordView(row));
    },
  );

  app.delete("/pdf-passwords/:id", { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
    const gone = await db
      .delete(pdfPasswords)
      .where(and(eq(pdfPasswords.id, req.params.id), eq(pdfPasswords.userId, req.userId!)))
      .returning({ id: pdfPasswords.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found", code: "NOT_FOUND" });
    return reply.code(204).send();
  });
}
