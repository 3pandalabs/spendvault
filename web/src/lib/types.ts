// Every response shape in api/ROUTES.md. Money is a number in major units
// (₹123.45 → 123.45); dates are YYYY-MM-DD; timestamps ISO-8601.

export type Currency = "INR" | "USD";

export type CategoryKey =
  | "food_delivery"
  | "dining"
  | "groceries"
  | "shopping"
  | "fuel"
  | "transport"
  | "travel"
  | "utilities"
  | "telecom"
  | "subscriptions"
  | "entertainment"
  | "health"
  | "education"
  | "rent"
  | "insurance"
  | "investments"
  | "emi_loans"
  | "fees_charges"
  | "cash"
  | "transfers"
  | "card_payment"
  | "income"
  | "other";

export type ApiErrorBody = { error: string; code?: string };

// ---- auth / me ----

export type User = {
  id: string;
  email: string;
  displayName: string;
  baseCurrency: Currency;
  alertEmails: boolean;
  deleteOriginals: boolean;
  monthlyBudget: number | null;
  /** IANA zone the API uses for "today" (null = by currency). */
  timezone?: string | null;
  digestWeekly?: boolean;
  digestMonthly?: boolean;
  createdAt: string;
};

export type AuthResponse = { accessToken: string; refreshToken: string; user: User };

export type Me = User & {
  forwardingAddress: string;
  whatsapp: { available: boolean; linkedPhone: string | null; number: string | null };
  setup: { hasDocuments: boolean; hasPasswords: boolean; forwardingConfirmed: boolean };
  llmEnabled: boolean;
  features?: { household: boolean };
  household?: { id: string; name: string; memberCount: number } | null;
};

export type MePatch = {
  displayName?: string;
  alertEmails?: boolean;
  deleteOriginals?: boolean;
  baseCurrency?: Currency;
  monthlyBudget?: number | null;
  timezone?: string | null;
  digestWeekly?: boolean;
  digestMonthly?: boolean;
};

export type ForwardingConfirmation = {
  id: string;
  provider: string;
  forwardFrom: string | null;
  code: string | null;
  confirmUrl: string | null;
  createdAt: string;
};

export type ForwardingSetup = {
  address: string;
  gmailFilterQuery: string;
  gmailSteps: string[];
  confirmations: ForwardingConfirmation[];
};

// ---- passwords / institutions ----

