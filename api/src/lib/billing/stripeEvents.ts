// Stripe webhook: signature check + event → plan update. Pure module (no
// env/db) so both are unit-tested; routes/billing.ts applies the result.
//
// The 3PandaLabs Stripe account is shared by every app, so an endpoint sees
// other apps' events too. Ours carry metadata app=spendvault (Checkout session
// and subscription_data); anything else is answered 200 and ignored (an error
// makes Stripe retry for days and then disable the endpoint).
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_APP = "spendvault";

/** sk_test_ / rk_test_ always; live keys only with STRIPE_ALLOW_LIVE=true. */
export function keyAllowed(key: string, allowLive: boolean): boolean {
  if (/^(sk|rk)_test_/.test(key)) return true;
  return allowLive && /^(sk|rk)_live_/.test(key);
}

/** Stripe's default replay window. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifies `Stripe-Signature` (`t=<ts>,v1=<hex>[,v1=<hex>]`) over the EXACT raw
 * body: HMAC-SHA256(secret, `${t}.${body}`). Any v1 may match (secret rotation).
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSeconds = Date.now() / 1000): boolean {
  if (!header || !secret) return false;
  let t: string | undefined;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

type Meta = Record<string, string> | null | undefined;
type StripeObject = {
  id?: string;
  object?: string;
  mode?: string;
  status?: string;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  client_reference_id?: string | null;
  metadata?: Meta;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number; price?: { id?: string; recurring?: { interval?: string } | null } }> };
};
export type StripeEvent = { id?: string; type?: string; created?: number; data?: { object?: StripeObject } };

export type PlanUpdate = {
  /** Our user id from metadata (or client_reference_id); null → look up by customer id. */
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  plan: "free" | "plus";
  status: string;
  interval: "month" | "year" | null;
  renewsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  eventAt: Date;
};

export type Reduced = { kind: "ignore"; reason: string } | { kind: "update"; update: PlanUpdate };

const idOf = (v: string | { id?: string } | null | undefined): string | null => (typeof v === "string" ? v : v?.id ?? null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const userIdFrom = (o: StripeObject): string | null => {
  const id = o.metadata?.user_id ?? o.client_reference_id ?? null;
  return id && UUID.test(id) ? id : null;
};

/** Statuses that mean "paying (or about to)": plan stays/turns plus. */
const PLUS = new Set(["active", "trialing", "past_due"]);

export const HANDLED_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const;

/** One verified event → what to write, or why it is ignored. */
export function reduceStripeEvent(e: StripeEvent): Reduced {
  const o = e.data?.object;
  if (!e.id || !e.type || !o) return { kind: "ignore", reason: "malformed" };
  if (!(HANDLED_EVENTS as readonly string[]).includes(e.type)) return { kind: "ignore", reason: "unhandled_type" };
  if (o.metadata?.app !== STRIPE_APP) return { kind: "ignore", reason: "other_app" };
  const eventAt = new Date((e.created ?? 0) * 1000);

  if (e.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return { kind: "ignore", reason: "not_subscription" };
    return {
      kind: "update",
      update: {
        userId: userIdFrom(o),
        customerId: idOf(o.customer),
        subscriptionId: idOf(o.subscription),
        // Checkout only completes once the first payment (or trial) is set up.
        plan: "plus",
        status: "active",
        interval: null,
        renewsAt: null,
        cancelAtPeriodEnd: false,
        eventAt,
      },
    };
  }

  // customer.subscription.*
  const item = o.items?.data?.[0];
  const periodEnd = o.current_period_end ?? item?.current_period_end ?? null;
  const rawInterval = item?.price?.recurring?.interval;
  const status = e.type === "customer.subscription.deleted" ? "canceled" : (o.status ?? "incomplete");
  return {
    kind: "update",
    update: {
      userId: userIdFrom(o),
      customerId: idOf(o.customer),
      subscriptionId: o.id ?? null,
      plan: PLUS.has(status) ? "plus" : "free",
      status,
      interval: rawInterval === "month" || rawInterval === "year" ? rawInterval : null,
      renewsAt: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
      eventAt,
    },
  };
}
