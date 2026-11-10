# SpendVault infra runbook

Identifier everywhere: **`spendvault`**. One first label for every hostname (CERTIFICATES gotcha in `knowledge_base/tech-stack.md`).

| Piece | Where | Name |
|---|---|---|
| Web | Cloudflare Worker (`web/`, `npm run cf:deploy`) | `spendvault-web` → `spendvault.3pandalabs.com` |
| Inbound email | Cloudflare Worker (`inbound/`, `npm run deploy`) + Email Routing on subdomain | `spendvault-inbound` ← `vault@in.spendvault.3pandalabs.com` (users get `vault+<token>@…`) |
| API | Coolify app on `nrighar-coolify-fsn` (`api/Dockerfile`) | `spendvault-api` → `api.spendvault.3pandalabs.com` (proxied) + `api-internal.spendvault.3pandalabs.com` (DNS-only) |
| Worker | Coolify app (`api/Dockerfile.worker`) | `spendvault-worker`, Temporal task queue `spendvault` |
| DB | shared `3pandalabs-postgres` | database `spendvault`, owning role `spendvault_app` |
| Backups | R2 | `spendvault-backups` (Coolify Postgres backup schedule) |

No media bucket: raw documents are stored **encrypted in Postgres** (`documents.content_enc`, AES-256-GCM with `DATA_KEY`) and deleted right after a successful parse by default.

## Provision (in order)

1. **DB** (on the box, the postgres container that holds the app DBs — check `\l` first):
   ```sql
   CREATE ROLE spendvault_app LOGIN PASSWORD '<generate>';
   CREATE DATABASE spendvault OWNER spendvault_app;
   \c spendvault
   ALTER SCHEMA public OWNER TO spendvault_app;
   ```
   Record the password in Claude memory. Never set `MIGRATION_DATABASE_URL`.
2. **DNS** (before the first Coolify deploy): `api.spendvault` A → box IP **proxied**; `api-internal.spendvault` A → box IP **DNS-only**.
3. **Coolify** `spendvault-api`: Base Directory `api`, Dockerfile `Dockerfile`, port 8080, domains `https://api.spendvault.3pandalabs.com,https://api-internal.spendvault.3pandalabs.com`. `spendvault-worker`: Base Directory `api`, Dockerfile `Dockerfile.worker`, no domain. **Every env var runtime-only.**
   Env for both (see `api/.env.example`): `DATABASE_URL`, `JWT_SECRET`, `DATA_KEY` (**back it up** — losing it makes saved PDF passwords and unparsed documents unreadable), `WEB_ORIGIN=https://spendvault.3pandalabs.com`, `INBOUND_DOMAIN=in.spendvault.3pandalabs.com`, `INTERNAL_SHARED_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE=spendvault`, `SMTP_USER`/`SMTP_PASS` (or `MAILER_*`), `METRICS_TOKEN`, optional `WHATSAPP_*`. Do **not** set `PROCESS_INLINE` in prod.
4. **Email Routing for the subdomain** (Cloudflare dashboard → 3pandalabs.com → Email → Email Routing → Settings → *Subdomains* → add `in.spendvault`; it adds the MX/SPF records). Catch-all rules only work on the apex, so instead: Settings → turn on **Subaddressing**, then Routing rules → **Create address** `vault@in.spendvault.3pandalabs.com` → action *Send to a Worker* → `spendvault-inbound`. Every user address is `vault+<token>@…` and matches that one rule. Deploy the Worker first (`cd inbound && npx wrangler deploy && npx wrangler secret put INTERNAL_SHARED_SECRET`). The apex MX (hello@) is untouched.
5. **Web**: `cd web && npm run cf:deploy` (creates the `spendvault.3pandalabs.com` custom domain). `INTERNAL_SHARED_SECRET` as a wrangler secret if the web Worker calls api-internal.
6. **WhatsApp (optional, later)**: Meta Business account → WhatsApp Cloud API app → phone number. Webhook URL `https://api.spendvault.3pandalabs.com/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`. Set the five `WHATSAPP_*` vars on api + worker.
7. **Backups**: R2 bucket `spendvault-backups` + Coolify backup schedule for the `spendvault` DB.

## The six surfaces (none sync)
Website app card · admin (`METRICS_TARGETS` + Usage table + flow diagram + cost card) · `knowledge_base/tech-stack.md` section · Claude memory · Uptime Kuma checks (web, api `/health`) · Search Console sitemap.

## Verify
`/health` on both API hosts; sign up in a real browser; Gmail forwarding confirmation code shows up in /setup; forward a real statement; upload a password-protected PDF; check the dashboard; `/metrics` with the token.
