-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts (0003: card dues,
-- return windows + warranties, refund watches, transaction splits/tags/notes,
-- savings goals, period digests, Ask SpendVault usage, user time zone).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_weekly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_monthly" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_weekly_digest" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_monthly_digest" text;--> statement-breakpoint
-- Card statement payment fields (credit cards only).
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "due_date" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "minimum_due" numeric(14,2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(14,2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Per-receipt return window override (days; 0 = final sale) and warranty end.
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "return_days" integer;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "warranty_until" date;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction_splits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "transaction_id" uuid NOT NULL REFERENCES "transactions"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "category" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_splits_txn" ON "transaction_splits" ("transaction_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_splits_user" ON "transaction_splits" ("user_id");--> statement-breakpoint
-- "I returned this": waits for the refund credit.
CREATE TABLE IF NOT EXISTS "refund_watches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE set null,
  "receipt_id" uuid REFERENCES "receipts"("id") ON DELETE set null,
  "merchant" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "currency" text NOT NULL,
  "returned_on" date NOT NULL,
  "refund_transaction_id" uuid REFERENCES "transactions"("id") ON DELETE set null,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_watches_user" ON "refund_watches" ("user_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "target_amount" numeric(14,2) NOT NULL,
  "target_date" date,
  "currency" text NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_goals_user" ON "savings_goals" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "goal_id" uuid NOT NULL REFERENCES "savings_goals"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "amount" numeric(14,2) NOT NULL,
  "contributed_on" date NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_contributions_goal" ON "goal_contributions" ("goal_id","contributed_on");--> statement-breakpoint
-- Ask SpendVault: token usage only (never the question or the answer).
CREATE TABLE IF NOT EXISTS "ask_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "tool_calls" integer DEFAULT 0 NOT NULL,
  "ok" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_usage_user_created" ON "ask_usage" ("user_id","created_at");
