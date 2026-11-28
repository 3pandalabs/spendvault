-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts (0005: manual cash
-- transactions, budget rollover, saved calculator scenarios).
--
-- Manual transactions need no DDL: transactions.source_kind is free text and
-- they use 'manual' with a 'manual:<uuid>' fingerprint (never equal to a
-- statement/alert fingerprint), document_id NULL, and an optional "Cash"
-- account (institution 'cash', kind 'cash'). This index serves the
-- "is this row manual?" checks on edit/delete.
CREATE INDEX IF NOT EXISTS "transactions_user_manual" ON "transactions" ("user_id","posted_on") WHERE "source_kind" = 'manual';--> statement-breakpoint
-- Budget rollover (per category). `rollover_since` = first month (YYYY-MM, in
-- the user's time zone) whose leftover carries forward; null = off.
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "rollover_unspent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "rollover_overspend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "rollover_since" text;--> statement-breakpoint
-- Same for the overall monthly budget.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget_rollover_unspent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget_rollover_overspend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget_rollover_since" text;--> statement-breakpoint
-- Optional saved calculator inputs (one per calculator per user). Inputs only:
-- results are always recomputed in the browser.
CREATE TABLE IF NOT EXISTS "calculator_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "calculator" text NOT NULL,
  "inputs" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calculator_scenarios_user_calc" ON "calculator_scenarios" ("user_id","calculator");
