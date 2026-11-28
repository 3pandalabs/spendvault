# SpendVault API contract

Change this file FIRST, then the code. JSON everywhere. Auth = `Authorization: Bearer <accessToken>`.
Errors: `{ "error": string, "code"?: string }`. Anything outside the caller's data → **404** (never 403).
Money values are **numbers in major units** (₹123.45 → `123.45`), rounded to 2 dp. Dates are `YYYY-MM-DD`; timestamps ISO-8601.
Spend totals always exclude `superseded_by IS NOT NULL` rows and NON_SPEND categories (`card_payment`, `income`, `transfers`, `investments`; see `src/lib/categories.ts`).

## Health / ops
- `GET /health` → `{ ok: true, commit, startedAt }`
- `GET /metrics` (Bearer METRICS_TOKEN; 503 if unset) → org envelope; `counts`: `users, documents, documentsLast24h, documentsNeedingPassword, documentsFailed, transactions, alertsLast7d, whatsappLinkedUsers, activeSessions, receipts`

## Auth (same scheme as BorrowVault)
- `POST /auth/signup` `{ email, password (>=10), displayName, baseCurrency? ("USD"|"INR") }` → 201 `AuthResponse`; 409 `registration_failed` (`baseCurrency` defaults to `"USD"`; the web client sends `"INR"` for browsers on India time. A 201 also fires the fire-and-forget "SpendVault New user" email to `NEW_USER_ALERT_EMAIL`)
- `POST /auth/login` `{ email, password }` → `AuthResponse`; 401 `invalid_credentials`
- `POST /auth/refresh` `{ refreshToken }` → `AuthResponse` (rotates)
- `POST /auth/logout` (auth) `{ refreshToken }` → 204
- `POST /auth/password-reset/request` `{ email }` → 204 (always)
- `POST /auth/password-reset/confirm` `{ token, password }` → 204; 400 `invalid_or_expired_token`

`AuthResponse = { accessToken, refreshToken, user: User }`
`User = { id, email, displayName, baseCurrency, alertEmails, deleteOriginals, monthlyBudget: number|null, createdAt }`

## Me / setup
- `GET /me` → `Me`
  ```
  Me = User & {
    forwardingAddress: string,            // vault+<inbound_token>@INBOUND_DOMAIN (plus tag = user)
    whatsapp: { available: boolean, linkedPhone: string|null, number: string|null },
    setup: { hasDocuments: boolean, hasPasswords: boolean, forwardingConfirmed: boolean },
    llmEnabled: boolean,
    features: { household: boolean },     // HOUSEHOLD_ENABLED (on unless "false")
    household: { id, name, memberCount }|null
  }
  ```
- `PATCH /me` `{ displayName?, alertEmails?, deleteOriginals?, baseCurrency? ("USD"|"INR"), monthlyBudget?: number|null }` → `Me` (`monthlyBudget` 0/null clears it)
- `DELETE /me` `{ password }` → 204. Leaves any household first, then deletes the user and ALL their data (cascade). 401 `invalid_credentials`.
- `GET /me/export` → `{ transactions: Transaction[], accounts: Account[], alerts: Alert[], receipts: Array<Receipt & { items: ReceiptItem[] }> }` (JSON download of everything parsed)
- `GET /me/export/transactions.csv` → `text/csv` (UTF-8 BOM, CRLF): `date, merchant, description, category, amount, direction, signed_amount, currency, account, source, receipt_id, transaction_id` (non-superseded, newest first). Text cells starting with `= + - @` get a leading `'` (no formula injection).
- `GET /me/export/receipt-items.csv` → `text/csv`: `purchase_date, merchant, item, quantity, unit_price, line_total, category, receipt_total, currency, receipt_id, transaction_id`
  (all three exports share one limiter: 10/hour)
- `GET /setup/forwarding` →
  ```
  { address, gmailFilterQuery: string, gmailSteps: string[],
    confirmations: Array<{ id, provider, forwardFrom: string|null, code: string|null, confirmUrl: string|null, createdAt }> }
  ```
  `gmailFilterQuery` is a ready-to-paste Gmail search, e.g. `from:(chase.com OR americanexpress.com OR ... OR hdfcbank.net OR ...) (statement OR transaction OR purchase OR debited OR spent ...)`; it covers every known sender (US and India) and stays under Gmail's filter length limit.

