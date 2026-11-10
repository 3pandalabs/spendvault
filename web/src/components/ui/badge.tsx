import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// AdVault's translucent badge tones, keyed by SpendVault's variant names.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-amber-400/30 bg-amber-400/10 text-amber-200",
        outline: "border-white/15 bg-transparent text-zinc-300",
        good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        bad: "border-red-400/30 bg-red-400/10 text-red-200",
        warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
        muted: "border-white/15 bg-white/5 text-zinc-300",
        info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
