import { forwardingAddressFor } from "../lib/inbound.js";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { markUserDeleted, requireAuth } from "../auth/plugin.js";
import { verifySecret } from "../auth/password.js";
import { db } from "../db/index.js";
import { accounts, alerts, calculatorScenarios, categoryRules, documents, forwardingConfirmations, goalContributions, receiptItems, receipts, refundWatches, savingsGoals, transactionSplits, transactions, users } from "../db/schema.js";
import { isValidTimeZone } from "../lib/userTime.js";
import { isTaxTag, TAX_TAG_KEYS } from "../lib/tax.js";
import { env } from "../env.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { BASE_CURRENCIES } from "../lib/currency.js";
import { gmailFilterQuery } from "../lib/institutions.js";
import { userView } from "../lib/users.js";
import { billingSummary, requirePlus } from "../lib/billing/entitlements.js";
import { cancelSubscriptionNow, stripeConfigured } from "../lib/billing/stripe.js";
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
    ...billingSummary(u),
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
            timezone: z.string().max(64).refine(isValidTimeZone, "unknown time zone").nullable(),
            digestWeekly: z.boolean(),
            digestMonthly: z.boolean(),
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
      // Stop a Plus subscription first (best effort: never blocks the deletion).
      if (u.stripeSubscriptionId && stripeConfigured()) {
        await cancelSubscriptionNow(u.stripeSubscriptionId).catch((err) => req.log.warn({ userId: u.id, err: (err as Error).message }, "stripe cancel on delete failed"));
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
    const [txns, accts, counts, alertRows, receiptRows, itemRows, extra] = await Promise.all([
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
      Promise.all([
        db.select().from(transactionSplits).where(eq(transactionSplits.userId, userId)),
        db.select().from(refundWatches).where(eq(refundWatches.userId, userId)),
        db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)),
        db.select().from(goalContributions).where(eq(goalContributions.userId, userId)),
        db.select().from(categoryRules).where(eq(categoryRules.userId, userId)),
        db.select().from(calculatorScenarios).where(eq(calculatorScenarios.userId, userId)),
      ]),
    ]);
    const [splitRows, watchRows, goalRows, contribRows, ruleRows, scenarioRows] = extra;
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
      splits: splitRows.map((s) => ({ transactionId: s.transactionId, category: s.category, amount: num(s.amount) })),
      refunds: watchRows.map((w) => ({ id: w.id, transactionId: w.transactionId, receiptId: w.receiptId, merchant: w.merchant, amount: num(w.amount), currency: w.currency, returnedOn: w.returnedOn, refundTransactionId: w.refundTransactionId })),
      goals: goalRows.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: num(g.targetAmount),
        targetDate: g.targetDate,
        currency: g.currency,
        contributions: contribRows.filter((c) => c.goalId === g.id).map((c) => ({ amount: num(c.amount), contributedOn: c.contributedOn, note: c.note })),
      })),
      categoryRules: ruleRows.map((r) => ({ merchant: r.merchant, category: r.category })),
      calculatorScenarios: scenarioRows.map((r) => ({ calculator: r.calculator, inputs: r.inputs, updatedAt: r.updatedAt.toISOString() })),
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
      ["date", "merchant", "description", "category", "amount", "direction", "signed_amount", "currency", "account", "source", "tags", "note", "receipt_id", "transaction_id"],
      rows.map((t) => {
        const amt = num(t.amount);
        return [t.postedOn, t.merchant, t.descriptionRaw, categoryLabel(t.category), amt, t.direction, t.direction === "debit" ? -amt : amt, t.currency,
          t.accountId ? (label.get(t.accountId) ?? "") : "", t.sourceKind, (t.tags ?? []).join(" "), t.note ?? "", receiptOf.get(t.id) ?? "", t.id];
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

  // Year-end tax export: transactions and receipt items carrying a tax tag.
  app.get(
    "/me/export/tax.csv",
    {
      // Plus (lib/plan.ts). The full JSON/CSV exports above stay free.
      preHandler: [requireAuth, requirePlus("tax_export")],
      schema: { querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100), tag: z.string().max(40).optional() }) },
    },
    async (req, reply) => {
      if (!exportLimiter(req.userId!)) return reply.code(429).send({ error: "rate_limited" });
      const userId = req.userId!;
      const { year, tag } = req.query;
      if (tag && !isTaxTag(tag)) return reply.code(400).send({ error: "invalid_tag", code: "VALIDATION" });
      const tags = tag ? [tag] : [...TAX_TAG_KEYS];
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const tagArr = sql`ARRAY[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]`;
      const [txns, items] = await Promise.all([
        db
          .select()
          .from(transactions)
          .where(and(eq(transactions.userId, userId), isNull(transactions.supersededBy), sql`${transactions.postedOn} BETWEEN ${from}::date AND ${to}::date`, sql`${transactions.tags} && ${tagArr}`))
          .orderBy(transactions.postedOn),
        db
          .select({ i: receiptItems, r: receipts })
          .from(receiptItems)
          .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
          .where(and(eq(receiptItems.userId, userId), sql`${receipts.purchasedOn} BETWEEN ${from}::date AND ${to}::date`, sql`${receiptItems.tags} && ${tagArr}`))
          .orderBy(receipts.purchasedOn, receiptItems.position),
      ]);
      const pick = (t: string[] | null) => (t ?? []).filter(isTaxTag).join(" ");
      const csv = toCsv(
        ["type", "date", "merchant", "description", "category", "amount", "currency", "tax_tags", "note", "transaction_id", "receipt_id"],
        [
          ...txns.map((t) => ["transaction", t.postedOn, t.merchant, t.descriptionRaw, categoryLabel(t.category), t.direction === "debit" ? num(t.amount) : -num(t.amount), t.currency, pick(t.tags), t.note ?? "", t.id, ""]),
          ...items.map(({ i, r }) => ["receipt_item", r.purchasedOn ?? "", r.merchant ?? "", i.name, categoryLabel(i.category), num(i.lineTotal), r.currency, pick(i.tags), "", r.transactionId ?? "", r.id]),
        ],
      );
      return csvReply(reply, `spendvault-tax-${year}${tag ? `-${tag}` : ""}.csv`, csv);
    },
  );

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
