import { ArrowRight, Bell, EyeOff, FileDown, KeyRound, Mail, PiggyBank, ShieldCheck, Trash2, Upload, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
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

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-accent-soft via-bg to-bg">
      <PublicHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-16 md:grid-cols-2 md:pt-16">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-accent shadow-sm">
              <ShieldCheck className="size-3.5" /> No bank login. Ever.
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
              Every card and bank account. One spending dashboard.
            </h1>
            <p className="mt-4 text-lg text-fg-muted">
              SpendVault reads the statements already landing in your inbox, shows where your money goes, flags spending spikes, and finds the
              subscriptions and fees you can cut.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-base font-medium text-accent-fg hover:opacity-90"
              >
                Get started free <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-full border border-line-strong bg-white px-6 text-base font-medium text-fg hover:bg-bg-subtle"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-sm text-fg-muted">Works with HDFC, ICICI, SBI Card, Axis, Kotak, Amex and more.</p>
          </div>

          {/* Static product preview */}
          <div aria-hidden className="rounded-3xl border border-line bg-white p-5 shadow-xl shadow-indigo-950/5">
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-fg-muted">Spent in November</p>
              <p className="text-xs font-medium text-up">↑ 18% vs 3-month avg</p>
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular">{inr.format(34820)}</p>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-bg-subtle">
              {DEMO.map((d) => (
                <div key={d.key} style={{ width: `${d.share * 100}%`, background: CATEGORY_META[d.key].color }} />
              ))}
            </div>
            <ul className="mt-4 space-y-2.5">
              {DEMO.map((d) => (
                <li key={d.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: CATEGORY_META[d.key].color }} />
                    {CATEGORY_META[d.key].label}
                  </span>
                  <span className="font-medium tabular">{inr.format(d.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-3 rounded-xl bg-rose-50 p-3 text-sm">
              <Bell className="mt-0.5 size-4 shrink-0 text-rose-700" />
              <p>
                <span className="font-medium">Food delivery is up 62%</span>
                <span className="text-fg-muted"> this month vs your usual {inr.format(5200)}.</span>
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-line bg-white py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-line p-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <s.icon className="size-5" />
                    </span>
                    <span className="text-sm font-medium text-fg-muted">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What you get */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: LayoutDashboard, t: "One dashboard", b: "Spend by category, day, merchant and card, month over month." },
              { icon: Bell, t: "Spike alerts", b: "A heads-up when a category or a single day runs well above your usual." },
              { icon: PiggyBank, t: "Savings ideas", b: "Forgotten subscriptions, price hikes, late fees, forex markups and double charges." },
              { icon: Upload, t: "Four ways in", b: "Gmail forwarding, upload, your phone's Share button, or WhatsApp." },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-line bg-white p-5">
                <f.icon className="size-5 text-accent" />
                <h3 className="mt-3 font-semibold">{f.t}</h3>
                <p className="mt-1 text-sm text-fg-muted">{f.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section className="bg-fg py-16 text-white">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-semibold tracking-tight">Built for financial data from day one</h2>
            <p className="mt-2 max-w-2xl text-white/75">You decide exactly what SpendVault sees. Here is everything it does with it.</p>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: EyeOff, t: "Only what you forward", b: "We only ever see the emails your filter forwards. The rest of your inbox stays yours." },
                { icon: ShieldCheck, t: "No bank login", b: "We never ask for net-banking or card credentials. We can't move money." },
                { icon: Trash2, t: "Originals deleted", b: "Statement files are deleted after we read them. We keep only the transactions." },
                { icon: KeyRound, t: "Passwords encrypted", b: "PDF passwords are encrypted at rest and never shown again, not even to you." },
                { icon: FileDown, t: "Export or delete anytime", b: "Download everything as a file, or delete your account and all data in one step." },
              ].map((p) => (
                <li key={p.t} className="flex gap-3">
                  <p.icon className="mt-0.5 size-5 shrink-0 text-indigo-300" />
                  <div>
                    <p className="font-medium">{p.t}</p>
                    <p className="text-sm text-white/70">{p.b}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/privacy" className="mt-8 inline-block text-sm text-indigo-200 underline-offset-4 hover:underline">
              Read the privacy policy
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">See last month&apos;s spending in five minutes</h2>
          <p className="mt-2 text-fg-muted">Free while in early access. Not financial advice, just a clear view of your own money.</p>
          <Link
            href="/signup"
            className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-base font-medium text-accent-fg hover:opacity-90"
          >
            Create your account <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
