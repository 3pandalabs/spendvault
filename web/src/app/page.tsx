import {
  ArrowRight,
  Bell,
  Check,
  EyeOff,
  FileDown,
  KeyRound,
  LayoutDashboard,
  Lock,
  Mail,
  MessageCircle,
  PiggyBank,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Wordmark } from "@/components/Wordmark";
import { PublicHeader } from "@/components/legal";
import { CATEGORY_META } from "@/lib/categories";
import "./home.css";

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

// Example inbox rows for the hero animation (not real emails).
const INBOX = [
  { from: "HDFC Bank", subject: "Credit card statement" },
  { from: "ICICI Bank", subject: "Account e-statement" },
  { from: "SBI Card", subject: "Monthly statement" },
];

const BANKS = ["HDFC", "ICICI", "SBI Card", "Axis", "Kotak", "Amex", "and more"];

const FEATURES = [
  { icon: LayoutDashboard, t: "One dashboard", b: "Spend by category, day, merchant and card, month over month." },
  { icon: Bell, t: "Spike alerts", b: "A heads-up when a category or a single day runs well above your usual." },
  { icon: PiggyBank, t: "Savings ideas", b: "Forgotten subscriptions, price hikes, late fees, forex markups and double charges." },
  { icon: Upload, t: "Four ways in", b: "Gmail forwarding, upload, your phone's Share button, or WhatsApp." },
];

const WAYS_IN = [
  { icon: Mail, t: "Gmail forwarding" },
  { icon: Upload, t: "Upload" },
  { icon: Share2, t: "Share button" },
  { icon: MessageCircle, t: "WhatsApp" },
];

// The kinds of savings ideas SpendVault looks for (FEATURES above); amounts are examples.
const SAVINGS = [
  { t: "Forgotten subscription", amount: 649 },
  { t: "Price hike", amount: 200 },
  { t: "Late fee", amount: 1180 },
  { t: "Forex markup", amount: 412 },
  { t: "Double charge", amount: 899 },
];

const PRIVACY = [
  { icon: EyeOff, t: "Only what you forward", b: "We only ever see the emails your filter forwards. The rest of your inbox stays yours." },
  { icon: ShieldCheck, t: "No bank login", b: "We never ask for net-banking or card credentials. We can't move money." },
  { icon: Trash2, t: "Originals deleted", b: "Statement files are deleted after we read them. We keep only the transactions." },
  { icon: KeyRound, t: "Passwords encrypted", b: "PDF passwords are encrypted at rest and never shown again, not even to you." },
  { icon: FileDown, t: "Export or delete anytime", b: "Download everything as a file, or delete your account and all data in one step." },
];

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const delay = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

