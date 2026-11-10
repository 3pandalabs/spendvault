import { ArrowRight, Bell, EyeOff, FileDown, KeyRound, Mail, PiggyBank, ShieldCheck, Trash2, Upload, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Wordmark } from "@/components/Wordmark";
import { PublicHeader } from "@/components/legal";
import { CATEGORY_META } from "@/lib/categories";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const STEPS = [
  {
    icon: Mail,
    title: "Forward your statements",
    body: "Create one Gmail filter that forwards bank and card emails to your private SpendVault address. Or upload, share from your phone, or send on WhatsApp.",
  },
  {
    icon: KeyRound,
    title: "Save the PDF password once",
    body: "Most Indian statements are locked. Save each bank's password once, encrypted, and every future statement opens on its own.",
  },
  {
    icon: LayoutDashboard,
    title: "See everything in one place",
    body: "Every card and account on one dashboard, with spikes flagged and the subscriptions and fees worth cutting.",
  },
];

const DEMO = [
  { key: "food_delivery", amount: 8420, share: 0.24 },
  { key: "shopping", amount: 6910, share: 0.2 },
  { key: "groceries", amount: 5230, share: 0.15 },
  { key: "subscriptions", amount: 2870, share: 0.08 },
  { key: "transport", amount: 2140, share: 0.06 },
] as const;

const BANKS = ["HDFC", "ICICI", "SBI Card", "Axis", "Kotak", "Amex", "and more"];

const FEATURES = [
  { icon: LayoutDashboard, t: "One dashboard", b: "Spend by category, day, merchant and card, month over month." },
  { icon: Bell, t: "Spike alerts", b: "A heads-up when a category or a single day runs well above your usual." },
  { icon: PiggyBank, t: "Savings ideas", b: "Forgotten subscriptions, price hikes, late fees, forex markups and double charges." },
  { icon: Upload, t: "Four ways in", b: "Gmail forwarding, upload, your phone's Share button, or WhatsApp." },
];

const PRIVACY = [
  { icon: EyeOff, t: "Only what you forward", b: "We only ever see the emails your filter forwards. The rest of your inbox stays yours." },
  { icon: ShieldCheck, t: "No bank login", b: "We never ask for net-banking or card credentials. We can't move money." },
  { icon: Trash2, t: "Originals deleted", b: "Statement files are deleted after we read them. We keep only the transactions." },
  { icon: KeyRound, t: "Passwords encrypted", b: "PDF passwords are encrypted at rest and never shown again, not even to you." },
  { icon: FileDown, t: "Export or delete anytime", b: "Download everything as a file, or delete your account and all data in one step." },
];

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-5xl items-center gap-10 px-6 pt-10 pb-14 sm:pt-16 md:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0">
            <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-200 uppercase">
              <ShieldCheck className="size-3.5" /> No bank login. Ever.
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Every card and bank account. One spending dashboard.
            </h1>
            <p className="mt-6 text-lg text-zinc-400">
              <strong className="font-medium text-zinc-200">SpendVault</strong> reads the statements already landing in your inbox, shows
              where your money goes, flags spending spikes, and finds the subscriptions and fees you can cut.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-amber-400 px-6 text-base font-medium text-zinc-950 hover:bg-amber-300"
              >
                Get started free <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-lg border border-white/15 bg-white/5 px-6 text-base font-medium text-zinc-100 hover:bg-white/10"
              >
                Log in
              </Link>
            </div>
            <p className="mt-6 text-sm text-zinc-500">Works with</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BANKS.map((b) => (
                <span key={b} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-zinc-400">
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Static product preview */}
          <Card aria-hidden className="min-w-0 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Spent in November</p>
              <p className="text-xs font-medium text-up">↑ 18% vs 3-month avg</p>
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight tabular">{inr.format(34820)}</p>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/5">
              {DEMO.map((d) => (
                <div key={d.key} style={{ width: `${d.share * 100}%`, background: CATEGORY_META[d.key].color }} />
              ))}
            </div>
            <ul className="mt-4 space-y-2.5">
              {DEMO.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_META[d.key].color }} />
                    <span className="truncate text-zinc-300">{CATEGORY_META[d.key].label}</span>
                  </span>
                  <span className="font-medium tabular">{inr.format(d.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm">
              <Bell className="mt-0.5 size-4 shrink-0 text-red-300" />
              <p>
                <span className="font-medium text-red-100">Food delivery is up 62%</span>
                <span className="text-zinc-400"> this month vs your usual {inr.format(5200)}.</span>
              </p>
            </div>
          </Card>
        </section>

        {/* How it works */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-16">
          <h2 className="mb-5 text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs tracking-widest text-amber-300/80">STEP {i + 1}</span>
                  <s.icon className="size-4 text-zinc-500" aria-hidden />
                </div>
                <CardTitle className="mt-2">{s.title}</CardTitle>
                <CardDescription>{s.body}</CardDescription>
              </li>
            ))}
          </ol>
        </section>

        {/* What you get */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-16">
          <h2 className="mb-5 text-2xl font-semibold tracking-tight">What you get</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Card key={f.t} className="p-5">
                <f.icon className="size-5 text-amber-300" aria-hidden />
                <CardTitle className="mt-3">{f.t}</CardTitle>
                <CardDescription>{f.b}</CardDescription>
              </Card>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-16">
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-6 backdrop-blur-sm">
            <h2 className="text-xl font-semibold tracking-tight">Built for financial data from day one</h2>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400">You decide exactly what SpendVault sees. Here is everything it does with it.</p>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {PRIVACY.map((p) => (
                <li key={p.t} className="flex gap-3">
                  <p.icon className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
                  <div>
                    <p className="font-medium text-zinc-200">{p.t}</p>
                    <p className="text-sm text-zinc-400">{p.b}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/privacy" className="mt-6 inline-block text-sm text-amber-300 underline underline-offset-2 hover:text-amber-200">
              Read the privacy policy
            </Link>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-24 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">See last month&apos;s spending in five minutes</h2>
          <p className="mt-2 text-zinc-400">Free while in early access. Not financial advice, just a clear view of your own money.</p>
          <Link
            href="/signup"
            className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-amber-400 px-6 text-base font-medium text-zinc-950 hover:bg-amber-300"
          >
            Create your account <ArrowRight className="size-4" />
          </Link>
          <p className="mt-12 text-sm text-zinc-500">
            <Wordmark />
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
