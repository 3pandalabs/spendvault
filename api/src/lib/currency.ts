// Base-currency helpers. Pure module (no env/db).

export const BASE_CURRENCIES = ["USD", "INR"] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

/** New sign-ups default to USD (US-first). Existing rows keep whatever they have. */
export const DEFAULT_BASE_CURRENCY: BaseCurrency = "USD";

/** The value stored for a new user: what the client asked for, else the default. */
export const signupBaseCurrency = (requested?: BaseCurrency | null): BaseCurrency => requested ?? DEFAULT_BASE_CURRENCY;

/**
 * The user's home market, used only when a document's institution is unknown:
 * it picks the date-order tie-break (MM/DD vs DD/MM) and the currency fallback.
 */
export const homeCountryOf = (currency: string | null | undefined): "IN" | "US" => (currency === "USD" ? "US" : "IN");
