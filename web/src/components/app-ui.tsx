"use client";

// Small building blocks shared by the signed-in pages (styles in app/(app)/app.css).

import { ReceiptText } from "lucide-react";
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
];
export const ACCOUNT_TABS = [
  { href: "/setup", label: "Setup" },
  { href: "/settings", label: "Settings" },
];
