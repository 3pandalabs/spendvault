"use client";

import { useState, useSyncExternalStore } from "react";
import { guessBaseCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Calculators } from "./calculators";

const noop = () => () => undefined;

/** Public /calculators: no account, currency guessed from the browser's time zone and switchable. */
export function PublicCalculators() {
  const guessed = useSyncExternalStore(noop, guessBaseCurrency, () => "USD" as const);
  const [picked, setPicked] = useState<"USD" | "INR" | null>(null);
  const currency = picked ?? guessed;
  return (
    <>
      <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1" role="radiogroup" aria-label="Currency">
        {(["USD", "INR"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={currency === c}
            onClick={() => setPicked(c)}
            className={cn("rounded-lg px-3 py-1.5 text-sm", currency === c ? "bg-white/10 font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-200")}
          >
            {c === "USD" ? "$ USD" : "₹ INR"}
          </button>
        ))}
      </div>
      <Calculators key={currency} currency={currency} />
    </>
  );
}
