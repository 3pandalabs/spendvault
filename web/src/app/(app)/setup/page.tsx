"use client";

import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Lock,
  Mail,
  MessageCircle,
  Share2,
  Smartphone,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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

export default function SetupPage() {
  const { me } = useSession();
  const steps = [
    { done: me.setup.forwardingConfirmed, label: "Gmail forwarding" },
    { done: me.setup.hasPasswords, label: "PDF passwords" },
    { done: me.setup.hasDocuments, label: "First statement" },
  ];
  return (
    <>
      <PageHeader title="Setup" subtitle="Three short steps. After that, new statements arrive and get read on their own." />
      <ol className="mb-5 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Badge variant={s.done ? "good" : "outline"}>
              {s.done ? <CheckCircle2 className="size-3" /> : <span className="tabular">{i + 1}</span>} {s.label}
            </Badge>
          </li>
        ))}
      </ol>
      <div className="space-y-4">
        <ForwardingCard />
        <PasswordsCard />
        <WhatsappCard />
        <InstallCard />
      </div>
    </>
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
    <Panel>
      <CardHead
        icon={<Mail />}
        title="1. Forward statements from Gmail"
        sub="A Gmail filter sends only bank and card emails to your private SpendVault address. We never see anything else in your inbox."
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
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">Gmail sent a confirmation code</p>
              <p className="text-sm text-amber-900/80">Paste it into Gmail&apos;s forwarding settings, or open the confirm link.</p>
              <ul className="mt-3 space-y-3">
                {f.confirmations.map((c) => (
                  <li key={c.id} className="rounded-lg bg-white p-3">
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
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
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
            <Link href="/documents" className="text-accent hover:underline">
              Documents
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
    <Panel>
      <CardHead
        icon={<KeyRound />}
        title="2. Save your PDF passwords"
        sub="Most Indian banks lock statement PDFs. Save the password once and we'll open every future statement automatically."
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
          <Field label="Label" htmlFor="pw-label" hint="So you can tell them apart, e.g. “HDFC Regalia”.">
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
          <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
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
        title="3. Send statements on WhatsApp"
        sub="Link your number once, then forward any statement PDF to our WhatsApp number. Optional."
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
              <Button className="bg-[#1a7f4b]">
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
