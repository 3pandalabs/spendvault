import type { Metadata } from "next";
import Link from "next/link";
import { PublicCalculators } from "@/components/PublicCalculators";
import { Footer } from "@/components/Footer";
import { PublicHeader } from "@/components/legal";
import "../(app)/app.css";

export const metadata: Metadata = {
  title: "Money calculators: FIRE, SIP, loan, card payoff",
  description:
    "Free calculators for your FIRE number, compound interest and SIP with step-up, loan EMI with amortization, credit card payoff (avalanche vs snowball), emergency fund, retirement and savings goals. Runs in your browser.",
  alternates: { canonical: "/calculators" },
};

export default function CalculatorsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-16 sm:px-6">
        <p className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-amber-300/80 uppercase">Calculators</p>
        <h1 className="spa-display text-3xl font-bold sm:text-4xl">Money calculators</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          FIRE, compound interest and SIP, loans, card payoff and more. Everything runs in your browser; nothing you type is sent to us.{" "}
          <Link href="/signup" className="text-amber-300 hover:underline">
            Sign up
          </Link>{" "}
          and SpendVault fills them in from your own spending.
        </p>
        <div className="mt-6">
          <PublicCalculators />
        </div>
      </main>
      <Footer />
    </div>
  );
}
