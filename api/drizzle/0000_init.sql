-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts.
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "display_name" text NOT NULL,
  "inbound_token" text NOT NULL UNIQUE,
  "base_currency" text DEFAULT 'INR' NOT NULL,
  "alert_emails" boolean DEFAULT true NOT NULL,
  "delete_originals" boolean DEFAULT true NOT NULL,
  "whatsapp_phone" text UNIQUE,
  "whatsapp_link_code" text,
  "whatsapp_link_expires_at" timestamptz,
  "last_digest_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "refresh_token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forwarding_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "forward_from" text,
  "code" text,
  "confirm_url" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "institution" text NOT NULL,
  "kind" text NOT NULL,
  "last4" text DEFAULT '' NOT NULL,
  "label" text,
  "currency" text DEFAULT 'INR' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_user_inst_kind_last4" ON "accounts" ("user_id","institution","kind","last4");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pdf_passwords" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "institution" text,
  "label" text NOT NULL,
  "secret_enc" bytea NOT NULL,
  "last_used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source" text NOT NULL,
  "kind" text DEFAULT 'unknown' NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "filename" text,
  "mime_type" text NOT NULL,
  "content_enc" bytea,
  "sha256" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "email_from" text,
  "email_subject" text,
  "institution" text,
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE set null,
  "period_start" date,
  "period_end" date,
  "statement_total" numeric(14,2),
  "extracted_debits" numeric(14,2),
  "reconciled" boolean,
  "txn_count" integer DEFAULT 0 NOT NULL,
  "parser" text,
  "error" text,
  "whatsapp_from" text,
  "processed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_user_sha" ON "documents" ("user_id","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_user_created" ON "documents" ("user_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE set null,
  "document_id" uuid REFERENCES "documents"("id") ON DELETE set null,
  "posted_on" date NOT NULL,
  "description_raw" text NOT NULL,
  "merchant" text NOT NULL,
  "category" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "direction" text NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "source_kind" text NOT NULL,
  "fingerprint" text NOT NULL,
  "superseded_by" uuid,
  "category_locked" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_user_fp" ON "transactions" ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_posted" ON "transactions" ("user_id","posted_on");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "merchant" text NOT NULL,
  "category" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "category_rules_user_merchant" ON "category_rules" ("user_id","merchant");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category" text,
  "merchant" text,
  "amount" numeric(14,2),
  "baseline" numeric(14,2),
  "period_start" date,
  "data" jsonb,
  "emailed_at" timestamptz,
  "dismissed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_user_dedupe" ON "alerts" ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_user_created" ON "alerts" ("user_id","created_at");
