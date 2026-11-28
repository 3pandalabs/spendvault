"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy as CopyIcon,
  FileWarning,
  Gauge,
  Mail,
  MessageCircle,
  Receipt,
  Repeat,
  Share2,
  Store,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
import { categoryColor, categoryLabel } from "@/lib/categories";
import { money } from "@/lib/format";
import type { AlertKind, Document, DocumentSource } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CategoryChip({ category, className }: { category: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm", className)}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(category) }} aria-hidden />
      <span className="truncate">{categoryLabel(category)}</span>
    </span>
  );
}

export const ALERT_ICON: Record<AlertKind, { icon: typeof Zap; label: string; tone: string }> = {
  category_spike: { icon: TrendingUp, label: "Category spike", tone: "bg-red-400/10 text-red-300" },
  daily_spike: { icon: Zap, label: "Big spending day", tone: "bg-amber-400/10 text-amber-300" },
  large_new_merchant: { icon: Store, label: "New merchant", tone: "bg-sky-400/10 text-sky-300" },
  price_hike: { icon: AlertTriangle, label: "Price went up", tone: "bg-orange-400/10 text-orange-300" },
  fee: { icon: Receipt, label: "Fee or charge", tone: "bg-rose-400/10 text-rose-300" },
  duplicate: { icon: CopyIcon, label: "Possible duplicate", tone: "bg-violet-400/10 text-violet-300" },
  new_subscription: { icon: Repeat, label: "New subscription", tone: "bg-emerald-400/10 text-emerald-300" },
  over_budget: { icon: Gauge, label: "Over budget", tone: "bg-red-400/10 text-red-300" },
};

export function AlertIcon({ kind, className }: { kind: AlertKind; className?: string }) {
  const meta = ALERT_ICON[kind] ?? { icon: FileWarning, label: kind, tone: "bg-white/5 text-zinc-300" };
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", meta.tone, className)} title={meta.label}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

export const SOURCE_META: Record<DocumentSource, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "Email" },
  upload: { icon: Upload, label: "Upload" },
  share: { icon: Share2, label: "Shared from phone" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
};

/**
 * "Reconciled ✓" when the lines we read add up to the statement's own
 * opening → closing balance; otherwise how much is unaccounted for.
 * Nothing when the statement didn't print both ends.
 */
export function ReconciledBadge({ d, currency, className }: { d: Pick<Document, "reconciled" | "reconcileDifference">; currency: string; className?: string }) {
  if (d.reconciled) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-200", className)}
        title="Every line we read adds up to the statement's opening and closing balance."
      >
        <CheckCircle2 className="size-3.5" aria-hidden /> Reconciled
      </span>
    );
  }
  if (d.reconciled === false) {
    const gap = d.reconcileDifference != null ? Math.abs(d.reconcileDifference) : null;
    return (
      <span
        className={cn("inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-200", className)}
        title="The lines we read don't add up to the statement's opening and closing balance. A few transactions may be missing or misread."
      >
        <AlertTriangle className="size-3.5" aria-hidden /> Not reconciled{gap != null ? ` — ${money(gap, currency)} unaccounted` : ""}
      </span>
    );
  }
  return null;
}
