import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { documents, users } from "../db/schema.js";
import { env } from "../env.js";
import { randomToken } from "../lib/crypto.js";
import { fileTypeOf, mimeFor } from "../lib/ingest/classify.js";
import { enqueueSafely } from "../lib/ingest/queue.js";
import { storeDocument } from "../lib/ingest/store.js";
import { downloadMedia, isWhatsAppConfigured, parseInbound, replySafely, verifyChallenge, verifyWebhookSignature, type InboundMessage } from "../lib/whatsapp.js";
import { registerRateLimit } from "../plugins/rateLimit.js";

const LINK_TTL_MS = 15 * 60_000;
const MINUTE = 60_000;
const LINK_RE = /^\s*(LINK-[A-Z0-9]{6})\s*$/i;

const HOW_TO_LINK = "This number isn't linked to SpendVault yet. Open SpendVault > Setup > WhatsApp, tap \"Link WhatsApp\" and send the LINK code shown there.";
const HELP = "Forward any bank or card statement PDF here and I'll add its transactions to SpendVault.";

async function handleMessage(msg: InboundMessage, log: FastifyBaseLogger): Promise<void> {
  const reply = (body: string) => replySafely(msg.from, body, (m) => log.warn({ waMessage: msg.id }, m));

  if (msg.kind === "text") {
    const link = msg.body.match(LINK_RE);
    if (link) {
      const code = link[1].toUpperCase();
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.whatsappLinkCode, code), gt(users.whatsappLinkExpiresAt, new Date()), isNull(users.deletedAt)))
        .limit(1);
      if (!owner) return reply("That code has expired or is wrong. Generate a new one in SpendVault > Setup > WhatsApp.");
      await db.transaction(async (tx) => {
        // One phone ↔ one account: linking moves the number off any previous account.
        await tx.update(users).set({ whatsappPhone: null }).where(and(eq(users.whatsappPhone, msg.from), ne(users.id, owner.id)));
        await tx.update(users).set({ whatsappPhone: msg.from, whatsappLinkCode: null, whatsappLinkExpiresAt: null }).where(eq(users.id, owner.id));
      });
      log.info({ userId: owner.id }, "whatsapp linked");
      return reply("Linked to SpendVault ✅ Forward any bank or card statement PDF here.");
    }
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.whatsappPhone, msg.from), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return reply(HOW_TO_LINK);

  if (msg.kind === "text") {
    const [locked] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, user.id), eq(documents.source, "whatsapp"), eq(documents.status, "needs_password")))
      .orderBy(desc(documents.createdAt))
      .limit(1);
    const password = msg.body.trim();
    if (locked && password && password.length <= 200 && !/\s{2,}|\n/.test(password)) {
      await db.update(documents).set({ status: "received", error: null }).where(eq(documents.id, locked.id));
      // The outcome ("N transactions added…" / "That password didn't work") is sent when processing finishes.
      await enqueueSafely(locked.id, { password, savePassword: true });
      return reply("Trying that password…");
    }
    return reply(HELP);
  }

  // Document / image
  let media: { content: Buffer; mimeType: string };
  try {
    media = await downloadMedia(msg.mediaId);
  } catch (err) {
    log.warn({ userId: user.id, err: (err as Error).message.slice(0, 80) }, "whatsapp media download failed");
    return reply("Couldn't download that file. Please send it again (PDF, CSV or XLSX, up to 10 MB).");
  }
  const type = fileTypeOf(msg.mimeType ?? media.mimeType, msg.filename, media.content.subarray(0, 8));
  if (!type || type === "eml" || type === "text") return reply("Please send a statement as a PDF, CSV or XLSX file.");
  if (type === "image" && !env.ANTHROPIC_API_KEY) return reply("Photos aren't supported yet — please send the statement PDF.");
  const { doc, created } = await storeDocument({
    userId: user.id,
    source: "whatsapp",
    kind: "statement",
    content: media.content,
    mimeType: mimeFor(type, msg.mimeType ?? media.mimeType),
    filename: msg.filename,
    whatsappFrom: msg.from,
  });
  if (!created) {
    if (doc.status === "needs_password") return reply("I already have this PDF — it's password-protected. Reply with the password, or add it in SpendVault > Setup.");
    return reply("Already got this one ✅");
  }
  await enqueueSafely(doc.id);
  return reply("Got it — processing…");
}

export async function whatsappRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);

  fastify.post("/whatsapp/link", { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: 15 * MINUTE } } }, async (req, reply) => {
    if (!isWhatsAppConfigured()) return reply.code(503).send({ error: "whatsapp_unavailable" });
    const code = `LINK-${randomToken(6).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await db.update(users).set({ whatsappLinkCode: code, whatsappLinkExpiresAt: expiresAt }).where(eq(users.id, req.userId!));
    return { code, expiresAt: expiresAt.toISOString(), number: env.WHATSAPP_DISPLAY_NUMBER || null };
  });

  fastify.delete("/whatsapp/link", { preHandler: requireAuth }, async (req, reply) => {
    await db.update(users).set({ whatsappPhone: null, whatsappLinkCode: null, whatsappLinkExpiresAt: null }).where(eq(users.id, req.userId!));
    return reply.code(204).send();
  });

  // Webhooks in a child scope: the JSON parser here keeps the RAW bytes for the signature check.
  await fastify.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) =>
      done(null, body),
    );

    hooks.get("/webhooks/whatsapp", async (req, reply) => {
      if (!isWhatsAppConfigured()) return reply.code(503).send({ error: "whatsapp_unavailable" });
      const challenge = verifyChallenge(req.query as Record<string, unknown>);
      if (challenge === null) return reply.code(403).send({ error: "verification_failed" });
      return reply.type("text/plain").send(challenge);
    });

    hooks.post("/webhooks/whatsapp", { config: { rateLimit: { max: 600, timeWindow: MINUTE } } }, async (req, reply) => {
      if (!isWhatsAppConfigured()) return reply.code(503).send({ error: "whatsapp_unavailable" });
      const raw = req.body;
      const sig = req.headers["x-hub-signature-256"];
      if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, typeof sig === "string" ? sig : undefined)) {
        req.log.warn("rejected an unverified WhatsApp webhook");
        return reply.code(401).send({ error: "invalid_signature" });
      }
      const messages = parseInbound(raw);
      // Answer Meta at once; media downloads and replies happen after.
      setImmediate(() => {
        void (async () => {
          for (const m of messages) {
            try {
              await handleMessage(m, req.log);
            } catch (err) {
              req.log.error({ waMessage: m.id, err: (err as Error).name }, "whatsapp message handling failed");
            }
          }
        })();
      });
      return reply.code(200).send({ ok: true });
    });
  });
}
