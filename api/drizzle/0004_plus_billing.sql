-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts (0004: SpendVault Plus
-- billing via Stripe Checkout subscriptions + Customer Portal). Nothing here
-- changes what current users can do: BILLING defaults to off, and while it is
-- off everyone is effectively on Plus (lib/plan.ts).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
-- Stripe subscription status (active, trialing, past_due, canceled, incomplete, unpaid...).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_interval" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_renews_at" timestamptz;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Stripe `created` of the last event applied: older (out-of-order) events are skipped.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_event_at" timestamptz;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer" ON "users" ("stripe_customer_id") WHERE "stripe_customer_id" IS NOT NULL;--> statement-breakpoint
-- Webhook idempotency: one row per Stripe event id, written in the same DB
-- transaction as its effect (a failed apply rolls back and Stripe retries).
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
