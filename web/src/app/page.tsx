import {
  ArrowRight,
  Banknote,
  Calculator,
  Repeat,
  BadgeCheck,
  Bell,
  BellRing,
  CalendarClock,
  Camera,
  Check,
  CircleAlert,
  CreditCard,
  MessageCircleQuestion,
  PiggyBank,
  Tags,
  Undo2,
  EyeOff,
  FileDown,
  FileSpreadsheet,
  FileText,
  KeyRound,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Receipt,
  Scale,
  ScanLine,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
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
    title: "Send it in, your way",
    body: "One Gmail filter forwards statements and purchase alerts to your private SpendVault address. Or upload a CSV or PDF, or snap a receipt.",
  },
  {
    icon: KeyRound,
    title: "Save the PDF password once",
    body: "Some banks lock statement PDFs with a password. Save that bank's password once, encrypted, and every future statement opens on its own.",
  },
  {
    icon: LayoutDashboard,
    title: "See it down to the item",
    body: "Every card and account on one dashboard, checked against each statement's balance, with receipts split into what you actually bought.",
  },
];

const DEMO = [
  { key: "groceries", amount: 742, share: 0.21 },
  { key: "food_delivery", amount: 608, share: 0.17 },
  { key: "shopping", amount: 531, share: 0.15 },
  { key: "transport", amount: 284, share: 0.08 },
  { key: "subscriptions", amount: 167, share: 0.05 },
] as const;

// Example inbox rows for the hero animation (not real emails): one of each way in.
const INBOX = [
  { from: "Chase", subject: "Your statement is ready", kind: "PDF", icon: FileText },
  { from: "Capital One", subject: "A purchase was made", kind: "Alert", icon: BellRing },
  { from: "Target", subject: "Your receipt", kind: "Photo", icon: Receipt },
];

// US banks first; Indian banks (HDFC, ICICI, SBI Card, Axis, Kotak, ...) are supported too.
const BANKS = ["Chase", "Amex", "Citi", "Capital One", "Bank of America", "Wells Fargo", "Discover", "+ Indian banks", "and more"];

// Receipt section example: one $86.40 card charge, split by what was in the bag.
const RECEIPT_ITEMS = [
  { t: "Tortilla chips & salsa (3)", amount: 14.97, group: 0 },
  { t: "Paper towels, 12 rolls", amount: 19.99, group: 1 },
  { t: "Granola bars, family box", amount: 11.38, group: 0 },
  { t: "Kids T-shirts (2)", amount: 17.98, group: 2 },
  { t: "Cookies & crackers", amount: 13.77, group: 0 },
  { t: "Dish soap", amount: 8.31, group: 1 },
];
const RECEIPT_GROUPS = [
  { t: "Snacks", color: "#fb923c" },
  { t: "Household", color: "#38bdf8" },
  { t: "Kids clothing", color: "#f472b6" },
];
const RECEIPT_TOTAL = 86.4;

const RECEIPT_POINTS = [
  { icon: Camera, t: "Snap, upload or forward", b: "Photograph a paper receipt, upload a PDF invoice, or forward the order confirmation email." },
  { icon: ScanLine, t: "Claude reads every line", b: "Store, date, each item and its price, pulled out for you. Nothing to type." },
  { icon: BadgeCheck, t: "Matched to the card charge", b: "Each receipt is paired with the transaction that paid for it, so one charge becomes many categories." },
  { icon: Undo2, t: "Returns, warranties and prices", b: "See when a store's typical return window closes, note warranty dates, track the refund after you send something back, and watch the price of things you buy again and again." },
];

const WAYS_IN = [
  { icon: Mail, t: "Gmail forwarding" },
  { icon: BellRing, t: "Purchase alerts" },
  { icon: FileSpreadsheet, t: "CSV / PDF upload" },
  { icon: Camera, t: "Receipt photos" },
  { icon: Share2, t: "Share button" },
  { icon: MessageCircle, t: "WhatsApp" },
];

// The fee and hidden-charge flags SpendVault raises; amounts are examples.
const FEES = [
  { t: "Late payment fee", amount: 40 },
  { t: "Interest charge", amount: 23.18 },
  { t: "Foreign transaction fee", amount: 27.6 },
  { t: "Annual fee", amount: 95 },
  { t: "ATM fee", amount: 3.5 },
  { t: "Overdraft fee", amount: 35 },
];

