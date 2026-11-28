// Stripe REST client for SpendVault Plus (Checkout subscriptions + Customer
// Portal). fetch + form encoding, no SDK, same as AdVault. Keys come from env
// only; TEST-mode keys are required unless STRIPE_ALLOW_LIVE=true.
import { env } from "../../env.js";
import type { Interval, PriceCurrency } from "../plan.js";
import { keyAllowed, STRIPE_APP } from "./stripeEvents.js";

const API = "https://api.stripe.com/v1";


export function priceIdFor(currency: PriceCurrency, interval: Interval): string {
  const map: Record<PriceCurrency, Record<Interval, string>> = {
    USD: { month: env.STRIPE_PRICE_USD_MONTH, year: env.STRIPE_PRICE_USD_YEAR },
    INR: { month: env.STRIPE_PRICE_INR_MONTH, year: env.STRIPE_PRICE_INR_YEAR },
  };
  return map[currency][interval];
}

/** Checkout can run: a usable secret key and the webhook secret are set. */
export const stripeConfigured = () => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && keyAllowed(env.STRIPE_SECRET_KEY, env.STRIPE_ALLOW_LIVE));

async function post<T>(path: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!res.ok) {
    // Status only: Stripe error bodies can echo the customer email.
    throw new Error(`stripe_${path.replace(/\W+/g, "_")}_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function createCheckoutSession(o: {
  userId: string;
  email: string;
  customerId: string | null;
  priceId: string;
  returnUrl: string;
}): Promise<{ id: string; url: string }> {
  return post("/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": o.priceId,
    "line_items[0][quantity]": "1",
    success_url: `${o.returnUrl}?status=success`,
    cancel_url: `${o.returnUrl}?status=cancelled`,
    client_reference_id: o.userId,
    ...(o.customerId ? { customer: o.customerId } : { customer_email: o.email }),
    allow_promotion_codes: "true",
    // Shared Stripe account: the app tag routes events (stripeEvents.ts).
    "metadata[app]": STRIPE_APP,
    "metadata[user_id]": o.userId,
    "subscription_data[metadata][app]": STRIPE_APP,
    "subscription_data[metadata][user_id]": o.userId,
  });
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  return post("/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}

/** Account deletion: stop charging at once. */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const res = await fetch(`${API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`stripe_cancel_${res.status}`);
}