export type PdfPassword = {
  id: string;
  institution: string | null;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export type AccountKind = "credit_card" | "bank";

export type Institution = {
  key: string;
  name: string;
  country: "IN" | "US";
  kinds: AccountKind[];
  passwordHint: string | null;
};

// ---- documents ----

export type DocumentSource = "email" | "upload" | "share" | "whatsapp";
export type DocumentKind = "statement" | "alert" | "receipt" | "unknown";
export type DocumentStatus = "received" | "processing" | "parsed" | "needs_password" | "failed" | "ignored" | "pending_extraction";

export type Document = {
  id: string;
  source: DocumentSource;
  kind: DocumentKind;
  status: DocumentStatus;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  emailFrom: string | null;
  emailSubject: string | null;
  institution: string | null;
  institutionName: string | null;
  accountId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  statementTotal: number | null;
  extractedDebits: number | null;
  reconciled: boolean | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  extractedCredits?: number | null;
  /** closing − (opening ± what we read). Card: positive = charges we didn't read. */
  reconcileDifference?: number | null;
  dueDate?: string | null;
  minimumDue?: number | null;
  creditLimit?: number | null;
  txnCount: number;
  parser: string | null;
  error: string | null;
  hasOriginal: boolean;
  processedAt: string | null;
  createdAt: string;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

// ---- accounts / transactions ----

export type Account = {
  id: string;
  institution: string;
  institutionName: string;
  kind: AccountKind | "unknown";
  last4: string;
  label: string | null;
  currency: string;
  includeInNetWorth?: boolean;
  txnCount: number;
  lastTxnOn: string | null;
};

export type Direction = "debit" | "credit";

export type Transaction = {
  id: string;
  accountId: string | null;
  documentId: string | null;
  postedOn: string;
  descriptionRaw: string;
  merchant: string;
  category: CategoryKey;
  amount: number;
  direction: Direction;
  currency: string;
  sourceKind: "statement" | "alert" | "csv";
  categoryLocked: boolean;
  receiptId: string | null;
  tags?: string[];
  note?: string | null;
  hasSplit?: boolean;
  /** Household view only: whose transaction this is. */
  ownerId?: string;
};

export type SplitPart = { category: CategoryKey; amount: number };

export type TransactionDetail = Transaction & { receipt: ReceiptDetail | null; splits?: SplitPart[]; refund?: RefundWatch | null };

export type TransactionPatch = { category?: string; applyToMerchant?: boolean; tags?: string[]; note?: string | null };

export type CategoryRule = { id: string; merchant: string; category: CategoryKey; createdAt: string };

export type TransactionFilter = {
  from?: string;
  to?: string;
  category?: string;
  accountId?: string;
  q?: string;
  tag?: string;
  direction?: Direction | "";
  documentId?: string;
  scope?: "me" | "household";
  member?: string;
  limit?: number;
  cursor?: string | null;
};

export type CategoryInfo = { key: CategoryKey; label: string; essential: boolean; spend: boolean };

// ---- alerts ----

export type AlertKind =
  | "category_spike"
  | "daily_spike"
  | "large_new_merchant"
  | "price_hike"
  | "fee"
  | "duplicate"
  | "new_subscription"
  | "over_budget"
  | "card_due"
  | "return_window"
  | "warranty"
  | "refund_missing"
  | "trial_converted";

export type Alert = {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  category: CategoryKey | null;
  merchant: string | null;
  amount: number | null;
  baseline: number | null;
  periodStart: string | null;
  createdAt: string;
  dismissedAt: string | null;
};

// ---- dashboard ----

export type Dashboard = {
  month: string;
  currency: Currency;
  availableMonths: string[];
  totals: { spend: number; previousMonthSpend: number; avg3MonthSpend: number; income: number; txnCount: number };
  byCategory: Array<{ category: CategoryKey; label: string; amount: number; previous: number; avg3: number; share: number }>;
  byAccount: Array<{ accountId: string; label: string; amount: number }>;
  topMerchants: Array<{ merchant: string; category: CategoryKey; amount: number; count: number }>;
  daily: Array<{ date: string; amount: number }>;
  trend: Array<{ month: string; spend: number }>;
  recentAlerts: Alert[];
  /** All-time receipt counts + this month's receipt-backed spend by item category (absent on an older API). */
  receipts?: {
    total: number;
    matched: number;
    unmatched: number;
    pendingExtraction: number;
    itemized: { txnCount: number; amount: number; byCategory: Array<{ category: CategoryKey; label: string; amount: number }> };
  };
  scope?: "me" | "household";
  members?: Array<{ userId: string; displayName: string; isMe: boolean }>;
  safeToSpend?: SafeToSpend | null;
  budgets?: { count: number; over: number; near: number; top: BudgetLine[] } | null;
  netWorth?: { netWorth: number; assets: number; liabilities: number; asOf: string | null } | null;
  /** Unpaid cards due within 14 days or overdue ([] in household view; absent on an older API). */
  upcomingDues?: CardDue[];
};

export type SafeToSpend = {
  month: string;
  basis: "budget" | "category_budgets" | "income";
  base: number;
  spent: number;
  upcoming: number;
  upcomingItems: Array<{ merchant: string; amount: number; expectedOn: string }>;
  amount: number;
  daysLeft: number;
  perDay: number;
};

// ---- subscriptions / budgets / net worth / household ----

export type SubscriptionItem = {
  merchant: string;
  category: CategoryKey;
  cadence: "weekly" | "monthly" | "yearly";
  amount: number;
  monthlyAmount: number;
  annualCost: number;
  firstChargedOn: string;
  lastChargedOn: string;
  nextExpectedOn: string;
  occurrences: number;
  priceChanged: boolean;
  previousAmount: number | null;
  isNew: boolean;
  /** Official account/help page to cancel it, when we know the service. */
  cancel?: { name: string; url: string; note?: string } | null;
};

export type Subscriptions = { currency: Currency; monthlyTotal: number; yearlyTotal: number; items: SubscriptionItem[] };

export type BudgetLine = {
  category: CategoryKey;
  label: string;
  budget: number;
  spent: number;
  remaining: number;
  progress: number;
  status: "ok" | "near" | "over";
};

export type Budgets = {
  month: string;
  currency: Currency;
  monthlyBudget: number | null;
  totals: { budgeted: number; spent: number; spentInBudgeted: number };
  items: BudgetLine[];
  suggestions: Array<{ category: CategoryKey; label: string; suggested: number; average: number }>;
};

export type NetWorthItemType = "cash" | "investment" | "retirement" | "property" | "vehicle" | "loan" | "mortgage" | "credit_card" | "other";
export type NetWorthItem = { id: string; kind: "asset" | "liability"; type: NetWorthItemType; name: string; amount: number; updatedAt: string };

export type NetWorth = {
  currency: Currency;
  netWorth: number;
  assets: number;
  liabilities: number;
  hasData: boolean;
  asOf: string | null;
  accounts: Array<{
    accountId: string;
    label: string;
    kind: string;
    currency: string;
    includeInNetWorth: boolean;
    balance: number | null;
    asOf: string | null;
    side: "asset" | "liability" | null;
    counted: boolean;
  }>;
  items: NetWorthItem[];
};

export type Household = {
  id: string;
  name: string;
  role: "owner" | "member";
  members: Array<{ userId: string; displayName: string; email: string; role: string; joinedAt: string; isMe: boolean }>;
  invites: Array<{ id: string; email: string; expiresAt: string; createdAt: string }>;
};

export type InvitePreview = {
  valid: boolean;
  code: null | "invalid_or_expired_token" | "wrong_account" | "already_in_household";
  householdName?: string;
  invitedBy?: string | null;
  email?: string;
};

// ---- savings ----

export type FeeType = "late_fee" | "interest" | "forex" | "annual_fee" | "cash_advance" | "atm_fee" | "overlimit" | "overdraft" | "gst_on_fees" | "other";

export type Subscription = {
  merchant: string;
  category: CategoryKey;
  monthlyAmount: number;
  cadence: "monthly" | "yearly" | "weekly";
  lastChargedOn: string;
  occurrences: number;
  annualCost: number;
  priceChanged: boolean;
};

export type Savings = {
  estimatedMonthlySavings: number;
  subscriptions: Subscription[];
  fees: { totalLast12Months: number; items: Array<{ type: FeeType; label: string; amount: number; count: number }> };
  duplicates: Array<{ merchant: string; amount: number; dates: string[]; transactionIds: string[] }>;
  tips: Array<{
    id: string;
    kind: "subscription" | "fee" | "category" | "card" | "duplicate";
    title: string;
    body: string;
    monthlySaving: number;
  }>;
};

// ---- whatsapp / export ----

export type WhatsappLink = { code: string; expiresAt: string; number: string | null };

export type ExportData = { transactions: Transaction[]; accounts: Account[]; alerts: Alert[]; receipts: Array<Receipt & { items: ReceiptItem[] }>; [k: string]: unknown };

// ---- receipts ----

export type ReceiptStatus = "processing" | "pending_extraction" | "extracted" | "manual" | "failed";
export type ReceiptMatchStatus = "unmatched" | "auto" | "confirmed";

export type Receipt = {
  id: string;
  documentId: string;
  status: ReceiptStatus;
  merchant: string | null;
  purchasedOn: string | null;
  total: number | null;
  tax: number | null;
  currency: string;
  itemCount: number;
  itemsReconciled: boolean | null;
  parser: string | null;
  error: string | null;
  source: DocumentSource;
  filename: string | null;
  mimeType: string;
  hasImage: boolean;
  transactionId: string | null;
  matchStatus: ReceiptMatchStatus;
  matchedAt: string | null;
  returnDays?: number | null;
  warrantyUntil?: string | null;
  createdAt: string;
};

export type ReceiptItem = {
  id: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  category: CategoryKey;
  categoryLocked: boolean;
  tags?: string[];
  /** Looks HSA/FSA-eligible (a hint, not advice). Detail view only. */
  hsaSuggested?: boolean;
};

export type ReturnWindow = {
  source: "typical" | "custom" | null;
  policyName: string | null;
  days: number | null;
  note: string | null;
  closesOn: string | null;
  daysLeft: number | null;
  open: boolean;
};

export type ReceiptDetail = Receipt & { items: ReceiptItem[]; transaction: Transaction | null; returnWindow?: ReturnWindow; refund?: RefundWatch | null };

export type ReceiptPatch = {
  merchant?: string | null;
  purchasedOn?: string | null;
  total?: number;
  tax?: number | null;
  currency?: Currency;
  returnDays?: number | null;
  warrantyUntil?: string | null;
};

// ---- 0003: cards, refunds, prices, goals, Ask ----

export type CardDueStatus = "paid" | "overdue" | "due_soon" | "upcoming" | "nothing_due" | "unknown";

export type CardDue = {
  accountId: string;
  label: string;
  currency: string;
  documentId: string;
  statementBalance: number | null;
  minimumDue: number | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  creditLimit: number | null;
  /** balance / limit, 0..n */
  utilization: number | null;
  paidSinceStatement: number;
  status: CardDueStatus;
};

export type RefundWatch = {
  id: string;
  transactionId: string | null;
  receiptId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  returnedOn: string;
  status: "waiting" | "overdue" | "refunded" | "closed";
  refundTransactionId: string | null;
  refundedOn: string | null;
  refundAmount: number | null;
  createdAt: string;
};

export type PriceTrack = {
  key: string;
  name: string;
  currency: string;
  points: Array<{ date: string; unitPrice: number; merchant: string | null; receiptId: string }>;
  firstPrice: number;
  latestPrice: number;
  changePct: number;
  since: string;
  latestOn: string;
  minPrice: number;
  maxPrice: number;
  headline: string;
};

export type ReturnsOverview = {
  returnWindows: Array<{ receiptId: string; merchant: string | null; purchasedOn: string | null; total: number | null; currency: string; window: ReturnWindow }>;
  warranties: Array<{ receiptId: string; merchant: string | null; purchasedOn: string | null; total: number | null; currency: string; warrantyUntil: string }>;
  refunds: RefundWatch[];
  policies: Array<{ key: string; name: string; days: number; note: string | null }>;
};

export type GoalStatus = "done" | "on_track" | "behind" | "overdue" | "no_date";

export type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  currency: string;
  createdAt: string;
  progress: {
    saved: number;
    remaining: number;
    progress: number;
    monthsLeft: number | null;
    monthlyNeeded: number | null;
    recentMonthlyPace: number;
    status: GoalStatus;
  };
  contributions: Array<{ id: string; amount: number; contributedOn: string; note: string | null; createdAt: string }>;
};

export type AskTurn = { role: "user" | "assistant"; text: string };
export type AskAnswer = { answer: string; toolsUsed: string[]; usage: { used: number; limit: number } };
export type AskUsage = { available: boolean; used: number; limit: number };

export const TAX_TAGS = [
  { tag: "tax-deductible", label: "Tax deductible" },
  { tag: "business", label: "Business" },
  { tag: "hsa-fsa", label: "HSA/FSA eligible" },
] as const;
