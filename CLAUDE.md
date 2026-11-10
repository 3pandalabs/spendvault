# SpendVault — CLAUDE.md

Expense insights from emailed bank/credit-card statements (3PandaLabs app #7). Origin: `3pandalabs/ideas` → `ideas/spendvault.md`.

## Layout
- `api/` — Fastify 5 + drizzle + Postgres + Temporal worker (same tree, `Dockerfile.worker`). **`api/ROUTES.md` is the contract: change it first, then code.**
- `web/` — Next 16 on a Cloudflare Worker (opennext). `next build --webpack`, no proxy.ts/middleware, `.env.production` committed. PWA with Web Share Target (`public/sw.js`).
- `inbound/` — Email Routing Worker for `*@in.spendvault.3pandalabs.com`; dumb transport to `POST /internal/inbound-email`.
- `infra/README.md` — provisioning/deploy runbook.

## Rules
- One lowercase identifier: `spendvault` (repo, DB, role, Coolify, hosts, `/metrics` app key). One first label for all hostnames.
- Branch → PR → merge as `3pandalabs-admin`. Never commit to main, never `git add -A`.
- Financial data: never log amounts, merchants, statement text, PDF passwords or email content — ids and counts only. Every query scoped by user id; other users' rows → 404.
- Data at rest: PDF passwords and raw documents are AES-256-GCM encrypted with `DATA_KEY` (`api/src/lib/crypto.ts`). Originals are deleted after a successful parse unless the user turned that off.
- Migrations are hand-written and idempotent (they run on container start). Never set `MIGRATION_DATABASE_URL`.
- Pure modules (`lib/categories`, `lib/institutions`, `lib/ingest/*` parsers, `lib/insights/*` analytics, except the DB-side `insights/load.ts` + `insights/sweep.ts`) must not import env/db, so vitest runs with no infrastructure.
- Spend totals exclude `superseded_by IS NOT NULL` (alert rows later matched by a statement line) and `NON_SPEND` categories (card bill payments, income, transfers, investments).
- `/metrics` follows the org envelope; keep `metrics/collector.ts` byte-identical across apps. Update the admin flow diagram when routes/auth change.

## Local dev
```
cd api && docker compose -f docker-compose.dev.yml up -d && cp .env.example .env  # fill JWT_SECRET, DATA_KEY
npm run db:migrate && npm run dev          # PROCESS_INLINE=true parses in-process, no Temporal needed
cd web && npm run dev                      # NEXT_PUBLIC_API_URL=http://localhost:8080
```
