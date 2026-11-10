"use client";

import {
  AlertTriangle,
  Copy as CopyIcon,
  FileWarning,
  Mail,
  MessageCircle,
  Receipt,
  Share2,
  Store,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
import { categoryColor, categoryLabel } from "@/lib/categories";
import type { AlertKind, DocumentSource } from "@/lib/types";
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
