import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyAllowed, reduceStripeEvent, STRIPE_APP, verifyStripeSignature } from "../../src/lib/billing/stripeEvents.js";
import { billingFlag, effectivePlan, FEATURE_PLANS, featureMap, FREE_LIMITS, hasFeature, limitsFor, PLUS_FEATURES, PLUS_PRICES, priceCurrencyFor } from "../../src/lib/plan.js";

const NOW = new Date("2026-11-27T12:00:00Z");
const free = { plan: "free", planStatus: null, planRenewsAt: null };
const plus = (status: string, renews = "2026-12-27T00:00:00Z") => ({ plan: "plus", planStatus: status, planRenewsAt: new Date(renews) });

describe("plan: the free / Plus split", () => {
  it("BILLING defaults to off and only on/true/1 switch it on", () => {
    expect(billingFlag(undefined)).toBe(false);
    expect(billingFlag("")).toBe(false);
    expect(billingFlag("off")).toBe(false);
    expect(billingFlag("false")).toBe(false);
    expect(billingFlag("on")).toBe(true);
    expect(billingFlag(" ON ")).toBe(true);
    expect(billingFlag("true")).toBe(true);
    expect(billingFlag("1")).toBe(true);
  });

  it("billing off: everyone is effectively Plus, nothing is limited", () => {
    expect(effectivePlan(free, false, NOW)).toBe("plus");
    for (const f of PLUS_FEATURES) expect(hasFeature(effectivePlan(free, false, NOW), f)).toBe(true);
  });

  it("billing on: free users get the core, Plus users everything", () => {
    expect(effectivePlan(free, true, NOW)).toBe("free");
    expect(featureMap("free")).toEqual({ ask: false, household: false, digests: false, unlimited_budgets: false, unlimited_goals: false, tax_export: false, price_tracker: false });
    expect(Object.values(featureMap("plus")).every(Boolean)).toBe(true);
    expect(limitsFor("free")).toEqual(FREE_LIMITS);
    expect(limitsFor("plus").budgets).toBeNull();
  });

  it("active, trialing and past_due keep Plus; canceled, unpaid and incomplete don't", () => {
    for (const s of ["active", "trialing", "past_due"]) expect(effectivePlan(plus(s), true, NOW)).toBe("plus");
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired"]) expect(effectivePlan(plus(s), true, NOW)).toBe("free");
  });

  it("a missed renewal webhook lapses Plus 3 days after the period end", () => {
    expect(effectivePlan(plus("active", "2026-11-25T00:00:00Z"), true, NOW)).toBe("plus");
    expect(effectivePlan(plus("active", "2026-11-23T00:00:00Z"), true, NOW)).toBe("free");
  });

  it("every Plus feature is listed once; export of your data is not one of them", () => {
    expect(Object.keys(FEATURE_PLANS).sort()).toEqual([...PLUS_FEATURES].sort());
    expect(PLUS_FEATURES as readonly string[]).not.toContain("export");
  });

  it("prices: US $3/$29, India ₹79/₹599; INR users see India prices", () => {
    expect(PLUS_PRICES).toEqual({ USD: { month: 3, year: 29 }, INR: { month: 79, year: 599 } });
    expect(priceCurrencyFor("INR")).toBe("INR");
    expect(priceCurrencyFor("USD")).toBe("USD");
    expect(priceCurrencyFor("EUR")).toBe("USD");
  });
});