## PDF passwords (secrets are write-only; never returned)
- `GET /pdf-passwords` → `{ items: Array<{ id, institution: string|null, label, lastUsedAt: string|null, createdAt }> }`
- `POST /pdf-passwords` `{ institution?: string|null, label, password }` → 201 item. Also re-queues this user's `needs_password` documents.
- `DELETE /pdf-passwords/:id` → 204
- `GET /institutions` → `{ items: Array<{ key, name, country: "IN"|"US", kinds: ("credit_card"|"bank")[], passwordHint: string|null }> }` (public, no auth)

## Documents
- `GET /documents?status=&limit=50&cursor=` → `{ items: Document[], nextCursor: string|null }` (newest first; cursor = opaque)
  ```
  Document = { id, source: "email"|"upload"|"share"|"whatsapp", kind: "statement"|"alert"|"receipt"|"unknown",
    status: "received"|"processing"|"parsed"|"needs_password"|"failed"|"ignored"|"pending_extraction",   // pending_extraction: receipts only
    filename: string|null, mimeType, sizeBytes, emailFrom: string|null, emailSubject: string|null,
    institution: string|null, institutionName: string|null, accountId: string|null,
    periodStart: string|null, periodEnd: string|null, statementTotal: number|null, extractedDebits: number|null,
    reconciled: boolean|null,
    openingBalance: number|null, closingBalance: number|null, extractedCredits: number|null,
    reconcileDifference: number|null,   // closing − (opening ± what we read); card: + = charges we didn't read
    txnCount, parser: string|null, error: string|null,
    hasOriginal: boolean, processedAt: string|null, createdAt }
  ```
  Reconciliation ("Reconciled ✓"): card `opening + debits − credits ≈ closing (new balance / total due)`, bank `opening − debits + credits ≈ closing`, tolerance max(1, 0.5% of closing). `reconciled` is null unless both ends were read (rules parser or Claude extraction). Documents parsed before 0002 have null opening/closing.
- `POST /documents` multipart: one or more `file` parts (PDF, CSV, XLSX, XLS, TXT, EML, JPG, PNG, WEBP; ≤10 MB each, ≤10 files), optional field `source` = `upload`|`share` (default upload), optional field `kind` = `receipt` (the "Add receipt" button; every file must then be an image, PDF or TXT), optional field `password` (tried first for these files, and saved if it works and `savePassword=true`) →
  201 `{ items: Document[] }`. Duplicate file (same sha256) → returns the existing document, not an error.
  Receipt vs statement: images are always receipts. PDFs are statements unless `kind=receipt`; a PDF/TXT "statement" that yields no transactions and reads like an invoice (`lib/receipts/detect.ts`) is rerouted to the receipt pipeline. Forwarded email: image attachments (≥20 KB, not inline) are receipts; a PDF from a non-bank sender with an order/invoice subject is a receipt; a body that reads like an e-receipt from a non-bank sender is a receipt. Bank senders always keep the statement/alert path.
- `GET /documents/:id` → `Document`
- `POST /documents/:id/retry` `{ password?: string, savePassword?: boolean }` → 202 `Document` (requires `hasOriginal`; 409 `original_deleted` otherwise)
- `DELETE /documents/:id?deleteTransactions=true|false` (default true) → 204

## Accounts
- `GET /accounts` → `{ items: Account[] }`
  `Account = { id, institution, institutionName, kind: "credit_card"|"bank"|"unknown", last4, label: string|null, currency, includeInNetWorth: boolean, txnCount, lastTxnOn: string|null }`
- `PATCH /accounts/:id` `{ label?: string|null, includeInNetWorth?: boolean }` → `Account`

## Transactions
- `GET /transactions?from=&to=&category=&accountId=&documentId=&q=&direction=&scope=me|household&member=all|<userId>&limit=100&cursor=` → `{ items: Transaction[], nextCursor: string|null }` (newest `postedOn` first; superseded rows excluded). `scope=household` reads every household member's rows (or `member`'s; 404 if not a member) and adds `ownerId` to each item; other members' rows stay read-only (PATCH/detail → 404).
  ```
  Transaction = { id, accountId: string|null, documentId: string|null, postedOn, descriptionRaw, merchant, category,
    amount: number, direction: "debit"|"credit", currency, sourceKind: "statement"|"alert"|"csv", categoryLocked: boolean,
    receiptId: string|null }                                              // the linked receipt, if any
  ```