// Subscriptions tile example (generic names; monthly total 96.47, yearly 1,157.64).
const SUBS = [
  { t: "Streaming service", amount: 15.49, note: "Next charge Dec 3", tag: null },
  { t: "Music app", amount: 12.99, note: "Was $11.99", tag: "Price up" },
  { t: "Cloud storage", amount: 2.99, note: "First seen this month", tag: "New" },
  { t: "Gym membership", amount: 65, note: "Next charge Dec 12", tag: null },
];

// Budgets tile example.
const BUDGETS = [
  { key: "groceries", spent: 742, budget: 800 },
  { key: "food_delivery", spent: 608, budget: 450 },
  { key: "shopping", spent: 531, budget: 600 },
] as const;

const FEATURES = [
  { icon: BadgeCheck, t: "Reconciled ✓", b: "Parsed transactions are checked against each statement's opening and closing balance, so you know nothing was missed." },
  { icon: Bell, t: "Spike alerts", b: "A heads-up when a category or a single day runs well above your usual." },
  { icon: Scale, t: "Net worth", b: "Card and bank balances from your statements, plus anything you add yourself, in one simple number." },
  { icon: Users, t: "Shared household", b: "Invite your partner and see your combined spending. Each of you keeps your own statements and receipts private." },
  { icon: FileDown, t: "Your data is yours", b: "Export every transaction to CSV whenever you like. Free, always." },
  { icon: LayoutDashboard, t: "One dashboard", b: "Spend by category, day, merchant and card, month over month." },
  { icon: CreditCard, t: "Card due dates", b: "Due date, minimum and balance read from each statement, a reminder 5 days and 1 day before, and how much of your limit you're using." },
  { icon: MessageCircleQuestion, t: "Ask SpendVault", b: "Ask in plain English, like “how much on coffee in October?”, and get an answer from your own data." },
  { icon: Tags, t: "Split, tag and note", b: "Split one charge across categories, add tags and notes, set merchant rules that fix past and future charges, and search it all." },
  { icon: PiggyBank, t: "Savings goals", b: "Set a target and a date and see how much to put aside each month." },
  { icon: Mail, t: "Weekly or monthly summary", b: "An optional email with what you spent, your top categories, new subscriptions and card payments coming up." },
  { icon: FileText, t: "Tax tags", b: "Tag charges and receipt items as tax-deductible, business or HSA/FSA eligible, then export the year as a CSV." },
  { icon: Banknote, t: "Cash spends", b: "Paid in cash? Add it in a few taps and it counts in your budgets and dashboard like everything else." },
  { icon: Repeat, t: "Budget rollover", b: "Carry what you didn't spend into next month, and overspending too if you like, per category or overall." },
  { icon: Calculator, t: "Calculators", b: "FIRE, SIP, loans, card payoff, emergency fund and retirement, filled in from your own numbers." },
];

const PRIVACY = [
  { icon: ShieldCheck, t: "No bank login", b: "We never ask for your online banking or card login, and never connect to your bank. We can't move money." },
  { icon: EyeOff, t: "No inbox access", b: "We only see the emails your filter forwards. We never sign in to your inbox; the rest of it stays yours." },
  { icon: Trash2, t: "Originals deleted", b: "Statement files and receipt images are encrypted while stored and deleted after we read them, unless you choose to keep them." },
  { icon: KeyRound, t: "Passwords encrypted", b: "PDF passwords are encrypted at rest and never shown again, not even to you." },
  { icon: FileDown, t: "Export or delete anytime", b: "Download everything as CSV, or delete your account and all data in one step." },
];

// Example amounts are US dollars; the app itself also supports INR.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const delay = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

const PRIMARY =
  "spv-btn-shine inline-flex h-12 items-center gap-2 rounded-xl bg-amber-400 px-6 text-base font-semibold text-zinc-950 shadow-[0_10px_40px_-10px_rgba(251,191,36,.7)] hover:bg-amber-300";

const TILE = "spv-tile min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-6";

