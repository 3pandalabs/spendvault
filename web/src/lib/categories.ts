import type { CategoryKey } from "./types";

// One colour per category, used everywhere (bars, dots, chips). Mirrors
// api/src/lib/categories.ts. Each colour is ≥3:1 against white so a bar or dot
// reads as a graphic on its own; text always sits beside it in --fg, never on it.
export const CATEGORY_META: Record<CategoryKey, { label: string; color: string }> = {
  food_delivery: { label: "Food delivery", color: "#e8590c" },
  dining: { label: "Restaurants & cafes", color: "#c2410c" },
  groceries: { label: "Groceries", color: "#2f9e44" },
  shopping: { label: "Shopping", color: "#d6336c" },
  fuel: { label: "Fuel", color: "#a6620b" },
  transport: { label: "Cabs & transport", color: "#1c7ed6" },
  travel: { label: "Travel & hotels", color: "#0c8599" },
  utilities: { label: "Bills & utilities", color: "#5c7cfa" },
  telecom: { label: "Mobile & internet", color: "#4263eb" },
  subscriptions: { label: "Subscriptions", color: "#9c36b5" },
  entertainment: { label: "Entertainment", color: "#ae3ec9" },
  health: { label: "Health & pharmacy", color: "#e03131" },
  education: { label: "Education", color: "#1971c2" },
  rent: { label: "Rent & housing", color: "#6741d9" },
  insurance: { label: "Insurance", color: "#087f5b" },
  investments: { label: "Investments", color: "#2b8a3e" },
  emi_loans: { label: "EMI & loans", color: "#862e9c" },
  fees_charges: { label: "Fees, interest & charges", color: "#c92a2a" },
  cash: { label: "Cash withdrawal", color: "#5f6f52" },
  transfers: { label: "Transfers (UPI/NEFT)", color: "#64748b" },
  card_payment: { label: "Card bill payment", color: "#71717a" },
  income: { label: "Income & refunds", color: "#2b9348" },
  other: { label: "Other", color: "#78716c" },
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_META) as CategoryKey[];

export const categoryColor = (k: string | null | undefined) =>
  (k && CATEGORY_META[k as CategoryKey]?.color) || CATEGORY_META.other.color;
export const categoryLabel = (k: string | null | undefined) =>
  (k && CATEGORY_META[k as CategoryKey]?.label) || (k ?? "Other");
