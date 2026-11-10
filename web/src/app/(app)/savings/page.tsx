"use client";

import { Copy, Lightbulb, PiggyBank, Receipt, Repeat } from "lucide-react";
import Link from "next/link";
import { CategoryChip } from "@/components/bits";
import { EmptyState, LoadError, PageHeader, Panel, PanelTitle, Skeleton } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSavings } from "@/lib/api";
import { fmtDate, money } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Savings } from "@/lib/types";

const CADENCE: Record<string, string> = { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly" };

export default function SavingsPage() {
  const savings = useAsync(getSavings, "savings");
  const s = savings.data;
  return (
    <>
      <PageHeader title="Savings" subtitle="Subscriptions, fees and habits worth a second look." />
      {savings.error ? (
        <LoadError error={savings.error} onRetry={savings.reload} />
      ) : !s ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <SavingsBody s={s} />
      )}
    </>
  );
}

function SavingsBody({ s }: { s: Savings }) {
  const { me } = useSession();
  const cur = me.baseCurrency;
  const nothing = s.tips.length === 0 && s.subscriptions.length === 0 && s.fees.items.length === 0 && s.duplicates.length === 0;
  if (nothing) {
    return (
      <EmptyState
        icon={<PiggyBank />}
        title="Nothing to suggest yet"
        body="We need a couple of months of statements to spot subscriptions, fees and patterns. Add older statements to get suggestions sooner."
        action={
          <Link href="/documents">
            <Button>Add statements</Button>
          </Link>
        }
      />
    );
  }
  const subsAnnual = s.subscriptions.reduce((n, x) => n + x.annualCost, 0);
  return (
    <div className="space-y-4">
      <Panel className="bg-gradient-to-br from-accent to-indigo-800 text-white">
        <p className="text-sm text-white/80">You could save about</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight tabular">
          {money(s.estimatedMonthlySavings, cur)}
          <span className="text-lg font-normal text-white/80"> / month</span>
        </p>
        <p className="mt-1 text-sm text-white/80">
          That&apos;s {money(s.estimatedMonthlySavings * 12, cur)} a year, if you act on the suggestions below.
        </p>
      </Panel>

      {s.tips.length > 0 ? (
        <Panel>
          <PanelTitle>Suggestions</PanelTitle>
          <ul className="divide-y divide-line">
            {s.tips.map((t) => (
              <li key={t.id} className="flex gap-3 py-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                  <Lightbulb className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-sm text-fg-muted">{t.body}</p>
                </div>
                {t.monthlySaving > 0 ? (
                  <span className="shrink-0 text-right text-sm font-medium text-down tabular">
                    {money(t.monthlySaving, cur)}
                    <span className="block text-xs font-normal text-fg-muted">/ month</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle aside={subsAnnual ? <span className="text-sm text-fg-muted">{money(subsAnnual, cur)} / year</span> : null}>
          <span className="inline-flex items-center gap-2">
            <Repeat className="size-4" /> Subscriptions
          </span>
        </PanelTitle>
        {s.subscriptions.length === 0 ? (
          <p className="text-sm text-fg-muted">No repeating charges found yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-muted">
                  <th className="px-4 py-2 font-medium sm:pl-0">Merchant</th>
                  <th className="px-2 py-2 font-medium">How often</th>
                  <th className="px-2 py-2 font-medium">Last charged</th>
                  <th className="px-2 py-2 text-right font-medium">Per month</th>
                  <th className="px-4 py-2 text-right font-medium sm:pr-0">Per year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.subscriptions.map((x) => (
                  <tr key={`${x.merchant}-${x.cadence}`}>
                    <td className="px-4 py-2.5 sm:pl-0">
                      <p className="font-medium">{x.merchant}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <CategoryChip category={x.category} className="text-xs text-fg-muted" />
                        {x.priceChanged ? <Badge variant="warn">Price changed</Badge> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-fg-muted">
                      {CADENCE[x.cadence] ?? x.cadence} · {x.occurrences}×
                    </td>
                    <td className="px-2 py-2.5 text-fg-muted">{fmtDate(x.lastChargedOn)}</td>
                    <td className="px-2 py-2.5 text-right tabular">{money(x.monthlyAmount, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular sm:pr-0">{money(x.annualCost, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelTitle aside={<span className="text-sm font-medium tabular">{money(s.fees.totalLast12Months, cur)}</span>}>
            <span className="inline-flex items-center gap-2">
              <Receipt className="size-4" /> Fees in the last 12 months
            </span>
          </PanelTitle>
          {s.fees.items.length === 0 ? (
            <p className="text-sm text-fg-muted">No fees, interest or charges found. Nice.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.fees.items.map((f) => (
                <li key={f.type} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {f.label} <span className="text-xs text-fg-muted">×{f.count}</span>
                  </span>
                  <span className="font-medium tabular">{money(f.amount, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <Copy className="size-4" /> Possible duplicate charges
            </span>
          </PanelTitle>
          {s.duplicates.length === 0 ? (
            <p className="text-sm text-fg-muted">No double charges spotted.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.duplicates.map((d, i) => (
                <li key={`${d.merchant}-${i}`} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/transactions?q=${encodeURIComponent(d.merchant)}`} className="font-medium hover:underline">
                      {d.merchant}
                    </Link>
                    <span className="font-medium tabular">
                      {d.dates.length} × {money(d.amount, cur)}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">{d.dates.map(fmtDate).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
          {s.duplicates.length > 0 ? (
            <p className="mt-3 text-xs text-fg-muted">If a charge really was taken twice, raise it with your card issuer. Most let you dispute it in the app.</p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