- `GET /transactions/:id` → `Transaction & { receipt: ReceiptDetail|null }` (transaction detail view with the receipt's line items)
- `PATCH /transactions/:id` `{ category, applyToMerchant?: boolean }` → `Transaction`. `applyToMerchant` upserts a category rule and recategorizes all of this user's unlocked transactions with that merchant.
- `GET /categories` → `{ items: Array<{ key, label, essential: boolean, spend: boolean }> }` (public)

## Dashboard
- `GET /dashboard?month=YYYY-MM&scope=me|household&member=all|<userId>` (default: latest month with data, else current; `scope=household` combines members' transactions in the caller's base currency, account labels get the partner's first name, `recentAlerts` is empty and the planning fields below are null) →
  ```
  { month, currency, availableMonths: string[],
    totals: { spend, previousMonthSpend, avg3MonthSpend, income, txnCount },
    byCategory: Array<{ category, label, amount, previous: number, avg3: number, share: number }>,   // share 0..1, desc by amount
    byAccount: Array<{ accountId, label, amount }>,
    topMerchants: Array<{ merchant, category, amount, count }>,          // top 10
    daily: Array<{ date, amount }>,                                        // every day of the month
    trend: Array<{ month, spend }>,                                        // last 12 months, oldest first
    recentAlerts: Alert[],                                                 // up to 5, not dismissed
    receipts: { total, matched, unmatched, pendingExtraction,              // all-time receipt counts (prompts)
      itemized: { txnCount, amount,                                        // this month's transactions with a matched receipt whose items add up
        byCategory: Array<{ category, label, amount }> } },                // their spend by item category, desc; sums to amount
    scope: "me"|"household", members: Array<{ userId, displayName, isMe }>,   // [] outside a household view
    safeToSpend: SafeToSpend|null,                                         // current month, own view only
    budgets: { count, over, near, top: BudgetLine[] }|null,                // top 3 by progress
    netWorth: { netWorth, assets, liabilities, asOf: string|null }|null }  // null when nothing counts
  SafeToSpend = { month, basis: "budget"|"category_budgets"|"income", base, spent, upcoming,
    upcomingItems: Array<{ merchant, amount, expectedOn }>, amount, daysLeft, perDay }
  ```
  Safe to spend = base − spent this month − active recurring charges (subscriptions and bills) still expected this month. Base = the monthly budget, else the sum of category budgets, else average income of the last 3 complete months (needs income in ≥ 2 of them); none → null. `lib/insights/safeToSpend.ts`.

## Alerts (spikes)
- `GET /alerts?includeDismissed=false&limit=50` → `{ items: Alert[] }`
  `Alert = { id, kind: "category_spike"|"daily_spike"|"large_new_merchant"|"price_hike"|"fee"|"duplicate"|"new_subscription"|"over_budget", title, body, category: string|null, merchant: string|null, amount: number|null, baseline: number|null, periodStart: string|null, createdAt, dismissedAt: string|null }`
  `new_subscription`: a subscription-like recurring charge whose first charge is ≤ 75 days old, or a first-ever `subscriptions` debit ≤ 35 days old, with ≥ 30 days of history before it (once per merchant). `over_budget`: a category (or the overall monthly budget) over budget in this or last month (once per category per month). `fee`: the month's fees by type (late, interest, foreign transaction, annual, cash advance, ATM, over-limit, overdraft/returned payment).
- `POST /alerts/:id/dismiss` → 204
- `POST /alerts/recompute` → `{ created: number }` (runs the detector for the caller now; rate limited)

## Savings
- `GET /savings` →
  ```
  { estimatedMonthlySavings: number,
    subscriptions: Array<{ merchant, category, monthlyAmount, cadence: "monthly"|"yearly"|"weekly", lastChargedOn, occurrences, annualCost, priceChanged: boolean }>,
    fees: { totalLast12Months, items: Array<{ type: "late_fee"|"interest"|"forex"|"annual_fee"|"cash_advance"|"atm_fee"|"overlimit"|"overdraft"|"gst_on_fees"|"other", label, amount, count }> },
    duplicates: Array<{ merchant, amount, dates: string[], transactionIds: string[] }>,
    tips: Array<{ id, kind: "subscription"|"fee"|"category"|"card"|"duplicate", title, body, monthlySaving: number }> }   // sorted by monthlySaving desc
  ```

## Subscriptions
- `GET /subscriptions` →
  ```
  { currency, monthlyTotal, yearlyTotal,
    items: Array<{ merchant, category, cadence: "weekly"|"monthly"|"yearly", amount, monthlyAmount, annualCost,
      firstChargedOn, lastChargedOn, nextExpectedOn, occurrences, priceChanged: boolean, previousAmount: number|null, isNew: boolean }> }
  ```
  Active recurring charges (same merchant, regular interval, similar amount; `lib/insights/recurring.ts`) in subscription-like categories, biggest monthly cost first. `nextExpectedOn` = last charge + one cadence step (monthly keeps the day of month). `isNew` = first charge ≤ 75 days ago.

## Budgets
`BudgetLine = { category, label, budget, spent, remaining, progress, status: "ok"|"near"|"over" }` (near ≥ 80%; spent uses the dashboard rules)
- `GET /budgets?month=YYYY-MM` (default current) →
  `{ month, currency, monthlyBudget: number|null, totals: { budgeted, spent, spentInBudgeted }, items: BudgetLine[], suggestions: Array<{ category, label, suggested, average }> }`
  Suggestions: average of the last 3 complete months with data, rounded up ($5/$25/$100, ₹50/₹500/₹1,000), for spend categories without a budget averaging ≥ $5 / ₹200 (fees excluded).
- `PUT /budgets/:category` `{ amount }` → the `GET /budgets` body for the current month (400 `invalid_category` for unknown or NON_SPEND categories)
- `DELETE /budgets/:category` → 204
- `PUT /budgets-total` `{ amount: number|null }` → the `GET /budgets` body (overall monthly budget; 0/null clears)
  Budget writes recompute alerts in the background.

## Net worth
- `GET /net-worth` →
  ```
  { currency, netWorth, assets, liabilities, hasData, asOf: string|null,
    accounts: Array<{ accountId, label, kind, currency, includeInNetWorth, balance: number|null, asOf: string|null, side: "asset"|"liability"|null, counted: boolean }>,
    items: NetWorthItem[] }
  NetWorthItem = { id, kind: "asset"|"liability", type: "cash"|"investment"|"retirement"|"property"|"vehicle"|"loan"|"mortgage"|"credit_card"|"other", name, amount, updatedAt }
  ```
  Account balance = the closing balance of its latest parsed statement (card = liability, bank = asset); only base-currency accounts with `includeInNetWorth`. `asOf` = the oldest balance date used.
- `POST /net-worth/items` `{ kind, type, name, amount ≥ 0 }` → 201 `NetWorthItem`
- `PATCH /net-worth/items/:id` (any of those fields) → `NetWorthItem`
- `DELETE /net-worth/items/:id` → 204

## Household (couples; 404 on every route when HOUSEHOLD_ENABLED=false)
Members read each other's transactions in combined views (`GET /dashboard`/`GET /transactions` with `scope=household`). Everything else (documents, receipts, alerts, budgets, net worth, settings) stays personal. At most 4 members + pending invites; one household per user.
`Household = { id, name, role: "owner"|"member", members: Array<{ userId, displayName, email, role, joinedAt, isMe }>, invites: Array<{ id, email, expiresAt, createdAt }> }`
- `GET /household` → `{ household: Household|null }`
- `POST /household/invites` `{ email }` → 201 `{ emailed: boolean, household: Household }` (creates the caller's household on first invite; emails a 7-day link `WEB_ORIGIN/household/join?token=…`, token stored as sha256; re-inviting an address replaces its link; 409 `already_member`/`household_full`; 400 `cannot_invite_self`; 10/hour)
- `DELETE /household/invites/:id` → 204
- `GET /household/join?token=` → `{ valid, code: null|"invalid_or_expired_token"|"wrong_account"|"already_in_household", householdName, invitedBy, email }`
- `POST /household/join` `{ token }` → `{ household }` (the signed-in user's email must equal the invited one; 400 `invalid_or_expired_token`; 409 `wrong_account`/`already_in_household`)
- `DELETE /household/members/me` → 204 (leave; the last member leaving deletes the household; ownership passes to the oldest member)

## Receipts
A receipt is a `documents` row with `kind = "receipt"` plus a `receipts` row and its `receipt_items`. The original photo/PDF/text is the document's AES-256-GCM `content_enc` (DATA_KEY) with the same retention rule as statements: deleted after a successful AI read when `deleteOriginals` is on; kept while pending/failed or when the user typed the total in.
Extraction: Claude (`ANTHROPIC_MODEL`) with vision for photos, a PDF document block for scans, text for e-receipts. Without `ANTHROPIC_API_KEY` the receipt is stored and marked `pending_extraction` (nothing is guessed); the worker re-queues those hourly once a key is set, and the user can type the total meanwhile.
Matching (`lib/receipts/match.ts`): a debit, non-superseded transaction in the same currency, amount within max(1 unit, 1%) of the total ($1 / ₹1), posted within ±3 days of the purchase date (undated: 10 days before to 1 day after the receipt arrived), not linked to another receipt, and not one the user unlinked from this receipt. Auto-linking needs a fuzzy merchant-name match (including the built-in merchant map) or a single candidate on a dated receipt; ties stay unmatched. Runs after extraction, after a manual total, and after every statement/alert that adds transactions (which also moves links from superseded alert rows to the statement line).
Item categories feed `GET /dashboard` `byCategory` (and `receipts.itemized`) only, for matched receipts whose items add up (`itemsReconciled`) and whose transaction category isn't user-locked; the transaction amount is allocated pro rata, so totals never change.
```
Receipt = { id, documentId, status: "processing"|"pending_extraction"|"extracted"|"manual"|"failed",
  merchant: string|null, purchasedOn: string|null, total: number|null, tax: number|null, currency,
  itemCount, itemsReconciled: boolean|null, parser: string|null, error: string|null,
  source: "email"|"upload"|"share"|"whatsapp", filename: string|null, mimeType, hasImage: boolean,
  transactionId: string|null, matchStatus: "unmatched"|"auto"|"confirmed", matchedAt: string|null, createdAt }
ReceiptItem = { id, name, quantity: number|null, unitPrice: number|null, lineTotal: number, category, categoryLocked: boolean }
ReceiptDetail = Receipt & { items: ReceiptItem[], transaction: Transaction|null }
```
- `GET /receipts?match=all|matched|unmatched&status=&limit=50&cursor=` → `{ items: Receipt[], nextCursor: string|null }` (newest first)
- `GET /receipts/:id` → `ReceiptDetail`
- `GET /receipts/:id/image` → the decrypted original (`content-type` = its mime, `cache-control: private, no-store`); 404 once the original is deleted
- `GET /receipts/:id/candidates` → `{ items: Array<Transaction & { score: number }> }` (up to 10 transactions to link instead, best first; ±7 days around the window, ±10% amount)
- `PATCH /receipts/:id` `{ merchant?: string|null, purchasedOn?: string|null, total?: number, tax?: number|null, currency?: "INR"|"USD" }` → `ReceiptDetail`. A `total` on a receipt that wasn't AI-extracted makes it `manual` (its document → `parsed`); an unlinked receipt is then auto-matched.
- `PATCH /receipts/:id/items/:itemId` `{ category }` → `ReceiptDetail` (locks the item's category)
- `POST /receipts/:id/link` `{ transactionId }` → `ReceiptDetail` (`matchStatus: "confirmed"`); 404 unknown transaction; 409 `transaction_already_linked`
- `POST /receipts/:id/confirm` → `ReceiptDetail`; 409 `not_linked`
- `POST /receipts/:id/unlink` → `ReceiptDetail` (that transaction is never auto-linked to this receipt again)
- `POST /receipts/:id/extract` → 202 `ReceiptDetail` (re-run AI extraction); 503 `llm_unavailable`; 409 `original_deleted`
- `POST /receipts/rematch` → `{ matched: number }` (rate limited)
- `DELETE /receipts/:id` → 204 (deletes the document, the receipt and its items; the transaction stays)

## WhatsApp
- `POST /whatsapp/link` → `{ code: "LINK-XXXXXX", expiresAt, number: string|null }` (503 `whatsapp_unavailable` if not configured). The user sends the code from their WhatsApp to our number.
- `DELETE /whatsapp/link` → 204
- `GET /webhooks/whatsapp` (Meta verification: `hub.mode`, `hub.verify_token`, `hub.challenge`)
- `POST /webhooks/whatsapp` (Meta, `X-Hub-Signature-256` HMAC with WHATSAPP_APP_SECRET; raw body) → 200 always after signature check.
  Text `LINK-XXXXXX` links the sender's phone. A document/image from a linked phone becomes a `whatsapp` document (photos are receipts); we reply "Got it" and later a one-line result.

## Internal (X-Internal-Secret = INTERNAL_SHARED_SECRET; 503 if unset, 401 if wrong)
- `POST /internal/inbound-email` headers `X-Envelope-To`, `X-Envelope-From`; body = raw RFC822 message (`content-type: message/rfc822`, ≤25 MB) →
  200 `{ accepted: number, ignored: string|null }`. Unknown recipient token → 200 `{ accepted: 0, ignored: "unknown_recipient" }` (the Worker must not bounce-loop).
