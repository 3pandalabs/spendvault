# SpendVault — CLAUDE.md

Expense insights from emailed bank/credit-card statements (3PandaLabs app #7). Origin: `3pandalabs/ideas` → `ideas/spendvault.md`.

## Layout
- `api/` — Fastify 5 + drizzle + Postgres + Temporal worker (same tree, `Dockerfile.worker`). **`api/ROUTES.md` is the contract: change it first, then code.**
- `web/` — Next 16 on a Cloudflare Worker (opennext). `next build --webpack`, no proxy.ts/middleware, `.env.production` committed. PWA with Web Share Target (`public/sw.js`).
  Styles: public home = `app/home.css` (`spv-` prefix); signed-in pages = `app/(app)/app.css` (`spa-` prefix, dark only like home). Nav (`components/AppShell.tsx`): Overview, Transactions, Receipts, Inbox (/documents), Insights (/alerts + /savings), Setup/Settings; money/dates only via `lib/format.ts`.
- `inbound/` — Email Routing Worker for `vault+<token>@in.spendvault.3pandalabs.com`; dumb transport to `POST /internal/inbound-email`.
- `infra/README.md` — provisioning/deploy runbook.

## Rules
- One lowercase identifier: `spendvault` (repo, DB, role, Coolify, hosts, `/metrics` app key). One first label for all hostnames.
- Branch → PR → merge as `3pandalabs-admin`. Never commit to main, never `git add -A`.
- Financial data: never log amounts, merchants, statement text, PDF passwords or email content — ids and counts only. Every query scoped by user id; other users' rows → 404.
- Data at rest: PDF passwords and raw documents (receipt images included) are AES-256-GCM encrypted with `DATA_KEY` (`api/src/lib/crypto.ts`). Originals are deleted after a successful parse unless the user turned that off. Any change to what's stored updates the privacy page in the same PR.
- Receipts: a `documents` row with `kind = receipt` + `receipts`/`receipt_items`. No `ANTHROPIC_API_KEY` → stored as `pending_extraction`, never guessed. Matching rules live in `lib/receipts/match.ts` (see ROUTES.md "Receipts").
- US-first, India second: new sign-ups default to USD (`lib/currency.ts`; the web sends INR for browsers on India time; the DB column default stays "INR" so no migration). Public copy leads with US banks and $ examples; INR users keep en-IN formatting and GST/forex wording. `gmailFilterQuery()` covers every country's senders and must stay under `GMAIL_FILTER_MAX`.
- Migrations are hand-written and idempotent (they run on container start). Never set `MIGRATION_DATABASE_URL`.
- Pure modules (`lib/categories`, `lib/institutions`, `lib/ingest/*` parsers, `lib/insights/*` analytics, except the DB-side `insights/load.ts` + `insights/sweep.ts`; `lib/receipts/*` except `receipts/db.ts` + `receipts/process.ts`) must not import env/db, so vitest runs with no infrastructure.
- Spend totals exclude `superseded_by IS NOT NULL` (alert rows later matched by a statement line) and `NON_SPEND` categories (card bill payments, income, transfers, investments).
- New sign-up alert (`lib/newUserAlert.ts`, 2026-11-26): `POST /auth/signup` emails "SpendVault New user" (app, email, name, UTC time, user id — never financial data) to `NEW_USER_ALERT_EMAIL` (default 3pandas@3pandalabs.com; `off` disables) through `lib/mailer.ts`. Fire-and-forget, never awaited; 409 conflicts and the SQL demo seed send nothing. Any new user-creating path must decide whether it alerts.
- `/metrics` follows the org envelope; keep `metrics/collector.ts` byte-identical across apps. Update the admin flow diagram when routes/auth change.

## Local dev
```
cd api && docker compose -f docker-compose.dev.yml up -d && cp .env.example .env  # fill JWT_SECRET, DATA_KEY
npm run db:migrate && npm run dev          # PROCESS_INLINE=true parses in-process, no Temporal needed
cd web && npm run dev                      # NEXT_PUBLIC_API_URL=http://localhost:8080
```
