# SpendVault API contract

Change this file FIRST, then the code. JSON everywhere. Auth = `Authorization: Bearer <accessToken>`.
Errors: `{ "error": string, "code"?: string }`. Anything outside the caller's data → **404** (never 403).
Money values are **numbers in major units** (₹123.45 → `123.45`), rounded to 2 dp. Dates are `YYYY-MM-DD`; timestamps ISO-8601.
Spend totals always exclude `superseded_by IS NOT NULL` rows and NON_SPEND categories (`card_payment`, `income`, `transfers`, `investments`; see `src/lib/categories.ts`).

## Health / ops
- `GET /health` → `{ ok: true, commit, startedAt }`
- `GET /metrics` (Bearer METRICS_TOKEN; 503 if unset) → org envelope; `counts`: `users, documents, documentsLast24h, documentsNeedingPassword, documentsFailed, transactions, alertsLast7d, whatsappLinkedUsers, activeSessions`

## Auth (same scheme as BorrowVault)
- `POST /auth/signup` `{ email, password (>=10), displayName }` → 201 `AuthResponse`; 409 `registration_failed`
- `POST /auth/login` `{ email, password }` → `AuthResponse`; 401 `invalid_credentials`
- `POST /auth/refresh` `{ refreshToken }` → `AuthResponse` (rotates)
- `POST /auth/logout` (auth) `{ refreshToken }` → 204
- `POST /auth/password-reset/request` `{ email }` → 204 (always)
- `POST /auth/password-reset/confirm` `{ token, password }` → 204; 400 `invalid_or_expired_token`

`AuthResponse = { accessToken, refreshToken, user: User }`
`User = { id, email, displayName, baseCurrency, alertEmails, deleteOriginals, createdAt }`

## Me / setup
- `GET /me` → `Me`
  ```
  Me = User & {
    forwardingAddress: string,            // vault+<inbound_token>@INBOUND_DOMAIN (plus tag = user)
    whatsapp: { available: boolean, linkedPhone: string|null, number: string|null },
    setup: { hasDocuments: boolean, hasPasswords: boolean, forwardingConfirmed: boolean },
    llmEnabled: boolean
  }
  ```
- `PATCH /me` `{ displayName?, alertEmails?, deleteOriginals?, baseCurrency? ("INR"|"USD") }` → `Me`
- `DELETE /me` `{ password }` → 204. Deletes the user and ALL their data (cascade). 401 `invalid_credentials`.
- `GET /me/export` → `{ transactions: Transaction[], accounts: Account[], alerts: Alert[] }` (JSON download of everything parsed)
- `GET /setup/forwarding` →
  ```
  { address, gmailFilterQuery: string, gmailSteps: string[],
    confirmations: Array<{ id, provider, forwardFrom: string|null, code: string|null, confirmUrl: string|null, createdAt }> }
  ```
  `gmailFilterQuery` is a ready-to-paste Gmail search, e.g. `from:(hdfcbank.net OR icicibank.com OR ...) (statement OR "transaction alert" OR debited OR spent)`.

## PDF passwords (secrets are write-only; never returned)
- `GET /pdf-passwords` → `{ items: Array<{ id, institution: string|null, label, lastUsedAt: string|null, createdAt }> }`
- `POST /pdf-passwords` `{ institution?: string|null, label, password }` → 201 item. Also re-queues this user's `needs_password` documents.
- `DELETE /pdf-passwords/:id` → 204
- `GET /institutions` → `{ items: Array<{ key, name, country: "IN"|"US", kinds: ("credit_card"|"bank")[], passwordHint: string|null }> }` (public, no auth)

## Documents
- `GET /documents?status=&limit=50&cursor=` → `{ items: Document[], nextCursor: string|null }` (newest first; cursor = opaque)
  ```
  Document = { id, source: "email"|"upload"|"share"|"whatsapp", kind: "statement"|"alert"|"unknown",
    status: "received"|"processing"|"parsed"|"needs_password"|"failed"|"ignored",
    filename: string|null, mimeType, sizeBytes, emailFrom: string|null, emailSubject: string|null,
    institution: string|null, institutionName: string|null, accountId: string|null,
    periodStart: string|null, periodEnd: string|null, statementTotal: number|null, extractedDebits: number|null,
    reconciled: boolean|null, txnCount, parser: string|null, error: string|null,
    hasOriginal: boolean, processedAt: string|null, createdAt }
  ```
- `POST /documents` multipart: one or more `file` parts (PDF, CSV, XLSX, XLS, TXT, EML; ≤10 MB each, ≤10 files), optional field `source` = `upload`|`share` (default upload), optional field `password` (tried first for these files, and saved if it works and `savePassword=true`) →
  201 `{ items: Document[] }`. Duplicate file (same sha256) → returns the existing document, not an error.