const PRIMARY =
  "spv-btn-shine inline-flex h-12 items-center gap-2 rounded-xl bg-amber-400 px-6 text-base font-semibold text-zinc-950 shadow-[0_10px_40px_-10px_rgba(251,191,36,.7)] hover:bg-amber-300";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-8 pb-16 sm:pt-14 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-200 uppercase">
              <ShieldCheck className="size-3.5" /> No bank login. Ever.
            </p>
            <h1 className="spv-display text-[2.4rem] leading-[1.05] font-extrabold text-balance sm:text-6xl">
              Every card and bank account.{" "}
              <span className="spv-scribble">
                <span className="spv-shimmer">One spending dashboard.</span>
                <svg viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M2 8 C 60 2, 120 11, 180 5 S 270 3, 298 7" fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg text-zinc-400">
              <strong className="font-medium text-zinc-200">SpendVault</strong> reads the statements already landing in your inbox, shows
              where your money goes, flags spending spikes, and finds the subscriptions and fees you can cut.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup" className={PRIMARY}>
                Get started free <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-xl border border-white/15 bg-white/5 px-6 text-base font-medium text-zinc-100 hover:bg-white/10"
              >
                Log in
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
              <span className="spv-live size-2 rounded-full bg-emerald-400" aria-hidden />
              Free while in early access.
            </p>
          </div>

          <HeroStage />
        </section>

        {/* Works with: marquee */}
        <section aria-label="Works with" className="border-y border-white/10 bg-white/[0.02] py-5">
          <p className="mb-3 text-center font-mono text-[11px] tracking-[0.25em] text-zinc-500 uppercase">Works with</p>
          <div className="spv-marquee">
            <div className="spv-marquee-track">
              {[0, 1].map((copy) => (
                <div key={copy} aria-hidden={copy === 1 || undefined} className="flex shrink-0 items-center">
                  {BANKS.map((b) => (
                    <span key={b} className="spv-display flex items-center gap-6 px-6 text-2xl font-semibold whitespace-nowrap text-zinc-400 sm:text-3xl">
                      {b}
                      <span className="size-1.5 rounded-full bg-amber-400/60" aria-hidden />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto w-full max-w-6xl px-6 py-20">
          <SectionTitle eyebrow="How it works" title={<>Three steps, <span className="spv-shimmer">then it runs itself.</span></>} />
          <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
            <div aria-hidden className="spv-dash absolute top-7 right-[16%] left-[16%] hidden h-[2px] md:block" />
            {STEPS.map((s, i) => (
              <li key={s.title} className="spv-tile relative rounded-2xl border border-white/10 bg-zinc-900/70 p-6 backdrop-blur">
                <span className="spv-display relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-2xl font-extrabold text-zinc-950 shadow-[0_10px_30px_-10px_rgba(251,191,36,.8)]">
                  {i + 1}
                </span>
                <div className="mt-5 flex items-center gap-2">
                  <s.icon className="size-4 text-amber-300" aria-hidden />
                  <h3 className="text-lg font-semibold text-zinc-100">{s.title}</h3>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* What you get */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <SectionTitle eyebrow="What you get" title={<>See it, <span className="spv-shimmer">then cut it.</span></>} />
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {/* Four ways in */}
            <div className="spv-tile min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Your private address</p>
              <p className="mt-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2.5 font-mono text-[13px] break-all text-zinc-200 sm:text-sm">
                vault+<span className="text-amber-300">your-token</span>@in.spendvault.3pandalabs.com
                <span className="spv-caret ml-0.5" aria-hidden />
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-3">
                {WAYS_IN.map((w, i) => (
                  <li key={w.t} className="spv-in flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-300" style={delay(0.15 * i)}>
                    <w.icon className="size-4 shrink-0 text-amber-300" aria-hidden />
                    {w.t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Savings ideas, example */}
            <div className="spv-tile min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-xs tracking-widest text-emerald-300/80 uppercase">Savings ideas</p>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-wider text-zinc-500 uppercase">Example</span>
              </div>
              <ul className="mt-4 space-y-2">
                {SAVINGS.map((s, i) => (
                  <li key={s.t} className="spv-tick flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm" style={delay(i * 0.9)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                        <Check className="size-3" aria-hidden />
                      </span>
                      <span className="truncate text-zinc-300">{s.t}</span>
                    </span>
                    <span className="font-medium text-emerald-300 tabular">{inr.format(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.t} className="spv-tile rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-amber-400/10">
                  <f.icon className="size-5 text-amber-300" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold text-zinc-100">{f.t}</h3>
                <p className="mt-1 text-sm text-zinc-400">{f.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <div className="spv-ring-border">
            <div className="rounded-[calc(1.25rem-1px)] bg-zinc-950/95 p-6 sm:p-10">
              <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Privacy</p>
              <h2 className="spv-display mt-3 text-3xl leading-tight font-extrabold text-balance sm:text-4xl">
                Built for financial data from day one
              </h2>
              <p className="mt-3 max-w-2xl text-zinc-400">You decide exactly what SpendVault sees. Here is everything it does with it.</p>
              <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {PRIVACY.map((p) => (
                  <li key={p.t} className="flex gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10">
                      <p.icon className="size-4.5 text-amber-300" aria-hidden />
                    </span>
                    <div>
                      <p className="font-medium text-zinc-200">{p.t}</p>
                      <p className="text-sm text-zinc-400">{p.b}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/privacy" className="mt-8 inline-block text-sm text-amber-300 underline underline-offset-2 hover:text-amber-200">
                Read the privacy policy
              </Link>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-24">
          <div className="spv-glow relative overflow-hidden rounded-[2rem] border border-white/10 px-6 py-16 text-center sm:py-20">
            <h2 className="spv-display mx-auto max-w-2xl text-4xl leading-tight font-extrabold text-balance sm:text-6xl">
              See last month&apos;s spending in <span className="spv-shimmer">five minutes</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-zinc-400">Free while in early access. Not financial advice, just a clear view of your own money.</p>
            <Link href="/signup" className={`${PRIMARY} mt-8 h-14 px-8 text-lg`}>
              Create your account <ArrowRight className="size-4" />
            </Link>
            <p className="mt-12 text-sm text-zinc-500">
              <Wordmark />
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs tracking-[0.25em] text-amber-300/80 uppercase">{eyebrow}</p>
      <h2 className="spv-display mt-3 text-3xl leading-tight font-extrabold text-balance sm:text-5xl">{title}</h2>
    </div>
  );
}

/** Inbox rows take turns being forwarded, an envelope drops into the vault, the dashboard fills. All example data. */
function HeroStage() {
  return (
    <div className="relative mx-auto w-full max-w-md min-w-0" role="img" aria-label="Example: statement emails forwarded from an inbox become a spending dashboard">
      {/* Inbox */}
      <div className="spv-tilt relative z-10 mx-2 rounded-2xl border border-white/10 bg-zinc-900/90 p-3 shadow-2xl backdrop-blur sm:mx-6">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <Mail className="size-3.5" aria-hidden /> Inbox
          </p>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-wider text-zinc-500 uppercase">Example</span>
        </div>
        <ul className="space-y-1.5">
          {INBOX.map((m, i) => (
            <li
              key={m.from}
              data-first={i === 0 || undefined}
              className="spv-row flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2"
              style={delay(i * 3)}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-zinc-200">{m.from}</span>
                <span className="flex items-center gap-1 truncate text-[11px] text-zinc-500">
                  <Lock className="size-3 shrink-0" aria-hidden /> {m.subject} · PDF
                </span>
              </span>
              <span
                data-first={i === 0 || undefined}
                className="spv-sent shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-zinc-950"
                style={delay(i * 3)}
              >
                Forwarded
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Pipe into the vault */}
      <div className="relative mx-auto h-16 w-[3px]" aria-hidden>
        <div className="spv-pipe absolute inset-0 rounded-full" />
        <span className="spv-drop absolute top-0 left-1/2 grid size-6 place-items-center rounded-md bg-amber-400 text-zinc-950 shadow-[0_0_24px_rgba(251,191,36,.7)]">
          <Mail className="size-3.5" />
        </span>
      </div>

      {/* Dashboard */}
      <div className="spv-float">
        <div className="spv-sheen rounded-2xl border border-white/10 bg-zinc-900/80 p-5 shadow-[0_30px_80px_-30px_rgba(251,191,36,.35)] backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Spent in November</p>
            <p className="text-xs font-medium text-up">↑ 18% vs 3-month avg</p>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular">{inr.format(34820)}</p>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/5">
            {DEMO.map((d, i) => (
              <div
                key={d.key}
                className="spv-grow"
                style={{ width: `${d.share * 100}%`, background: CATEGORY_META[d.key].color, ...delay(0.3 + i * 0.12) }}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {DEMO.map((d, i) => (
              <li key={d.key} className="spv-in flex items-center justify-between gap-3 text-sm" style={delay(0.5 + i * 0.12)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_META[d.key].color }} />
                  <span className="truncate text-zinc-300">{CATEGORY_META[d.key].label}</span>
                </span>
                <span className="font-medium tabular">{inr.format(d.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="spv-alert mt-4 flex gap-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm">
            <Bell className="mt-0.5 size-4 shrink-0 text-red-300" />
            <p>
              <span className="font-medium text-red-100">Food delivery is up 62%</span>
              <span className="text-zinc-400"> this month vs your usual {inr.format(5200)}.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
