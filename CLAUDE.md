# SpendVault — CLAUDE.md

Expense insights from emailed bank/credit-card statements (3PandaLabs app #7). Origin: `3pandalabs/ideas` → `ideas/spendvault.md`.

## Layout
- `api/` — Fastify 5 + drizzle + Postgres + Temporal worker (same tree, `Dockerfile.worker`). **`api/ROUTES.md` is the contract: change it first, then code.**
- `web/` — Next 16 on a Cloudflare Worker (opennext). `next build --webpack`, no proxy.ts/middleware, `.env.production` committed. PWA with Web Share Target (`public/sw.js`).
  Styles: public home = `app/home.css` (`spv-` prefix); signed-in pages = `app/(app)/app.css` (`spa-` prefix, dark only like home). Nav (`components/AppShell.tsx`): Overview, Transactions, Receipts, Inbox (/documents, statement detail at /documents/detail), Insights (/alerts, /savings, /subscriptions, /budgets), Net worth, Setup/Settings/Household; money/dates only via `lib/format.ts`.
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
- Planning (0002, 2026-11-27): subscriptions (`insights/subscriptions.ts` on top of `recurring.ts`), card fees (`insights/fees.ts`), budgets (`insights/budgets.ts`), safe to spend (`insights/safeToSpend.ts`), net worth (`insights/networth.ts`), statement reconciliation (`ingest/reconcile.ts`, opening/closing stored on `documents`). All pure + unit-tested in `test/insights/planning.test.ts`. New alert kinds `new_subscription`, `over_budget` come from `detectSpikes`.
- Households (`lib/household/*`, `HOUSEHOLD_ENABLED`): members may READ each other's transactions only through `scope=household` on `/dashboard` and `/transactions` (`scopeUserIds`). Every other query stays scoped to the caller; writes on another member's rows stay 404. Joining needs the invited email signed in + an explicit Join.
- CSV exports (`lib/csv.ts`) neutralize formula cells; keep the "your data is yours" export free.
- Tools (0003, 2026-11-27): card dues + utilization (`insights/cards.ts`; due date / minimum / limit on `documents`, rules parser + LLM tool), return windows + warranties (`receipts/returns.ts`, `RETURN_POLICIES` is the editable "typical" table; per-receipt `return_days` override), item price tracker (`receipts/prices.ts`), refund watches (`insights/refunds.ts`), trial→paid (`insights/trials.ts`), cancel links (`insights/cancelLinks.ts`: official account/help pages only, never cancel for the user), splits/tags/notes (`lib/txnTools.ts`; user splits feed dashboard category views and win over receipt splits), goals (`insights/goals.ts`), tax tags + HSA/FSA hints (`lib/tax.ts`, hints not advice), weekly/monthly digests (`insights/periodDigest.ts`). All pure + tested in `test/insights/tools.test.ts`, `test/receipts/tools.test.ts`; DB loaders in `lib/toolsDb.ts`. New alert kinds `card_due`, `return_window`, `warranty`, `refund_missing`, `trial_converted` come from `recomputeAlertsForUser`; the sweep re-checks users with pending reminders every 6 h.
- "Today" is per user (`lib/userTime.ts`, `users.timezone` from the browser; fallback by currency). Don't add new `todayInKolkata()` calls in routes.
- Ask SpendVault (`lib/ask/*`): Claude only calls the fixed tools in `ask/tools.ts` (Zod `.strict()`, ranges ≤ 3 years, ≤ 25 rows); every read is bound to the caller in `ask/db.ts` (never household, never a model-supplied id). 20 questions / user / 24 h, usage (tokens only, never text) in `ask_usage`. `tool_choice: auto` (newer models reject forced tools). Adding a tool = schema + def + test that unknown fields are rejected.
- Emails: one alert digest per day (`alertEmails`, a stage-1 card reminder may skip the 20 h gap) + at most one weekly and one monthly summary per user per period (period key claimed in `users.last_*_digest` before sending). Monthly is on by default, weekly opt-in.
- Plus-tier candidates (all free today): Ask SpendVault beyond 20/day, weekly digest, price tracker history beyond 2 years, tax export.
- `/metrics` follows the org envelope; keep `metrics/collector.ts` byte-identical across apps. Update the admin flow diagram when routes/auth change.

## Local dev
```
cd api && docker compose -f docker-compose.dev.yml up -d && cp .env.example .env  # fill JWT_SECRET, DATA_KEY
npm run db:migrate && npm run dev          # PROCESS_INLINE=true parses in-process, no Temporal needed
cd web && npm run dev                      # NEXT_PUBLIC_API_URL=http://localhost:8080
```
