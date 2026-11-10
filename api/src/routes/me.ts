import { forwardingAddressFor } from "../lib/inbound.js";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { markUserDeleted, requireAuth } from "../auth/plugin.js";
import { verifySecret } from "../auth/password.js";
import { db } from "../db/index.js";
import { accounts, alerts, forwardingConfirmations, transactions, users } from "../db/schema.js";
import { env } from "../env.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { gmailFilterQuery } from "../lib/institutions.js";
import { userView } from "../lib/users.js";
import { alertView } from "../lib/insights/load.js";
import { accountView, transactionView } from "./transactions.js";

const MINUTE = 60_000;
const deleteLimiter = keyedLimiter(5, 15 * MINUTE);
const exportLimiter = keyedLimiter(10, 60 * MINUTE);

type UserRow = typeof users.$inferSelect;

const forwardingAddress = (u: UserRow) => forwardingAddressFor(u.inboundToken, env.INBOUND_MAILBOX, env.INBOUND_DOMAIN);

async function meView(u: UserRow) {
  const exists = (q: SQL) => db.execute<{ e: boolean }>(q).then((r) => Boolean(r.rows[0]?.e));
  const [hasDocuments, hasPasswords, forwardingConfirmed] = await Promise.all([
    exists(sql`SELECT EXISTS (SELECT 1 FROM documents WHERE user_id = ${u.id}) AS e`),
    exists(sql`SELECT EXISTS (SELECT 1 FROM pdf_passwords WHERE user_id = ${u.id}) AS e`),
    exists(sql`SELECT (EXISTS (SELECT 1 FROM forwarding_confirmations WHERE user_id = ${u.id})
                    OR EXISTS (SELECT 1 FROM documents WHERE user_id = ${u.id} AND source = 'email')) AS e`),
  ]);
  return {
    ...userView(u),
    forwardingAddress: forwardingAddress(u),
    whatsapp: {
      available: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
      linkedPhone: u.whatsappPhone ?? null,
      number: env.WHATSAPP_DISPLAY_NUMBER || null,
    },
    setup: { hasDocuments, hasPasswords, forwardingConfirmed },
    llmEnabled: Boolean(env.ANTHROPIC_API_KEY),
  };
}

async function loadUser(id: string): Promise<UserRow | undefined> {
  const [u] = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
  return u;
}

export const GMAIL_STEPS = [
  "Open Gmail on a computer (the phone app can't set up forwarding).",
  "Click the gear icon (top right) → See all settings → the \"Forwarding and POP/IMAP\" tab.",
  "Click \"Add a forwarding address\", paste your SpendVault address, then Next → Proceed → OK.",
  "Gmail sends a confirmation code to SpendVault. It appears below within a minute — copy it.",
  "Back in Gmail, paste the code into the \"confirmation code\" box and click Verify. Leave forwarding itself turned OFF (the filter does the work).",
  "Paste the search query below into the Gmail search bar, then click the filter icon at the right end of the search bar.",
  "Click \"Create filter\", tick \"Forward it to\", choose your SpendVault address, and click \"Create filter\".",
  "Gmail only forwards new mail. For past statements, download the PDFs from Gmail and upload them on the Documents page.",
];

export async function meRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/me", { preHandler: requireAuth }, async (req, reply) => {
    const u = await loadUser(req.userId!);
    if (!u) return reply.code(401).send({ error: "not_authenticated" });
    return meView(u);
  });

  app.patch(
    "/me",
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            displayName: z.string().trim().min(1).max(120),
            alertEmails: z.boolean(),
            deleteOriginals: z.boolean(),
            baseCurrency: z.enum(["INR", "USD"]),
          })
          .partial()
          .strict(),
      },
    },
    async (req, reply) => {
      const patch = req.body;
      const [u] =
        Object.keys(patch).length > 0
          ? await db
              .update(users)
              .set(patch)
              .where(and(eq(users.id, req.userId!), isNull(users.deletedAt)))
              .returning()
          : [await loadUser(req.userId!)];
      if (!u) return reply.code(401).send({ error: "not_authenticated" });
      return meView(u);
    },
  );

  app.delete(
    "/me",
    { preHandler: requireAuth, schema: { body: z.object({ password: z.string().min(1).max(200) }) } },
    async (req, reply) => {
      if (!deleteLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
      const u = await loadUser(req.userId!);
      if (!u || !(await verifySecret(req.body.password, u.passwordHash))) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      // Every user-owned table cascades from users.
      await db.delete(users).where(eq(users.id, u.id));
      markUserDeleted(u.id);
      req.log.info({ userId: u.id }, "account deleted");
      return reply.code(204).send();
    },
  );

  app.get("/me/export", { preHandler: requireAuth }, async (req, reply) => {
    if (!exportLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
    const userId = req.userId!;
    const [txns, accts, counts, alertRows] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNull(transactions.supersededBy)))
        .orderBy(desc(transactions.postedOn), desc(transactions.id)),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
      db.execute<{ account_id: string; n: number; last: string | null }>(sql`
        SELECT account_id, count(*)::int AS n, max(posted_on)::text AS last FROM transactions
        WHERE user_id = ${userId} AND superseded_by IS NULL AND account_id IS NOT NULL GROUP BY account_id`),
      db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt)),
    ]);
    const byAcct = new Map(counts.rows.map((r) => [r.account_id, r]));
    reply.header("content-disposition", `attachment; filename="spendvault-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return {
      transactions: txns.map(transactionView),
      accounts: accts.map((a) => accountView(a, byAcct.get(a.id)?.n ?? 0, byAcct.get(a.id)?.last ?? null)),
      alerts: alertRows.map(alertView),
    };
  });

  app.get("/setup/forwarding", { preHandler: requireAuth }, async (req, reply) => {
    const u = await loadUser(req.userId!);
    if (!u) return reply.code(401).send({ error: "not_authenticated" });
    const rows = await db
      .select()
      .from(forwardingConfirmations)
      .where(eq(forwardingConfirmations.userId, u.id))
      .orderBy(desc(forwardingConfirmations.createdAt))
      .limit(10);
    return {
      address: forwardingAddress(u),
      gmailFilterQuery: gmailFilterQuery(),
      gmailSteps: GMAIL_STEPS,
      confirmations: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        forwardFrom: r.forwardFrom,
        code: r.code,
        confirmUrl: r.confirmUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
