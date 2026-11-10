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
  createdAt: string;
};

export type AuthResponse = { accessToken: string; refreshToken: string; user: User };

export type Me = User & {
  forwardingAddress: string;
  whatsapp: { available: boolean; linkedPhone: string | null; number: string | null };
  setup: { hasDocuments: boolean; hasPasswords: boolean; forwardingConfirmed: boolean };
  llmEnabled: boolean;
};

export type MePatch = {
  displayName?: string;
  alertEmails?: boolean;
  deleteOriginals?: boolean;
  baseCurrency?: Currency;
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
export type DocumentKind = "statement" | "alert" | "unknown";
export type DocumentStatus = "received" | "processing" | "parsed" | "needs_password" | "failed" | "ignored";

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
};

export type TransactionFilter = {
  from?: string;
  to?: string;
  category?: string;
  accountId?: string;
  q?: string;
  direction?: Direction | "";
  limit?: number;
  cursor?: string | null;
};

export type CategoryInfo = { key: CategoryKey; label: string; essential: boolean; spend: boolean };

// ---- alerts ----

export type AlertKind = "category_spike" | "daily_spike" | "large_new_merchant" | "price_hike" | "fee" | "duplicate";

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
};

// ---- savings ----

export type FeeType = "late_fee" | "interest" | "forex" | "annual_fee" | "cash_advance" | "gst_on_fees" | "other";

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

export type ExportData = { transactions: Transaction[]; accounts: Account[]; alerts: Alert[] };
