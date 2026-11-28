"use client";

import {
  BellRing,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileUp,
  KeyRound,
  Lock,
  Mail,
  MessageCircle,
  ReceiptText,
  Share2,
  Smartphone,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCOUNT_TABS, SubTabs } from "@/components/app-ui";
import { AddReceiptButton } from "@/components/receipts";
import { CopyButton, ErrorText, Field, LoadError, Loading, Panel, PageHeader, Spinner, selectClass } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addPassword,
  deletePassword,
  errorMessage,
  getForwarding,
  linkWhatsapp,
  listInstitutions,
  listPasswords,
  unlinkWhatsapp,
} from "@/lib/api";
import { fmtTimestamp } from "@/lib/format";
import { useAsync, usePoll } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { WhatsappLink } from "@/lib/types";
import { cn } from "@/lib/utils";

// Purchase-alert setup per US bank. Menu names move between app versions, so
// each guide names the screen to look for rather than exact taps.
const US_ALERT_GUIDES: Array<{ bank: string; steps: string[] }> = [
  {
    bank: "Chase",
    steps: [
      "In the Chase app, tap the profile icon, then Alerts (on chase.com: Profile & settings › Alerts).",
      "Pick your card or checking account, then the purchase / transaction alert (\"Card transaction over\").",
      "Set the amount to $0.01 and choose Email.",
    ],
  },
  {
    bank: "American Express",
    steps: [
      "In the Amex app, open Account › Notification settings (on americanexpress.com: Account Services › Alerts).",
      "Turn on the purchase alert (\"Large purchase\" / \"Purchase over\").",
      "Set the amount to $0.01 (or the lowest it allows) and turn on Email.",
    ],
  },
  {
    bank: "Capital One",
    steps: [
      "In the Capital One app, open Profile › Settings › Alerts, then pick your card.",
      "Turn on the alert for purchases over an amount (or all transactions, if offered).",
      "Set the amount to $0.01 and choose Email.",
    ],
  },
  {
    bank: "Citi",
    steps: [
      "On citi.com or the Citi app, open Profile › Manage alerts.",
      "Under Transactions, turn on \"Purchase / transaction exceeds\".",
      "Set the lowest amount it allows ($0.01 or $1) and send it to Email.",
    ],
  },
  {
    bank: "Bank of America",
    steps: [
      "In the BofA app, open Menu › Security & alerts › Alerts (on the website: Alerts › Settings).",
      "Pick the card or account and turn on the purchase / card-used alert.",
      "Set the amount to $0.01 and choose Email.",
    ],
  },
  {
    bank: "Wells Fargo",
    steps: [
      "In the Wells Fargo app, open Menu › Settings › Alerts (on the website: Account Services › Manage alerts).",
      "Pick the card or account and turn on \"Purchases and withdrawals over\".",
      "Set the amount to $0.01 and choose Email.",
    ],
  },
  {
    bank: "Discover",
    steps: [
      "In the Discover app, open Profile › Alerts (on discover.com: Manage › Alerts).",
      "Turn on the transaction / purchase amount alert.",
      "Set the amount to $0.00 or $0.01 and choose Email.",
    ],
  },
];

// Where each US bank keeps "download activity". CSV is the most reliable format to upload.
const US_CSV_TIPS: Array<[string, string]> = [
  ["Chase", "Account › Download account activity › CSV"],
  ["American Express", "Statements & Activity › Download › CSV"],
  ["Capital One", "View transactions › Download transactions › CSV"],
  ["Citi", "Account › Download transactions › CSV"],
  ["Bank of America", "Account activity › Download transactions › Microsoft Excel / CSV"],
  ["Wells Fargo", "Account activity › Download account activity › Comma delimited"],
  ["Discover", "Activity › Download › CSV"],
];