function ExampleTag() {
  return <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-wider text-zinc-500 uppercase">Example</span>;
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <PublicHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-8 pb-16 sm:pt-14 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-200 uppercase">
              <ShieldCheck className="size-3.5" /> No bank login. No inbox access.
            </p>
            <h1 className="spv-display text-[2.4rem] leading-[1.05] font-extrabold text-balance sm:text-6xl">
              Every card, every receipt.{" "}
              <span className="spv-scribble">
                <span className="spv-shimmer">Down to the line item.</span>
                <svg viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M2 8 C 60 2, 120 11, 180 5 S 270 3, 298 7" fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg text-zinc-400">
              <strong className="font-medium text-zinc-200">SpendVault</strong> reads the statements, purchase alerts and receipts you forward,
              shows where your money goes right down to what was in the cart, and flags the subscriptions and fees worth cutting.
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
              <span className="spv-live size-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
              Free while in early access. Works with Indian banks too.
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

        {/* Receipts: the headline differentiator */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1fr_1.05fr]">
          <div className="min-w-0">
            <SectionTitle
              eyebrow="Receipts"
              title={
                <>
                  $40 of that Target charge <span className="spv-shimmer">was snacks.</span>
                </>
              }
            />
            <p className="mt-5 max-w-xl text-lg text-zinc-400">
              Your statement says one line: Target, {usdCents.format(RECEIPT_TOTAL)}. Add the receipt and SpendVault shows what was actually in
              the bag, so groceries, household and kids&apos; clothes each land in the right category.
            </p>
            <ul className="mt-8 space-y-5">
              {RECEIPT_POINTS.map((p) => (
                <li key={p.t} className="flex gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400/10">
                    <p.icon className="size-5 text-amber-300" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100">{p.t}</p>
                    <p className="text-sm text-zinc-400">{p.b}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <ReceiptStage />
        </section>

        {/* How it works */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <SectionTitle eyebrow="How it works" title={<>Three steps, <span className="spv-shimmer">then it runs itself.</span></>} />
          <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
            <div aria-hidden className="spv-dash absolute top-7 right-[16%] left-[16%] hidden h-[2px] md:block" />
            {STEPS.map((s, i) => (
              <li key={s.title} className="spv-tile relative rounded-2xl border border-white/10 bg-zinc-900/70 p-6 backdrop-blur">
                <span className="spv-display relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-2xl font-extrabold text-zinc-950 shadow-[0_10px_30px_-10px_rgba(251,191,36,.8)]">
                  {i + 1}
                </span>
                <div className="mt-5 flex items-center gap-2">
                  <s.icon className="size-4 shrink-0 text-amber-300" aria-hidden />
                  <h3 className="text-lg font-semibold text-zinc-100">{s.title}</h3>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Ways in + fees */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <SectionTitle eyebrow="What you get" title={<>See it, <span className="spv-shimmer">then cut it.</span></>} />
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {/* Ways in */}
            <div className={TILE}>
              <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Your private address</p>
              <p className="mt-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2.5 font-mono text-[13px] break-all text-zinc-200 sm:text-sm">
                vault+<span className="text-amber-300">your-token</span>@in.spendvault.3pandalabs.com
                <span className="spv-caret ml-0.5" aria-hidden />
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-3">
                {WAYS_IN.map((w, i) => (
                  <li
                    key={w.t}
                    className="spv-in flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-300"
                    style={delay(0.12 * i)}
                  >
                    <w.icon className="size-4 shrink-0 text-amber-300" aria-hidden />
                    <span className="min-w-0">{w.t}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">Same-day spending:</span> set a $0.01 purchase alert at Chase, Amex, Capital One,
                Citi, Bank of America, Wells Fargo or Discover, and every charge shows up the day you make it, then gets matched to your
                statement later.
              </p>
            </div>

            {/* Fee & hidden-charge flags */}
            <div className={TILE}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-xs tracking-widest text-red-300/80 uppercase">Fees & hidden charges</p>
                <ExampleTag />
              </div>
              <p className="mt-2 text-sm text-zinc-400">Every fee buried in a statement, pulled out and flagged.</p>
              <ul className="mt-4 space-y-2">
                {FEES.map((s, i) => (
                  <li key={s.t} className="spv-tick flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm" style={delay(i * 0.9)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-red-400/15 text-red-300">
                        <CircleAlert className="size-3" aria-hidden />
                      </span>
                      <span className="truncate text-zinc-300">{s.t}</span>
                    </span>
                    <span className="font-medium text-red-300 tabular">{usdCents.format(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Plan ahead: safe to spend, subscriptions, budgets */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <SectionTitle eyebrow="Plan ahead" title={<>Know what&apos;s left <span className="spv-shimmer">before you spend it.</span></>} />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {/* Safe to spend */}
            <div className={TILE}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-emerald-300/80 uppercase">
                  <Wallet className="size-3.5 shrink-0" aria-hidden /> Safe to spend
                </p>
                <ExampleTag />
              </div>
              <p className="spv-pop mt-4 text-4xl font-semibold tracking-tight text-emerald-300 tabular">{usd.format(1240)}</p>
              <p className="mt-1 text-sm text-zinc-400">left through November 30</p>
              <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                <div className="spv-fill bg-zinc-400" style={{ width: `${(1786 / 3200) * 100}%`, ...delay(0) }} />
                <div className="spv-fill bg-violet-400" style={{ width: `${(174 / 3200) * 100}%`, ...delay(0.3) }} />
                <div className="spv-fill bg-emerald-400" style={{ width: `${(1240 / 3200) * 100}%`, ...delay(0.6) }} />
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                {[
                  { t: "Monthly budget", v: 3200, c: "text-zinc-200" },
                  { t: "Spent so far", v: -1786, c: "text-zinc-400" },
                  { t: "Bills & subscriptions still due", v: -174, c: "text-violet-300" },
                ].map((r) => (
                  <div key={r.t} className="flex justify-between gap-3">
                    <dt className="min-w-0 text-zinc-400">{r.t}</dt>
                    <dd className={`font-medium tabular ${r.c}`}>
                      {r.v < 0 ? "− " : ""}
                      {usd.format(Math.abs(r.v))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Subscriptions */}
            <div className={TILE}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-violet-300/80 uppercase">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden /> Subscriptions
                </p>
                <ExampleTag />
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight tabular">
                {usdCents.format(96.47)}
                <span className="text-base font-normal text-zinc-500">/mo</span>
              </p>
              <p className="mt-1 text-sm text-zinc-400">{usdCents.format(1157.64)} a year</p>
              <ul className="mt-4 space-y-2">
                {SUBS.map((s, i) => (
                  <li key={s.t} className="spv-in flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm" style={delay(0.2 + i * 0.15)}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-zinc-200">{s.t}</span>
                        {s.tag && (
                          <span
                            className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                              s.tag === "New" ? "bg-sky-400/15 text-sky-300" : "spv-flag bg-red-400/15 text-red-300"
                            }`}
                          >
                            {s.tag}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">{s.note}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular">{usdCents.format(s.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-zinc-400">Spots free trials that turned paid, and links to each service&apos;s own page to cancel.</p>
            </div>

            {/* Budgets */}
            <div className={TILE}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Budgets</p>
                <ExampleTag />
              </div>
              <ul className="mt-4 space-y-4">
                {BUDGETS.map((b, i) => {
                  const over = b.spent > b.budget;
                  return (
                    <li key={b.key} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-zinc-300">{CATEGORY_META[b.key].label}</span>
                        <span className={`shrink-0 tabular ${over ? "font-medium text-red-300" : "text-zinc-400"}`}>
                          {usd.format(b.spent)} / {usd.format(b.budget)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5" aria-hidden>
                        <div
                          className="spv-fill h-full rounded-full"
                          style={{
                            width: `${Math.min(1, b.spent / b.budget) * 100}%`,
                            background: over ? "#f87171" : CATEGORY_META[b.key].color,
                            ...delay(0.2 + i * 0.25),
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-5 flex gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-zinc-300">
                <Check className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                <span>Budgets are suggested from your last 3 months. Accept them as they are, or tweak.</span>
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.t} className="spv-tile min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
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
              <p className="mt-3 max-w-2xl text-zinc-400">
                No bank connection, no inbox access. You decide exactly what SpendVault sees. Here is everything it does with it.
              </p>
              <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {PRIVACY.map((p) => (
                  <li key={p.t} className="flex gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10">
                      <p.icon className="size-4.5 text-amber-300" aria-hidden />
                    </span>
                    <div className="min-w-0">
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
            <p className="mx-auto mt-4 max-w-xl text-zinc-400">
              Statements, alerts and receipts in one place. Free while in early access. Not financial advice, just a clear view of your own money.
            </p>
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
    <div
      className="relative mx-auto w-full max-w-md min-w-0"
      role="img"
      aria-label="Example: a statement, a purchase alert and a receipt forwarded from an inbox become a spending dashboard"
    >
      {/* Inbox */}
      <div className="spv-tilt relative z-10 mx-2 rounded-2xl border border-white/10 bg-zinc-900/90 p-3 shadow-2xl backdrop-blur sm:mx-6">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <Mail className="size-3.5" aria-hidden /> Inbox
          </p>
          <ExampleTag />
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
                  <m.icon className="size-3 shrink-0" aria-hidden /> {m.subject} · {m.kind}
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
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-3xl font-semibold tracking-tight tabular">{usd.format(3486)}</p>
            <span className="spv-in inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300" style={delay(1.2)}>
              <BadgeCheck className="size-3" aria-hidden /> Reconciled
            </span>
          </div>
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
                <span className="font-medium tabular">{usd.format(d.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="spv-alert mt-4 flex gap-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm">
            <Bell className="mt-0.5 size-4 shrink-0 text-red-300" />
            <p>
              <span className="font-medium text-red-100">Food delivery is up 62%</span>
              <span className="text-zinc-400"> this month vs your usual {usd.format(375)}.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One card charge + its receipt: the receipt is scanned line by line, matched, then split by category. 10s loop, example data. */
function ReceiptStage() {
  const groups = RECEIPT_GROUPS.map((g, gi) => ({
    ...g,
    amount: Math.round(RECEIPT_ITEMS.filter((it) => it.group === gi).reduce((s, it) => s + it.amount, 0) * 100) / 100,
  }));
  return (
    <div
      className="relative mx-auto w-full max-w-md min-w-0"
      role="img"
      aria-label={`Example: a ${usdCents.format(RECEIPT_TOTAL)} Target card charge matched to its receipt and split into snacks, household and kids clothing`}
    >
      {/* Card transaction */}
      <div className="relative z-10 mx-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl backdrop-blur sm:mx-6">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-300">
            <Wallet className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] text-zinc-200">TARGET T-1432</span>
            <span className="block truncate text-[11px] text-zinc-500">Visa •• 4417 · Nov 14</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular">{usdCents.format(RECEIPT_TOTAL)}</span>
          <span className="spv-cycle inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300" style={delay(4.2)}>
            <BadgeCheck className="size-3" aria-hidden /> Receipt matched
          </span>
        </span>
      </div>

      {/* Receipt paper */}
      <div className="spv-float">
        <div className="spv-receipt relative mx-4 -mt-2 overflow-hidden rounded-b-xl border border-t-0 border-white/10 bg-zinc-100 px-4 pt-6 pb-5 text-zinc-800 shadow-[0_30px_80px_-30px_rgba(251,191,36,.35)] sm:mx-10">
          <span className="spv-scan pointer-events-none absolute inset-x-0 h-8" aria-hidden />
          <div className="flex items-center justify-between gap-2 border-b border-dashed border-zinc-400 pb-2">
            <p className="font-mono text-xs font-semibold tracking-widest uppercase">Target</p>
            <p className="font-mono text-[10px] text-zinc-500">11/14 · 6:42 PM</p>
          </div>
          <ul className="mt-2 space-y-1">
            {RECEIPT_ITEMS.map((it, i) => (
              <li key={it.t} className="spv-cycle flex items-center justify-between gap-2 font-mono text-[11px] sm:text-xs" style={delay(0.4 + i * 0.45)}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: RECEIPT_GROUPS[it.group].color }} aria-hidden />
                  <span className="truncate">{it.t}</span>
                </span>
                <span className="shrink-0 tabular">{it.amount.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-dashed border-zinc-400 pt-2 font-mono text-xs font-semibold">
            <span>TOTAL</span>
            <span className="tabular">{RECEIPT_TOTAL.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Split */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-zinc-900/80 p-4 backdrop-blur">
        <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">What that charge really was</p>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
          {groups.map((g, i) => (
            <div key={g.t} className="spv-fill" style={{ width: `${(g.amount / RECEIPT_TOTAL) * 100}%`, background: g.color, ...delay(5 + i * 0.3) }} />
          ))}
        </div>
        <ul className="mt-3 space-y-1.5">
          {groups.map((g, i) => (
            <li key={g.t} className="spv-cycle flex items-center justify-between gap-3 text-sm" style={delay(5.2 + i * 0.3)}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
                <span className="truncate text-zinc-300">{g.t}</span>
              </span>
              <span className="font-medium tabular">{usdCents.format(g.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
