-- Hand-written. KEEP THIS IDEMPOTENT: migrations run on every container start
-- (IF NOT EXISTS everywhere). Mirrors src/db/schema.ts (receipts, receipt_items).
--
-- A receipt is always backed by a `documents` row (kind = 'receipt'): the
-- encrypted original lives there (DATA_KEY, AES-256-GCM) exactly like a
-- statement. Deleting the document deletes the receipt and its items.
CREATE TABLE IF NOT EXISTS "receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE cascade,
  "status" text DEFAULT 'processing' NOT NULL,
  "merchant" text,
  "purchased_on" date,
  "total" numeric(14,2),
  "tax" numeric(14,2),
  "currency" text DEFAULT 'INR' NOT NULL,
  "items_reconciled" boolean,
  "parser" text,
  "error" text,
  "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE set null,
  "match_status" text DEFAULT 'unmatched' NOT NULL,
  "matched_at" timestamptz,
  "rejected_txn_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_document" ON "receipts" ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_user_created" ON "receipts" ("user_id","created_at");--> statement-breakpoint
-- One receipt per transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_transaction" ON "receipts" ("transaction_id") WHERE "transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL REFERENCES "receipts"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "name" text NOT NULL,
  "quantity" numeric(12,3),
  "unit_price" numeric(14,2),
  "line_total" numeric(14,2) NOT NULL,
  "category" text NOT NULL,
  "category_locked" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_items_receipt" ON "receipt_items" ("receipt_id","position");