- `GET /documents/:id` → `Document`
- `POST /documents/:id/retry` `{ password?: string, savePassword?: boolean }` → 202 `Document` (requires `hasOriginal`; 409 `original_deleted` otherwise)
- `DELETE /documents/:id?deleteTransactions=true|false` (default true) → 204

## Accounts
- `GET /accounts` → `{ items: Account[] }`
  `Account = { id, institution, institutionName, kind: "credit_card"|"bank"|"unknown", last4, label: string|null, currency, txnCount, lastTxnOn: string|null }`
- `PATCH /accounts/:id` `{ label: string|null }` → `Account`

## Transactions
- `GET /transactions?from=&to=&category=&accountId=&q=&direction=&limit=100&cursor=` → `{ items: Transaction[], nextCursor: string|null }` (newest `postedOn` first; superseded rows excluded)
  ```
  Transaction = { id, accountId: string|null, documentId: string|null, postedOn, descriptionRaw, merchant, category,
    amount: number, direction: "debit"|"credit", currency, sourceKind: "statement"|"alert"|"csv", categoryLocked: boolean }
  ```
- `PATCH /transactions/:id` `{ category, applyToMerchant?: boolean }` → `Transaction`. `applyToMerchant` upserts a category rule and recategorizes all of this user's unlocked transactions with that merchant.
- `GET /categories` → `{ items: Array<{ key, label, essential: boolean, spend: boolean }> }` (public)

## Dashboard
- `GET /dashboard?month=YYYY-MM` (default: latest month with data, else current) →
  ```
  { month, currency, availableMonths: string[],
    totals: { spend, previousMonthSpend, avg3MonthSpend, income, txnCount },
    byCategory: Array<{ category, label, amount, previous: number, avg3: number, share: number }>,   // share 0..1, desc by amount
    byAccount: Array<{ accountId, label, amount }>,
    topMerchants: Array<{ merchant, category, amount, count }>,          // top 10
    daily: Array<{ date, amount }>,                                        // every day of the month
    trend: Array<{ month, spend }>,                                        // last 12 months, oldest first
    recentAlerts: Alert[] }                                                // up to 5, not dismissed
  ```

## Alerts (spikes)
- `GET /alerts?includeDismissed=false&limit=50` → `{ items: Alert[] }`
  `Alert = { id, kind: "category_spike"|"daily_spike"|"large_new_merchant"|"price_hike"|"fee"|"duplicate", title, body, category: string|null, merchant: string|null, amount: number|null, baseline: number|null, periodStart: string|null, createdAt, dismissedAt: string|null }`
- `POST /alerts/:id/dismiss` → 204
- `POST /alerts/recompute` → `{ created: number }` (runs the detector for the caller now; rate limited)

## Savings
- `GET /savings` →
  ```
  { estimatedMonthlySavings: number,
    subscriptions: Array<{ merchant, category, monthlyAmount, cadence: "monthly"|"yearly"|"weekly", lastChargedOn, occurrences, annualCost, priceChanged: boolean }>,
    fees: { totalLast12Months, items: Array<{ type: "late_fee"|"interest"|"forex"|"annual_fee"|"cash_advance"|"gst_on_fees"|"other", label, amount, count }> },
    duplicates: Array<{ merchant, amount, dates: string[], transactionIds: string[] }>,
    tips: Array<{ id, kind: "subscription"|"fee"|"category"|"card"|"duplicate", title, body, monthlySaving: number }> }   // sorted by monthlySaving desc
  ```

## WhatsApp
- `POST /whatsapp/link` → `{ code: "LINK-XXXXXX", expiresAt, number: string|null }` (503 `whatsapp_unavailable` if not configured). The user sends the code from their WhatsApp to our number.
- `DELETE /whatsapp/link` → 204
- `GET /webhooks/whatsapp` (Meta verification: `hub.mode`, `hub.verify_token`, `hub.challenge`)
- `POST /webhooks/whatsapp` (Meta, `X-Hub-Signature-256` HMAC with WHATSAPP_APP_SECRET; raw body) → 200 always after signature check.
  Text `LINK-XXXXXX` links the sender's phone. A document/image from a linked phone becomes a `whatsapp` document; we reply "Got it" and later a one-line result.

## Internal (X-Internal-Secret = INTERNAL_SHARED_SECRET; 503 if unset, 401 if wrong)
- `POST /internal/inbound-email` headers `X-Envelope-To`, `X-Envelope-From`; body = raw RFC822 message (`content-type: message/rfc822`, ≤25 MB) →
  200 `{ accepted: number, ignored: string|null }`. Unknown recipient token → 200 `{ accepted: 0, ignored: "unknown_recipient" }` (the Worker must not bounce-loop).
