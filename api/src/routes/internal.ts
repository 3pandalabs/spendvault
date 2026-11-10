import { tokenFromLocalPart } from "../lib/inbound.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { env } from "../env.js";
import { enqueueSafely } from "../lib/ingest/queue.js";
import { ingestEmail } from "../lib/ingest/store.js";

// POST /internal/inbound-email (api/ROUTES.md "Internal"): the Email Routing
// Worker POSTs each raw message addressed to <mailbox>+<token>@INBOUND_DOMAIN. Always
// 200 once authenticated (the Worker must never bounce-loop).

const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

function secretOk(req: FastifyRequest): boolean {
  const given = req.headers["x-internal-secret"];
  if (typeof given !== "string") return false;
  // Hash both sides so timingSafeEqual sees equal lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(env.INTERNAL_SHARED_SECRET).digest();
  return timingSafeEqual(a, b);
}

/** User token from the recipient (plus tag of the local part): X-Envelope-To first, then the To header. */
function recipientLocalPart(envelopeTo: string | undefined, raw: Buffer): string | null {
  const pick = (addr: string | undefined) => addr?.trim().match(/<?([^<>\s@]+)@[^<>\s@]+>?/)?.[1]?.toLowerCase() ?? null;
  const fromEnvelope = pick(envelopeTo?.split(",")[0]);
  if (fromEnvelope) return fromEnvelope;
  const head = raw.subarray(0, 64 * 1024).toString("latin1").split(/\r?\n\r?\n/)[0];
  const to = head.match(/^to:\s*((?:.*)(?:\r?\n[ \t].*)*)/im)?.[1];
  const domain = env.INBOUND_DOMAIN.toLowerCase().replace(/\./g, "\\.");
  const m = to?.match(new RegExp(`([^<>\\s@,"]+)@${domain}`, "i"));
  return m ? m[1].toLowerCase() : pick(to?.split(",")[0]);
}

export async function internalRoutes(app: FastifyInstance) {
  const asBuffer = (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body);
  app.addContentTypeParser(["message/rfc822", "application/octet-stream", "text/plain"], { parseAs: "buffer", bodyLimit: MAX_EMAIL_BYTES + 1024 * 1024 }, asBuffer);

  app.post("/internal/inbound-email", { bodyLimit: MAX_EMAIL_BYTES + 1024 * 1024 }, async (req, reply) => {
    if (!env.INTERNAL_SHARED_SECRET) return reply.code(503).send({ error: "internal_unavailable" });
    if (!secretOk(req)) return reply.code(401).send({ error: "unauthorized" });
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) return reply.code(400).send({ error: "raw_message_required", code: "VALIDATION" });

    const envelopeTo = req.headers["x-envelope-to"];
    const token = recipientToken(typeof envelopeTo === "string" ? envelopeTo : undefined, raw);
    if (!token) return { accepted: 0, ignored: "unknown_recipient" };
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.inboundToken}) = ${token}`, isNull(users.deletedAt)))
      .limit(1);
    if (!user) return { accepted: 0, ignored: "unknown_recipient" };

    const result = await ingestEmail(user.id, raw, "email");
    let accepted = 0;
    for (const r of result.docs) {
      if (!r.created) continue;
      accepted++;
      await enqueueSafely(r.doc.id);
    }
    req.log.info({ userId: user.id, accepted, docs: result.docs.length, ignored: result.ignored }, "inbound email");
    return { accepted, ignored: result.ignored ?? (result.docs.length && !accepted ? "duplicate" : null) };
  });
}

export function recipientToken(envelopeTo: string | undefined, raw: Buffer): string | null {
  return tokenFromLocalPart(recipientLocalPart(envelopeTo, raw));
}
