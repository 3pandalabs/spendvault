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

// Source of truth for the DB shape is drizzle/0000_init.sql (hand-written,
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
  baseCurrency: text("base_currency").notNull().default("INR"),
  alertEmails: boolean("alert_emails").notNull().default(true),
  // Delete the encrypted original right after a successful parse.
  deleteOriginals: boolean("delete_originals").notNull().default(true),
  whatsappPhone: text("whatsapp_phone").unique(),
  whatsappLinkCode: text("whatsapp_link_code"),
  whatsappLinkExpiresAt: timestamp("whatsapp_link_expires_at", { withTimezone: true }),
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
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

export const DOCUMENT_STATUSES = ["received", "processing", "parsed", "needs_password", "failed", "ignored"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_SOURCES = ["email", "upload", "share", "whatsapp"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<DocumentSource>().notNull(),
    // statement (PDF/CSV/XLSX) | alert (a per-transaction email body) | unknown
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

export const ALERT_KINDS = ["category_spike", "daily_spike", "large_new_merchant", "price_hike", "fee", "duplicate"] as const;
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
