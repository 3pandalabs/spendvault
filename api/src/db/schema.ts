import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Source of truth for the DB shape is drizzle/*.sql (hand-written,
// idempotent). Keep this file in sync with it.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  // Local part of the personal forwarding address (<mailbox>+<token>@INBOUND_DOMAIN).
  inboundToken: text("inbound_token").notNull().unique(),
  // DB default stays "INR" (no migration); sign-up sets it explicitly (lib/currency.ts, USD by default).
  baseCurrency: text("base_currency").notNull().default("INR"),
  alertEmails: boolean("alert_emails").notNull().default(true),
  // Delete the encrypted original right after a successful parse.
  deleteOriginals: boolean("delete_originals").notNull().default(true),
  whatsappPhone: text("whatsapp_phone").unique(),
  whatsappLinkCode: text("whatsapp_link_code"),
  whatsappLinkExpiresAt: timestamp("whatsapp_link_expires_at", { withTimezone: true }),
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
  // Overall monthly spending budget (safe-to-spend basis). drizzle/0002_planning.sql.
  monthlyBudget: numeric("monthly_budget", { precision: 14, scale: 2 }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// Gmail (and Outlook) send a confirmation mail to a new forwarding address.
// The inbound pipeline captures it so the setup wizard can show the code.
export const forwardingConfirmations = pgTable("forwarding_confirmations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // gmail | outlook | other
  forwardFrom: text("forward_from"), // the user's mailbox that asked to forward
  code: text("code"),
  confirmUrl: text("confirm_url"),
  createdAt: createdAt(),
});

// One card or bank account. Created on the fly when a document names one.
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(), // registry key, e.g. "hdfc", or "unknown"
    kind: text("kind").notNull(), // credit_card | bank | unknown
    last4: text("last4").notNull().default(""),
    label: text("label"),
    currency: text("currency").notNull().default("INR"),
    // Latest statement closing balance counts toward net worth (0002).
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_user_inst_kind_last4").on(t.userId, t.institution, t.kind, t.last4)],
);

// Saved PDF passwords, AES-256-GCM encrypted (lib/crypto.ts). Never returned.
export const pdfPasswords = pgTable("pdf_passwords", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  institution: text("institution"), // null = try for any bank
  label: text("label").notNull(),
  secretEnc: bytea("secret_enc").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// pending_extraction: receipts only (stored, waiting for AI extraction or a manual total).
export const DOCUMENT_STATUSES = ["received", "processing", "parsed", "needs_password", "failed", "ignored", "pending_extraction"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_SOURCES = ["email", "upload", "share", "whatsapp"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<DocumentSource>().notNull(),
    // statement (PDF/CSV/XLSX) | alert (a per-transaction email body) | receipt | unknown
    kind: text("kind").notNull().default("unknown"),
    status: text("status").$type<DocumentStatus>().notNull().default("received"),
    filename: text("filename"),
    mimeType: text("mime_type").notNull(),
    // Encrypted original. Nulled after a successful parse when the user has
    // deleteOriginals on. Email-body alerts store the text body here.
    contentEnc: bytea("content_enc"),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    emailFrom: text("email_from"),
    emailSubject: text("email_subject"),
    institution: text("institution"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    // From the statement itself ("total amount due" / closing balance).
    statementTotal: numeric("statement_total", { precision: 14, scale: 2 }),
    // Sum of the debits we extracted for the period, for reconciliation.
    extractedDebits: numeric("extracted_debits", { precision: 14, scale: 2 }),
    reconciled: boolean("reconciled"),
    // 0002: both ends of the statement and the signed gap (lib/ingest/reconcile.ts).
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 14, scale: 2 }),
    extractedCredits: numeric("extracted_credits", { precision: 14, scale: 2 }),
    reconcileDiff: numeric("reconcile_diff", { precision: 14, scale: 2 }),
    txnCount: integer("txn_count").notNull().default(0),
    parser: text("parser"), // e.g. "rules:statement", "llm", "csv", "rules:alert"
    error: text("error"),
    whatsappFrom: text("whatsapp_from"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("documents_user_sha").on(t.userId, t.sha256), index("documents_user_created").on(t.userId, t.createdAt)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    postedOn: date("posted_on").notNull(),
    descriptionRaw: text("description_raw").notNull(),
    merchant: text("merchant").notNull(), // normalized display name
    category: text("category").notNull(), // lib/categories.ts key
    // Always positive. direction says which way the money moved.
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    direction: text("direction").notNull(), // debit | credit
    currency: text("currency").notNull().default("INR"),
    sourceKind: text("source_kind").notNull(), // statement | alert | csv
    fingerprint: text("fingerprint").notNull(),
    // An alert transaction later matched by a statement line points here and is
    // excluded from every total (WHERE superseded_by IS NULL).
    supersededBy: uuid("superseded_by"),
    // The user set the category by hand; recategorization never overrides it.
    categoryLocked: boolean("category_locked").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("transactions_user_fp").on(t.userId, t.fingerprint),
    index("transactions_user_posted").on(t.userId, t.postedOn),
  ],
);

// Per-user "this merchant is always <category>" overrides.
export const categoryRules = pgTable(
  "category_rules",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    merchant: text("merchant").notNull(), // normalized merchant name, lowercase
    category: text("category").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_rules_user_merchant").on(t.userId, t.merchant)],
);

export const ALERT_KINDS = [
  "category_spike",
  "daily_spike",
  "large_new_merchant",
  "price_hike",
  "fee",
  "duplicate",
  "new_subscription",
  "over_budget",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AlertKind>().notNull(),
    // Stable key so the hourly sweep never raises the same alert twice,
    // e.g. "category_spike:food_delivery:2026-11".
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category"),
    merchant: text("merchant"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    baseline: numeric("baseline", { precision: 14, scale: 2 }),
    periodStart: date("period_start"),
    data: jsonb("data"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alerts_user_dedupe").on(t.userId, t.dedupeKey), index("alerts_user_created").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------- receipts

export const RECEIPT_STATUSES = ["processing", "pending_extraction", "extracted", "manual", "failed"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_MATCH_STATUSES = ["unmatched", "auto", "confirmed"] as const;
export type ReceiptMatchStatus = (typeof RECEIPT_MATCH_STATUSES)[number];

// One receipt per `documents` row (kind = receipt); the encrypted original is
// documents.content_enc. drizzle/0001_receipts.sql.
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    status: text("status").$type<ReceiptStatus>().notNull().default("processing"),
    merchant: text("merchant"),
    purchasedOn: date("purchased_on"),
    total: numeric("total", { precision: 14, scale: 2 }),
    tax: numeric("tax", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("INR"),
    // Line items (+ tax) add up to the total within tolerance.
    itemsReconciled: boolean("items_reconciled"),
    parser: text("parser"), // "llm:receipt" | "manual"
    error: text("error"),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    matchStatus: text("match_status").$type<ReceiptMatchStatus>().notNull().default("unmatched"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    // Transactions the user unlinked from this receipt: auto-match skips them.
    rejectedTxnIds: uuid("rejected_txn_ids").array().notNull().default(sql`'{}'::uuid[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("receipts_document").on(t.documentId),
    index("receipts_user_created").on(t.userId, t.createdAt),
    uniqueIndex("receipts_transaction").on(t.transactionId).where(sql`${t.transactionId} IS NOT NULL`),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: id(),
    receiptId: uuid("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
    category: text("category").notNull(),
    categoryLocked: boolean("category_locked").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("receipt_items_receipt").on(t.receiptId, t.position)],
);

// ---------------------------------------------------------------- planning (0002)

// Per-category monthly budgets, in the user's base currency.
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("budgets_user_category").on(t.userId, t.category)],
);

export const NET_WORTH_KINDS = ["asset", "liability"] as const;
export type NetWorthKind = (typeof NET_WORTH_KINDS)[number];
export const NET_WORTH_TYPES = ["cash", "investment", "retirement", "property", "vehicle", "loan", "mortgage", "credit_card", "other"] as const;

// Manual assets/liabilities (cash, investments, home, car, loans...).
export const netWorthItems = pgTable(
  "net_worth_items",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NetWorthKind>().notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // always >= 0; kind says which side
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("net_worth_items_user").on(t.userId)],
);

// Shared household (couples). A user is in at most one household.
export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | member
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("household_members_user").on(t.userId), index("household_members_household").on(t.householdId)],
);

export const householdInvites = pgTable(
  "household_invites",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // lowercase
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("household_invites_token").on(t.tokenHash), index("household_invites_household").on(t.householdId)],
);
