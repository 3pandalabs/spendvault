// SpendVault Plus: the free / Plus split in ONE place. Pure module (no env/db).
//
// BILLING=off (the default) → everyone is effectively on Plus and nothing is
// limited. BILLING=on → `effectivePlan()` reads the user's Stripe-driven plan
// columns (0004) and routes gate on `hasFeature()` / `FREE_LIMITS`.
//
// Free keeps the core forever: forwarding, uploads, categories, the dashboard,
// alerts and reminders, receipts, budgets (up to FREE_LIMITS.budgets), a goal,
// manual cash spends, rollover, calculators, and every data export except the
// tax CSV. "Your data is yours": the JSON export, transactions CSV and receipt
// items CSV are never paywalled.

export const PLANS = ["free", "plus"] as const;
export type Plan = (typeof PLANS)[number];

export const PLUS_FEATURES = ["ask", "household", "digests", "unlimited_budgets", "unlimited_goals", "tax_export", "price_tracker"] as const;
export type PlusFeature = (typeof PLUS_FEATURES)[number];

/** The split. `plus` = needs SpendVault Plus when billing is on. */
export const FEATURE_PLANS: Record<PlusFeature, { plan: Plan; label: string }> = {
  ask: { plan: "plus", label: "Ask SpendVault (questions about your spending)" },
  household: { plan: "plus", label: "Household: share a combined view with a partner" },
  digests: { plan: "plus", label: "Weekly and monthly summary emails" },
  unlimited_budgets: { plan: "plus", label: "Unlimited category budgets" },
  unlimited_goals: { plan: "plus", label: "Unlimited savings goals" },
  tax_export: { plan: "plus", label: "Tax CSV export" },
  price_tracker: { plan: "plus", label: "Item price tracker" },
};

/** What Free keeps (copy for the Plan page; never gated). */
export const FREE_CORE = [
  "Statement forwarding, uploads and WhatsApp",
  "Automatic categories and your own rules",
  "Overview dashboard, net worth and safe to spend",
  "Alerts and reminders (card dues, returns, refunds, trials)",
  "Receipts with line items",
  "Cash spends you add by hand",
  "Up to 3 category budgets with rollover, plus an overall budget",
  "1 savings goal",
  "All calculators",
  "Full data export (JSON and CSV), always",
] as const;

/** Free-plan caps when billing is on. null = unlimited. */
export const FREE_LIMITS = { budgets: 3, goals: 1 } as const;
export const PLUS_LIMITS = { budgets: null, goals: 20 } as const;

/**
 * Display prices. MUST match the Stripe prices whose ids are in
 * STRIPE_PRICE_{USD,INR}_{MONTH,YEAR}; Stripe charges what the price says.
 */
export const PLUS_PRICES = {
  USD: { month: 3, year: 29 },
  INR: { month: 79, year: 599 },
} as const;
export type PriceCurrency = keyof typeof PLUS_PRICES;
export const INTERVALS = ["month", "year"] as const;
export type Interval = (typeof INTERVALS)[number];

/** BILLING env value → on/off. Only "on" / "true" / "1" switch it on. */
export const billingFlag = (v: string | undefined | null): boolean => ["on", "true", "1"].includes((v ?? "").trim().toLowerCase());

/** Stripe statuses that keep Plus on. past_due keeps it during Stripe's retry window. */
const PLUS_STATUSES = new Set(["active", "trialing", "past_due"]);

export type PlanFields = { plan: string; planStatus: string | null; planRenewsAt: Date | null };

export function effectivePlan(u: PlanFields, billingOn: boolean, now: Date = new Date()): Plan {
  if (!billingOn) return "plus";
  if (u.plan !== "plus") return "free";
  if (!u.planStatus || !PLUS_STATUSES.has(u.planStatus)) return "free";
  // A missed renewal webhook must not mean Plus forever: 3 days past the period end, it lapses.
  if (u.planRenewsAt && u.planRenewsAt.getTime() + 3 * 86_400_000 < now.getTime()) return "free";
  return "plus";
}

export const hasFeature = (plan: Plan, f: PlusFeature): boolean => plan === "plus" || FEATURE_PLANS[f].plan === "free";

export const limitsFor = (plan: Plan) => (plan === "plus" ? PLUS_LIMITS : FREE_LIMITS);

/** The `features` map in GET /me and GET /billing. */
export const featureMap = (plan: Plan): Record<PlusFeature, boolean> =>
  Object.fromEntries(PLUS_FEATURES.map((f) => [f, hasFeature(plan, f)])) as Record<PlusFeature, boolean>;

/** Which price list a user sees: INR users get the India prices, everyone else USD. */
export const priceCurrencyFor = (baseCurrency: string): PriceCurrency => (baseCurrency === "INR" ? "INR" : "USD");

/** "plus_required" body for a gated route (HTTP 402). */
export const plusRequired = (feature: PlusFeature) => ({ error: "plus_required", code: "PLUS_REQUIRED", feature });
