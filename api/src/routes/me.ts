import { forwardingAddressFor } from "../lib/inbound.js";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { markUserDeleted, requireAuth } from "../auth/plugin.js";
import { verifySecret } from "../auth/password.js";
import { db } from "../db/index.js";
import { accounts, alerts, documents, forwardingConfirmations, receiptItems, receipts, transactions, users } from "../db/schema.js";
import { env } from "../env.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { BASE_CURRENCIES } from "../lib/currency.js";
import { gmailFilterQuery } from "../lib/institutions.js";
import { userView } from "../lib/users.js";
import { alertView } from "../lib/insights/load.js";
import { receiptDocColumns, receiptItemView, receiptView } from "../lib/receipts/db.js";
import { accountView, transactionView } from "./transactions.js";
import { toCsv } from "../lib/csv.js";
import { householdEnabled, householdView, leaveHousehold, membershipOf } from "../lib/household/db.js";
import { accountLabel } from "../lib/insights/load.js";
import { categoryLabel } from "../lib/insights/util.js";
import { num, toDbAmount, toNum } from "../lib/money.js";

function csvReply(reply: FastifyReply, filename: string, csv: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${filename}"`)
    .header("cache-control", "private, no-store")
    .send(csv);
}

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
    features: { household: householdEnabled() },
    household: await householdSummary(u.id),
  };
}

async function householdSummary(userId: string) {
  const h = await householdView(userId);
  return h ? { id: h.id, name: h.name, memberCount: h.members.length } : null;
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
            baseCurrency: z.enum(BASE_CURRENCIES),
            monthlyBudget: z.number().finite().min(0).max(1e11).nullable(),
          })
          .partial()
          .strict(),
      },
    },
    async (req, reply) => {
      const { monthlyBudget, ...rest } = req.body;
      const patch = {
        ...rest,
        ...(monthlyBudget !== undefined ? { monthlyBudget: monthlyBudget ? toDbAmount(monthlyBudget) : null } : {}),
      };
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
      // Leave a shared household first (an empty household is deleted, ownership passes on).
      if (await membershipOf(u.id)) await leaveHousehold(u.id);
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
    const [txns, accts, counts, alertRows, receiptRows, itemRows] = await Promise.all([
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
      db
        .select({ r: receipts, ...receiptDocColumns })
        .from(receipts)
        .innerJoin(documents, eq(documents.id, receipts.documentId))
        .where(eq(receipts.userId, userId))
        .orderBy(desc(receipts.createdAt)),
      db.select().from(receiptItems).where(eq(receiptItems.userId, userId)).orderBy(receiptItems.receiptId, receiptItems.position),
    ]);
    const itemsBy = new Map<string, (typeof itemRows)[number][]>();
    for (const i of itemRows) itemsBy.set(i.receiptId, [...(itemsBy.get(i.receiptId) ?? []), i]);
    const receiptByTxn = new Map(receiptRows.filter((x) => x.r.transactionId).map((x) => [x.r.transactionId!, x.r.id]));
    const byAcct = new Map(counts.rows.map((r) => [r.account_id, r]));
    reply.header("content-disposition", `attachment; filename="spendvault-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return {
      transactions: txns.map((t) => transactionView(t, receiptByTxn.get(t.id) ?? null)),
      accounts: accts.map((a) => accountView(a, byAcct.get(a.id)?.n ?? 0, byAcct.get(a.id)?.last ?? null)),
      alerts: alertRows.map(alertView),
      receipts: receiptRows.map(({ r, ...d }) => {
        const items = itemsBy.get(r.id) ?? [];
        return { ...receiptView(r, d, items.length), items: items.map(receiptItemView) };
      }),
    };
  });

  // CSV exports (spreadsheet-friendly; the JSON export above has everything).
  app.get("/me/export/transactions.csv", { preHandler: requireAuth }, async (req, reply) => {
    if (!exportLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
    const userId = req.userId!;
    const [rows, accts, links] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNull(transactions.supersededBy)))
        .orderBy(desc(transactions.postedOn), desc(transactions.id)),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
      db.select({ id: receipts.id, txn: receipts.transactionId }).from(receipts).where(eq(receipts.userId, userId)),
    ]);
    const label = new Map(accts.map((a) => [a.id, accountLabel(a)]));
    const receiptOf = new Map(links.filter((l) => l.txn).map((l) => [l.txn!, l.id]));
    const csv = toCsv(
      ["date", "merchant", "description", "category", "amount", "direction", "signed_amount", "currency", "account", "source", "receipt_id", "transaction_id"],
      rows.map((t) => {
        const amt = num(t.amount);
        return [t.postedOn, t.merchant, t.descriptionRaw, categoryLabel(t.category), amt, t.direction, t.direction === "debit" ? -amt : amt, t.currency,
          t.accountId ? (label.get(t.accountId) ?? "") : "", t.sourceKind, receiptOf.get(t.id) ?? "", t.id];
      }),
    );
    return csvReply(reply, `spendvault-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });

  app.get("/me/export/receipt-items.csv", { preHandler: requireAuth }, async (req, reply) => {
    if (!exportLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
    const userId = req.userId!;
    const rows = await db
      .select({ i: receiptItems, r: receipts })
      .from(receiptItems)
      .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .where(eq(receiptItems.userId, userId))
      .orderBy(desc(receipts.purchasedOn), receiptItems.receiptId, receiptItems.position);
    const csv = toCsv(
      ["purchase_date", "merchant", "item", "quantity", "unit_price", "line_total", "category", "receipt_total", "currency", "receipt_id", "transaction_id"],
      rows.map(({ i, r }) => [r.purchasedOn ?? "", r.merchant ?? "", i.name, toNum(i.quantity), toNum(i.unitPrice), num(i.lineTotal), categoryLabel(i.category),
        toNum(r.total), r.currency, r.id, r.transactionId ?? ""]),
    );
    return csvReply(reply, `spendvault-receipt-items-${new Date().toISOString().slice(0, 10)}.csv`, csv);
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
