"use client";

// Small building blocks shared by the signed-in pages (styles in app/(app)/app.css).

import { Info, ReceiptText } from "lucide-react";
import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** style={delay(0.1)} staggers a .spa-in / .spa-grow element. */
export const delay = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

/** Section switcher for pages that share one nav entry (Insights: Alerts | Savings; Setup | Settings). */
export function SubTabs({ items, label }: { items: Array<{ href: string; label: string; icon?: typeof ReceiptText }>; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="spa-in mb-5 inline-flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {items.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm whitespace-nowrap",
              active ? "bg-white/10 font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {Icon ? <Icon className={cn("size-4", active && "text-amber-300")} aria-hidden /> : null}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Receipt" pill on a transaction that has a matched receipt (item-level detail inside). */
export function ReceiptPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-emerald-200 uppercase",
        className,
      )}
      title="A receipt is matched to this charge: open it to see what was bought"
    >
      <ReceiptText className="size-3" aria-hidden /> Receipt
    </span>
  );
}

/** Mono eyebrow label, as used on the home page sections. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[11px] tracking-[0.2em] text-amber-300/80 uppercase", className)}>{children}</p>;
}

export const INSIGHT_TABS = [
  { href: "/alerts", label: "Alerts" },
  { href: "/savings", label: "Savings" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/budgets", label: "Budgets" },
];
export const ACCOUNT_TABS = [
  { href: "/setup", label: "Setup" },
  { href: "/settings", label: "Settings" },
  { href: "/household", label: "Household" },
];

/**
 * Small "i" button that explains a number. A real button (works on touch and
 * keyboard), toggling a short note under it; Escape or a second tap closes it.
 */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-6 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="spa-fade absolute top-7 right-0 z-30 w-[min(18rem,calc(100vw-2.5rem))] rounded-xl border border-white/15 bg-zinc-900/95 p-3 text-left text-xs leading-relaxed font-normal text-zinc-200 normal-case shadow-xl tracking-normal"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** Budget / progress bar: amber → emerald while under, amber when near, red when over. */
export function ProgressBar({ value, status, label }: { value: number; status: "ok" | "near" | "over"; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div
        className={cn(
          "spa-grow h-full rounded-full",
          status === "over" ? "bg-red-400" : status === "near" ? "bg-amber-300" : "bg-gradient-to-r from-amber-300 to-emerald-400",
        )}
        style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
      />
    </div>
  );
}

/** Parses a typed money amount ("1,200.50", "$45") → number, or null when empty/invalid. */
export function parseAmount(raw: string): number | null {
  const v = raw.replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
