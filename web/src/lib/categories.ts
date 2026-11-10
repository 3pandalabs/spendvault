import type { CategoryKey } from "./types";

// One colour per category, used everywhere (bars, dots, chips). Labels mirror
// api/src/lib/categories.ts. Tuned for the dark (AdVault) chrome: mostly
// Tailwind 300–500 hues so they sit beside AdVault's amber/violet, every one
// ≥3.9:1 against zinc-950 so a bar or dot reads as a graphic on its own, and
// minimum pairwise CIELAB ΔE ≈ 15 (the closest pairs are the grey non-spend
// categories). Text always sits beside a colour in --fg, never on it.
export const CATEGORY_META: Record<CategoryKey, { label: string; color: string }> = {
  food_delivery: { label: "Food delivery", color: "#fb923c" },
  dining: { label: "Restaurants & cafes", color: "#fcd34d" },
  groceries: { label: "Groceries", color: "#4ade80" },
  shopping: { label: "Shopping", color: "#f472b6" },
  fuel: { label: "Fuel", color: "#b45309" },
  transport: { label: "Cabs & transport", color: "#38bdf8" },
  travel: { label: "Travel & hotels", color: "#22d3ee" },
  utilities: { label: "Bills & utilities", color: "#6366f1" },
  telecom: { label: "Mobile & internet", color: "#60a5fa" },
  subscriptions: { label: "Subscriptions", color: "#a78bfa" },
  entertainment: { label: "Entertainment", color: "#f0abfc" },
  health: { label: "Health & pharmacy", color: "#fb7185" },
  education: { label: "Education", color: "#fef08a" },
  rent: { label: "Rent & housing", color: "#c026d3" },
  insurance: { label: "Insurance", color: "#2dd4bf" },
  investments: { label: "Investments", color: "#059669" },
  emi_loans: { label: "EMI & loans", color: "#a3e635" },
  fees_charges: { label: "Fees, interest & charges", color: "#ef4444" },
  cash: { label: "Cash withdrawal", color: "#e7e5e4" },
  transfers: { label: "Transfers (UPI/NEFT)", color: "#94a3b8" },
  card_payment: { label: "Card bill payment", color: "#71717a" },
  income: { label: "Income & refunds", color: "#bbf7d0" },
  other: { label: "Other", color: "#a8a29e" },
};

/** Per-account bars on the dashboard: AdVault amber + violet first, then distinct hues. */
export const ACCOUNT_COLORS = ["#fbbf24", "#a78bfa", "#38bdf8", "#f472b6", "#34d399", "#fb923c"];

export const CATEGORY_KEYS = Object.keys(CATEGORY_META) as CategoryKey[];

export const categoryColor = (k: string | null | undefined) =>
  (k && CATEGORY_META[k as CategoryKey]?.color) || CATEGORY_META.other.color;
export const categoryLabel = (k: string | null | undefined) =>
  (k && CATEGORY_META[k as CategoryKey]?.label) || (k ?? "Other");
