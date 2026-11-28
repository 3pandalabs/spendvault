-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts (planning features:
-- statement reconciliation ends, budgets, net worth, shared households).
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "opening_balance" numeric(14,2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "closing_balance" numeric(14,2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extracted_credits" numeric(14,2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "reconcile_diff" numeric(14,2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_budget" numeric(14,2);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "include_in_net_worth" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_user_category" ON "budgets" ("user_id","category");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "net_worth_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "net_worth_items_user" ON "net_worth_items" ("user_id");--> statement-breakpoint
-- Shared households (couples). A user belongs to at most one household.
CREATE TABLE IF NOT EXISTS "households" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household_members" (
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "household_members_user" ON "household_members" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "household_members_household" ON "household_members" ("household_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "household_invites_token" ON "household_invites" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "household_invites_household" ON "household_invites" ("household_id");
