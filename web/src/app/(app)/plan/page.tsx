"use client";

import { Check, CreditCard, ExternalLink, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ACCOUNT_TABS, Eyebrow, SubTabs } from "@/components/app-ui";
import { ErrorText, Loading, PageHeader, Panel, PanelTitle, Skeleton, Spinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage, getBillingPlans, openBillingPortal, startCheckout } from "@/lib/api";
import { fmtDate, moneyExact } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { BillingPlans } from "@/lib/types";

export default function PlanPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Plan />
    </Suspense>
  );
}

function Plan() {
  const { me, refresh } = useSession();
  const status = useSearchParams().get("status");
  const plans = useAsync(getBillingPlans, "billing-plans");
  // Back from Stripe Checkout: the webhook may land a moment after the redirect.
  useEffect(() => {
    if (status !== "success") return;
    const t = window.setTimeout(refresh, 2500);
    return () => window.clearTimeout(t);
  }, [status, refresh]);

  return (
    <>
      <PageHeader eyebrow="Account" title="Plan" subtitle="SpendVault is free for the core. SpendVault Plus adds the extras." />
      <SubTabs label="Account" items={ACCOUNT_TABS} />
      {status === "success" ? <p className="spa-in mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">Thanks! Your payment went through. Plus turns on in a moment.</p> : null}
      {status === "cancelled" ? <p className="spa-in mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-fg-muted">No charge made. You can upgrade any time.</p> : null}
      {plans.error ? <ErrorText>{errorMessage(plans.error)}</ErrorText> : !plans.data ? <Skeleton className="h-64 rounded-2xl" /> : <Body plans={plans.data} />}
      <p className="mt-6 text-xs text-fg-muted">
        Payments are handled by Stripe; we never see your card number. Cancel any time from &ldquo;Manage subscription&rdquo;: Plus stays on until the end of the period you paid for. Your data and exports stay
        available on Free.
      </p>
      <p className="mt-2 text-xs text-fg-muted">{me.email}</p>
    </>
  );
}

function Body({ plans }: { plans: BillingPlans }) {
  const { me } = useSession();
  const billing = me.billing;
  const isPlus = me.plan === "plus";
  const cur = me.baseCurrency === "INR" ? "INR" : "USD";
  const price = plans.prices[cur];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(key: string, fn: () => Promise<{ url: string }>) {
    setBusy(key);
    setError(null);
    try {
      window.location.assign((await fn()).url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const yearlySaving = Math.max(0, price.month * 12 - price.year);
  const fmt = (n: number) => moneyExact(n, cur).replace(/\.00$/, "");

  if (!plans.enabled || !billing?.enabled) {
    return (
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <Eyebrow>Early access</Eyebrow>
        <p className="spa-display mt-2 text-2xl font-bold">Everything is included</p>
        <p className="mt-2 max-w-xl text-sm text-fg-muted">
          While SpendVault is in early access, every feature is on for everyone, Plus features included. If that changes we&apos;ll tell you first, and nothing is ever charged without you choosing it.
        </p>
        <Features plans={plans} />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>Your plan</Eyebrow>
          {isPlus ? <Badge variant="good">Plus</Badge> : <Badge>Free</Badge>}
          {billing.status === "past_due" ? <Badge variant="warn">Payment failed, retrying</Badge> : null}
        </div>
        <p className="spa-display mt-2 text-2xl font-bold">{isPlus ? "SpendVault Plus" : "SpendVault Free"}</p>
        {isPlus && billing.renewsAt ? (
          <p className="mt-1 text-sm text-fg-muted">
            {billing.cancelAtPeriodEnd ? "Ends" : "Renews"} {fmtDate(billing.renewsAt.slice(0, 10))}
            {billing.interval ? ` · billed ${billing.interval === "year" ? "yearly" : "monthly"}` : ""}
          </p>
        ) : null}
        {!isPlus ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="lg" disabled={busy !== null} onClick={() => go("year", () => startCheckout("year"))}>
              {busy === "year" ? <Spinner /> : <Sparkles />} {fmt(price.year)} / year
            </Button>
            <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => go("month", () => startCheckout("month"))}>
              {busy === "month" ? <Spinner /> : null} {fmt(price.month)} / month
            </Button>
          </div>
        ) : null}
        {!isPlus && yearlySaving > 0 ? <p className="mt-2 text-xs text-fg-muted">Yearly saves {fmt(yearlySaving)} compared with paying monthly.</p> : null}
        {billing.hasCustomer ? (
          <Button className="mt-4" variant="outline" disabled={busy !== null} onClick={() => go("portal", openBillingPortal)}>
            {busy === "portal" ? <Spinner /> : <CreditCard />} Manage subscription <ExternalLink className="opacity-60" />
          </Button>
        ) : null}
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </section>
      <Panel className="spa-in">
        <PanelTitle>What you get</PanelTitle>
        <Features plans={plans} />
      </Panel>
    </div>
  );
}

function Features({ plans }: { plans: BillingPlans }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-semibold">Free, always</p>
        <ul className="space-y-1.5 text-sm text-fg-muted">
          {plans.freeCore.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden /> {f}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Plus adds</p>
        <ul className="space-y-1.5 text-sm text-fg-muted">
          {plans.features.map((f) => (
            <li key={f.key} className="flex gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden /> {f.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