export default function SetupPage() {
  const { me } = useSession();
  const steps = [
    { done: me.setup.forwardingConfirmed, label: "Gmail forwarding", href: "#forwarding" },
    { done: false, label: "Purchase alerts", href: "#alerts" },
    { done: me.setup.hasDocuments, label: "First statement", href: "#statements" },
    { done: false, label: "Receipts", href: "#receipts" },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title={
          <>
            Set it up once, <span className="spa-shimmer">then it runs itself</span>
          </>
        }
        subtitle="Forward statements and purchase alerts from Gmail, add receipts when you want item-level detail. Nothing here asks for your bank login."
      />
      <SubTabs label="Account" items={ACCOUNT_TABS} />
      <ol className="mb-5 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <a href={s.href}>
              <Badge variant={s.done ? "good" : "outline"} className="hover:bg-white/5">
                {s.done ? <CheckCircle2 className="size-3" /> : <span className="tabular">{i + 1}</span>} {s.label}
              </Badge>
            </a>
          </li>
        ))}
      </ol>
      <div className="space-y-4">
        <ForwardingCard />
        <PurchaseAlertsCard />
        <StatementsCard />
        <ReceiptsCard />
        <PasswordsCard />
        <WhatsappCard />
        <InstallCard />
      </div>
    </>
  );
}