describe("Stripe: keys, signatures, events", () => {
  const secret = "whsec_test_secret";
  const sign = (body: string, t: number, s = secret) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`;
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_800_000_000;

  it("test-mode keys only, unless live is explicitly allowed", () => {
    expect(keyAllowed("sk_test_abc", false)).toBe(true);
    expect(keyAllowed("rk_test_abc", false)).toBe(true);
    expect(keyAllowed("sk_live_abc", false)).toBe(false);
    expect(keyAllowed("sk_live_abc", true)).toBe(true);
    expect(keyAllowed("pk_test_abc", true)).toBe(false);
  });

  it("accepts a valid signature, also as the second v1 during a secret rotation", () => {
    expect(verifyStripeSignature(body, sign(body, now), secret, now)).toBe(true);
    const rotated = `${sign(body, now, "whsec_old").split(",")[0]},v1=deadbeef,${sign(body, now).split(",")[1]}`;
    expect(verifyStripeSignature(body, rotated, secret, now)).toBe(true);
  });

  it("rejects a wrong secret, a changed body, a stale timestamp and junk headers", () => {
    expect(verifyStripeSignature(body, sign(body, now, "whsec_other"), secret, now)).toBe(false);
    expect(verifyStripeSignature(`${body} `, sign(body, now), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, "garbage", secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), "", now)).toBe(false);
  });

  const uid = "11111111-2222-4333-8444-555555555555";
  const meta = { app: STRIPE_APP, user_id: uid };

  it("ignores other apps' events, unhandled types and one-off payments", () => {
    expect(reduceStripeEvent({ id: "e", type: "checkout.session.completed", created: 1, data: { object: { mode: "subscription", metadata: { app: "advault" } } } })).toEqual({ kind: "ignore", reason: "other_app" });
    expect(reduceStripeEvent({ id: "e", type: "invoice.paid", created: 1, data: { object: { metadata: meta } } })).toEqual({ kind: "ignore", reason: "unhandled_type" });
    expect(reduceStripeEvent({ id: "e", type: "checkout.session.completed", created: 1, data: { object: { mode: "payment", metadata: meta } } })).toEqual({ kind: "ignore", reason: "not_subscription" });
    expect(reduceStripeEvent({ type: "checkout.session.completed" })).toEqual({ kind: "ignore", reason: "malformed" });
  });

  it("checkout.session.completed → Plus, linking the customer and subscription", () => {
    const r = reduceStripeEvent({
      id: "evt_c",
      type: "checkout.session.completed",
      created: 1_800_000_000,
      data: { object: { mode: "subscription", customer: "cus_1", subscription: "sub_1", client_reference_id: uid, metadata: meta } },
    });
    expect(r).toMatchObject({ kind: "update", update: { userId: uid, customerId: "cus_1", subscriptionId: "sub_1", plan: "plus", status: "active" } });
  });

  it("subscription updated/deleted carry status, interval and period end (old and new API shapes)", () => {
    const updated = reduceStripeEvent({
      id: "evt_u",
      type: "customer.subscription.updated",
      created: 1_800_000_100,
      data: { object: { id: "sub_1", customer: "cus_1", status: "past_due", cancel_at_period_end: true, metadata: meta, items: { data: [{ current_period_end: 1_802_000_000, price: { id: "price_x", recurring: { interval: "year" } } }] } } },
    });
    expect(updated).toMatchObject({ kind: "update", update: { plan: "plus", status: "past_due", interval: "year", cancelAtPeriodEnd: true, renewsAt: new Date(1_802_000_000_000), eventAt: new Date(1_800_000_100_000) } });
    const legacy = reduceStripeEvent({ id: "evt_l", type: "customer.subscription.created", created: 5, data: { object: { id: "sub_1", status: "incomplete", current_period_end: 9, metadata: meta } } });
    expect(legacy).toMatchObject({ kind: "update", update: { plan: "free", status: "incomplete", renewsAt: new Date(9000) } });
    const deleted = reduceStripeEvent({ id: "evt_d", type: "customer.subscription.deleted", created: 6, data: { object: { id: "sub_1", status: "active", metadata: meta } } });
    expect(deleted).toMatchObject({ kind: "update", update: { plan: "free", status: "canceled" } });
  });

  it("a non-uuid user id in metadata is never trusted", () => {
    const r = reduceStripeEvent({ id: "e", type: "customer.subscription.updated", created: 1, data: { object: { id: "sub", customer: "cus", status: "active", metadata: { app: STRIPE_APP, user_id: "1 OR 1=1" } } } });
    expect(r).toMatchObject({ kind: "update", update: { userId: null, customerId: "cus" } });
  });
});
