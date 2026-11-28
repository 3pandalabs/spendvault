"use client";

// SpendVault Plus bits shared by the signed-in pages. With billing off
// (the default) the API reports everyone as Plus, so none of this shows.

import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { PlusFeature } from "@/lib/types";
import { cn } from "@/lib/utils";

const WHAT: Record<PlusFeature, string> = {
  ask: "Ask SpendVault",
  household: "Household sharing",
  digests: "Weekly and monthly summaries",
  unlimited_budgets: "More than 3 category budgets",
  unlimited_goals: "More than 1 savings goal",
  tax_export: "The tax CSV",
  price_tracker: "The item price tracker",
};

/** "This is part of SpendVault Plus" with a link to the Plan page. */
export function PlusRequiredNote({ feature, className }: { feature: PlusFeature; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2.5 text-sm", className)} role="status">
      <span className="inline-flex items-center gap-2 text-amber-100">
        <Sparkles className="size-4 shrink-0 text-amber-300" aria-hidden />
        {WHAT[feature]} is part of SpendVault Plus.
      </span>
      <Link href="/plan" className="font-medium text-accent-strong hover:underline">
        See Plan
      </Link>
    </div>
  );
}

/** Small "Plus" tag next to a feature name. */
export function PlusBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-amber-200 uppercase", className)}>
      <Sparkles className="size-3" aria-hidden /> Plus
    </span>
  );
}