function PurchaseAlertsCard() {
  const [open, setOpen] = useState<string | null>("Chase");
  return (
    <Panel id="alerts" className="scroll-mt-24">
      <CardHead
        icon={<BellRing />}
        title="2. Turn on purchase alerts"
        sub="Statements arrive once a month. A purchase alert set to $0.01 emails you every charge as it happens, and the Gmail filter above forwards it, so your dashboard stays current all month."
      />
      <p className="mb-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-sm text-emerald-100/90">
        Send the alerts to the same Gmail address that has the SpendVault filter. When the monthly statement arrives later, it replaces the alert rows
        so nothing is counted twice.
      </p>
      <ul className="divide-y divide-line rounded-xl border border-white/10">
        {US_ALERT_GUIDES.map((g) => {
          const expanded = open === g.bank;
          return (
            <li key={g.bank}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm font-medium hover:bg-white/[0.03]"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : g.bank)}
              >
                {g.bank}
                <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
              {expanded ? (
                <ol className="spa-fade space-y-2 px-3 pb-3">
                  {g.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg tabular">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 text-fg-muted">{s}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-muted">
        Menu names change between app versions: look for Alerts, then a purchase or transaction alert with an amount. Other US banks (U.S. Bank,
        PNC, USAA, Navy Federal…) have the same setting.
      </p>
      <details className="mt-3 rounded-xl bg-bg-subtle p-3 text-sm">
        <summary className="cursor-pointer font-medium">Banks in India</summary>
        <p className="mt-2 text-fg-muted">
          Indian banks already send an alert for every card and UPI transaction. Make sure email alerts (not just SMS) are on: in net banking, check
          that your Gmail address is registered and transaction alerts by email are enabled. HDFC, ICICI, SBI Card, Axis and Kotak alert emails are
          read automatically.
        </p>
      </details>
    </Panel>
  );
}

function StatementsCard() {
  return (
    <Panel id="statements" className="scroll-mt-24">
      <CardHead
        icon={<Download />}
        title="3. Add your first statement"
        sub="Gmail forwards only new mail. For past months, or when your bank only emails “your statement is ready” with no file, download it from the bank's website and upload it."
      />
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-sm font-medium">Download activity as CSV (most reliable)</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-white/10 text-sm">
            {US_CSV_TIPS.map(([bank, path]) => (
              <li key={bank} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="font-medium">{bank}</span>
                <span className="text-xs text-fg-muted sm:text-right">{path}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3 text-sm">
          <p className="text-fg-muted">
            PDF statements work too, and so do Excel exports. Pick a date range that covers the months you want; up to 10 files at a time.
          </p>
          <p className="text-fg-muted">Indian banks: download the e-statement PDF from net banking. Save its password below once.</p>
          <Link href="/documents">
            <Button variant="outline">
              <FileUp /> Upload in Inbox
            </Button>
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function ReceiptsCard() {
  const { me } = useSession();
  const router = useRouter();
  const ways = [
    { icon: <Camera />, t: "Snap it", b: "Photo of a paper receipt. On a phone the button opens the camera." },
    { icon: <FileUp />, t: "Upload", b: "Screenshots and PDF e-bills, several at once." },
    { icon: <Mail />, t: "Forward", b: "Order confirmations and e-receipts to your SpendVault address." },
    { icon: <Share2 />, t: "Share", b: "On Android, Share a photo or screenshot to SpendVault." },
  ];
  return (
    <div id="receipts" className="spa-ring scroll-mt-24">
      <section className="bg-zinc-950/95 p-4 sm:p-5">
        <CardHead
          icon={<ReceiptText />}
          title="4. Add receipts for item-level detail"
          sub="Optional, and the best part. A receipt matched to its charge splits it by what you bought, so a Target charge shows up as groceries and household, not just “shopping”."
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {ways.map((w) => (
            <li key={w.t} className="flex gap-3 rounded-xl bg-white/[0.03] p-3 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300 [&_svg]:size-4">{w.icon}</span>
              <span className="min-w-0">
                <span className="font-medium">{w.t}</span>
                <span className="block text-xs text-fg-muted">{w.b}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs break-all">{me.forwardingAddress}</code>
          <CopyButton value={me.forwardingAddress} />
        </div>
        <div className="mt-4 flex justify-start">
          <AddReceiptButton onUploaded={() => router.push("/receipts")} />
        </div>
      </section>
    </div>
  );
}

function CardHead({ icon, title, sub, done }: { icon: React.ReactNode; title: string; sub: string; done?: boolean }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {title}
          {done ? (
            <Badge variant="good">
              <CheckCircle2 className="size-3" /> Done
            </Badge>
          ) : null}
        </h2>
        <p className="text-sm text-fg-muted">{sub}</p>
      </div>
    </div>
  );
}

function ForwardingCard() {
  const { me, refresh } = useSession();
  const fwd = useAsync(getForwarding, "forwarding");
  // Poll while the page is open: the Gmail confirmation code arrives by email.
  usePoll(
    () => {
      fwd.reload();
      if (!me.setup.forwardingConfirmed) refresh();
    },
    5000,
    !fwd.error,
  );
  const f = fwd.data;

  return (
    <Panel id="forwarding" className="scroll-mt-24">
      <CardHead
        icon={<Mail />}
        title="1. Forward statements from Gmail"
        sub="One Gmail filter sends only bank and card emails (statements and purchase alerts, US and Indian banks) to your private SpendVault address. We never see anything else in your inbox."
        done={me.setup.forwardingConfirmed}
      />
      {fwd.error && !f ? (
        <LoadError error={fwd.error} onRetry={fwd.reload} />
      ) : !f ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium">Your forwarding address</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded-lg bg-bg-subtle px-3 py-2 text-sm">{f.address}</code>
              <CopyButton value={f.address} />
            </div>
            <p className="mt-1 text-xs text-fg-muted">Keep it private. Anything sent to it lands in your account.</p>
          </div>

          {f.confirmations.length > 0 ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="text-sm font-medium text-amber-200">Gmail sent a confirmation code</p>
              <p className="text-sm text-amber-200/80">Paste it into Gmail&apos;s forwarding settings, or open the confirm link.</p>
              <ul className="mt-3 space-y-3">
                {f.confirmations.map((c) => (
                  <li key={c.id} className="rounded-lg bg-white/5 p-3">
                    {c.code ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-3xl font-semibold tracking-widest tabular">{c.code}</span>
                        <CopyButton value={c.code} label="Copy code" />
                      </div>
                    ) : null}
                    {c.confirmUrl ? (
                      <a
                        href={c.confirmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline"
                      >
                        Open the confirm link <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                    <p className="mt-1 text-xs text-fg-muted">
                      {c.forwardFrom ? `For ${c.forwardFrom} · ` : ""}
                      {fmtTimestamp(c.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : !me.setup.forwardingConfirmed ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Spinner /> Waiting for Gmail&apos;s confirmation email. The code will appear here.
            </p>
          ) : null}

          <ol className="space-y-2.5">
            {f.gmailSteps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg tabular">
                  {i + 1}
                </span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>

          <div>
            <p className="text-sm font-medium">Gmail filter search</p>
            <p className="text-xs text-fg-muted">Paste this into the &ldquo;Has the words&rdquo; box when you create the filter.</p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-bg-subtle p-3 text-xs whitespace-pre-wrap break-all">{f.gmailFilterQuery}</pre>
            <CopyButton value={f.gmailFilterQuery} label="Copy filter" className="mt-2" />
          </div>
          <p className="text-xs text-fg-muted">
            Tip: in the filter, also tick &ldquo;Also apply filter to matching conversations&rdquo; only if you want old statements imported too.
            Gmail forwards only new mail; for older statements, forward them by hand or upload them in{" "}
            <Link href="/documents" className="text-accent-strong hover:underline">
              the Inbox
            </Link>
            .
          </p>
        </div>
      )}
    </Panel>
  );
}

function PasswordsCard() {
  const { refresh } = useSession();
  const pw = useAsync(listPasswords, "passwords");
  const inst = useAsync(listInstitutions, "institutions");
  const [form, setForm] = useState({ institution: "", label: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const institutions = inst.data?.items ?? [];
  const selected = institutions.find((i) => i.key === form.institution);
  const nameOf = (key: string | null) => institutions.find((i) => i.key === key)?.name ?? key ?? "Any bank";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await addPassword({
        institution: form.institution || null,
        label: form.label.trim() || (selected ? selected.name : "PDF password"),
        password: form.password,
      });
      setForm({ institution: "", label: "", password: "" });
      setSaved(true);
      pw.reload();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      await deletePassword(id);
      pw.reload();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Panel id="passwords" className="scroll-mt-24">
      <CardHead
        icon={<KeyRound />}
        title="PDF passwords"
        sub="US banks rarely lock statement PDFs; most Indian banks do. If yours does, save the password once and we'll open every future statement automatically."
        done={(pw.data?.items.length ?? 0) > 0}
      />
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-bg-subtle p-3 text-sm text-fg-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-accent" />
        Passwords are encrypted before they&apos;re stored and are never shown again, not even to you. They&apos;re used only to open your statements.
      </p>

      {pw.error ? (
        <LoadError error={pw.error} onRetry={pw.reload} />
      ) : !pw.data ? (
        <Loading />
      ) : pw.data.items.length > 0 ? (
        <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
          {pw.data.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.label}</p>
                <p className="text-xs text-fg-muted">
                  {nameOf(p.institution)} · {p.lastUsedAt ? `last used ${fmtTimestamp(p.lastUsedAt)}` : "not used yet"}
                </p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Delete ${p.label}`} onClick={() => remove(p.id)} disabled={deleting === p.id}>
                {deleting === p.id ? <Spinner /> : <Trash2 />}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={add} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank or card" htmlFor="pw-inst">
            <select
              id="pw-inst"
              className={selectClass}
              value={form.institution}
              onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
            >
              <option value="">Any bank (try on every locked PDF)</option>
              {institutions.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label" htmlFor="pw-label" hint="So you can tell them apart, e.g. “Chase Sapphire” or “HDFC Regalia”.">
            <Input
              id="pw-label"
              maxLength={80}
              placeholder={selected?.name ?? "My card"}
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </Field>
        </div>
        {selected?.passwordHint ? (
          <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-sky-200">
            <span className="font-medium">{selected.name}:</span> {selected.passwordHint}. Check the email your statement came in; banks
            spell out the format there.
          </p>
        ) : null}
        <Field label="PDF password" htmlFor="pw-secret">
          <Input
            id="pw-secret"
            type="password"
            required
            autoComplete="off"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        {saved ? (
          <p className="text-sm text-down" role="status">
            Saved. Any statements waiting for a password will be retried now.
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !form.password}>
          {busy ? <Spinner /> : null} Save password
        </Button>
      </form>
    </Panel>
  );
}

function WhatsappCard() {
  const { me, refresh } = useSession();
  const wa = me.whatsapp;
  const [link, setLink] = useState<WhatsappLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // While a code is showing, re-check /me so the card flips to "linked".
  usePoll(refresh, 5000, Boolean(link) && !wa.linkedPhone);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setLink(await linkWhatsapp());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await unlinkWhatsapp();
      setLink(null);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const number = link?.number ?? wa.number;
  const waDigits = number?.replace(/\D/g, "");

  return (
    <Panel>
      <CardHead
        icon={<MessageCircle />}
        title="WhatsApp"
        sub="Optional. Link your number once, then forward statement PDFs or receipt photos to our WhatsApp number."
        done={Boolean(wa.linkedPhone)}
      />
      {!wa.available ? (
        <p className="text-sm text-fg-muted">
          <Badge variant="muted">Coming soon</Badge> WhatsApp isn&apos;t switched on yet. Use Gmail forwarding or upload for now.
        </p>
      ) : wa.linkedPhone ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Linked to <span className="font-medium tabular">{wa.linkedPhone}</span>
            {number ? (
              <>
                . Send statements to <span className="font-medium tabular">{number}</span>.
              </>
            ) : null}
          </p>
          <Button variant="outline" size="sm" onClick={unlink} disabled={busy}>
            {busy ? <Spinner /> : null} Unlink
          </Button>
        </div>
      ) : link ? (
        <div className="space-y-3">
          <p className="text-sm">Send this code to {number ? <span className="font-medium tabular">{number}</span> : "our WhatsApp number"} from your phone:</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-semibold tracking-wider">{link.code}</span>
            <CopyButton value={link.code} label="Copy code" />
          </div>
          {waDigits ? (
            <a href={`https://wa.me/${waDigits}?text=${encodeURIComponent(link.code)}`} target="_blank" rel="noopener noreferrer">
              <Button className="bg-[#1a7f4b] text-white hover:bg-[#166b3f]">
                <MessageCircle /> Open WhatsApp
              </Button>
            </a>
          ) : null}
          <p className="flex items-center gap-2 text-xs text-fg-muted" role="status">
            <Spinner className="size-3" /> Waiting for your message · code expires {fmtTimestamp(link.expiresAt)}
          </p>
        </div>
      ) : (
        <Button onClick={start} disabled={busy}>
          {busy ? <Spinner /> : <MessageCircle />} Link WhatsApp
        </Button>
      )}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}

function InstallCard() {
  return (
    <Panel>
      <CardHead
        icon={<Smartphone />}
        title="Install on your phone"
        sub="SpendVault works as an app from your home screen. No app store needed."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-bg-subtle p-4 text-sm">
          <p className="font-medium">Android (Chrome)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg-muted">
            <li>Open spendvault.3pandalabs.com in Chrome.</li>
            <li>Tap the ⋮ menu, then &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;.</li>
            <li>
              Now SpendVault shows up in the <Share2 className="inline size-3.5" /> share sheet. In your banking app, email or Files, tap Share on
              a statement and pick SpendVault.
            </li>
          </ol>
        </div>
        <div className="rounded-xl bg-bg-subtle p-4 text-sm">
          <p className="font-medium">iPhone (Safari)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg-muted">
            <li>Open spendvault.3pandalabs.com in Safari.</li>
            <li>Tap Share, then &ldquo;Add to Home Screen&rdquo;.</li>
            <li>
              iOS doesn&apos;t let web apps appear in the share sheet, so on iPhone use Gmail forwarding or WhatsApp to send statements.
            </li>
          </ol>
        </div>
      </div>
    </Panel>
  );
}
