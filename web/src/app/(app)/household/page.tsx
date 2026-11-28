"use client";

import { LogOut, Mail, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ACCOUNT_TABS, Eyebrow, SubTabs } from "@/components/app-ui";
import { EmptyState, ErrorText, LoadError, PageHeader, Panel, PanelTitle, Skeleton, Spinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelHouseholdInvite, errorMessage, getHousehold, getMe, inviteToHousehold, leaveHousehold } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Household } from "@/lib/types";

export default function HouseholdPage() {
  const { me } = useSession();
  const enabled = me.features?.household ?? false;
  const h = useAsync(getHousehold, enabled ? "household" : null);
  return (
    <>
      <PageHeader eyebrow="Settings" title="Household" subtitle="Share a combined view of spending with your partner." />
      <SubTabs label="Account" items={ACCOUNT_TABS} />
      {!enabled ? (
        <EmptyState icon={<Users />} title="Shared households aren't switched on yet" body="Check back soon." />
      ) : h.error ? (
        <LoadError error={h.error} onRetry={h.reload} />
      ) : !h.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <Body household={h.data.household} reload={h.reload} />
      )}
    </>
  );
}

function Body({ household: h, reload }: { household: Household | null; reload: () => void }) {
  const { setMe } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      reload();
      // Overview/Transactions read me.household for the "Household" view switch.
      getMe().then(setMe, () => undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-5 sm:p-6">
        <Eyebrow>{h ? h.name : "Couples"}</Eyebrow>
        <p className="spa-display mt-2 text-2xl font-bold sm:text-3xl">{h ? `${h.members.length} ${h.members.length === 1 ? "person" : "people"}` : "One view for two"}</p>
        <p className="mt-2 max-w-xl text-sm text-fg-muted">
          Members see each other&apos;s transactions in a combined Overview and Transactions list, with a filter for each person. Statements, receipts,
          alerts, budgets, net worth and settings stay your own. Anyone can leave at any time, and their transactions stop being shared straight away.
        </p>
        {h ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/dashboard?view=household">
              <Button size="sm" className="spa-shine">
                Open household overview
              </Button>
            </Link>
            <Link href="/transactions?scope=household">
              <Button size="sm" variant="outline">
                Household transactions
              </Button>
            </Link>
          </div>
        ) : null}
      </section>

      {h ? (
        <Panel>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <Users className="size-4" aria-hidden /> Members
            </span>
          </PanelTitle>
          <ul className="divide-y divide-line">
            {h.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.displayName} {m.isMe ? <span className="text-fg-muted">(you)</span> : null}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{m.email}</p>
                </div>
                {m.role === "owner" ? <Badge variant="muted">Owner</Badge> : null}
              </li>
            ))}
            {h.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-fg-muted">Invited · link expires {fmtDate(i.expiresAt.slice(0, 10))}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Cancel invite to ${i.email}`} disabled={busy !== null} onClick={() => act(i.id, () => cancelHouseholdInvite(i.id))}>
                  {busy === i.id ? <Spinner /> : <X />} Cancel
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <UserPlus className="size-4" aria-hidden /> Invite your partner
          </span>
        </PanelTitle>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            void act(
              "invite",
              async () => {
                const r = await inviteToHousehold(email.trim());
                setEmail("");
                if (!r.emailed) throw new Error("Invite saved, but the email didn't go out. Try again in a few minutes.");
              },
              "Invite sent. It works for 7 days.",
            );
          }}
        >
          <Input type="email" autoComplete="off" aria-label="Partner's email" placeholder="partner@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1" />
          <Button type="submit" disabled={busy !== null || !email.trim()}>
            {busy === "invite" ? <Spinner /> : <Mail />} Send invite
          </Button>
        </form>
        <p className="mt-2 text-xs text-fg-muted">They need a SpendVault account with this email address. They join by opening the link and pressing Join; nothing is shared until they do.</p>
      </Panel>

      {notice ? <p className="text-sm text-down">{notice}</p> : null}
      <ErrorText>{error}</ErrorText>

      {h ? (
        <div>
          {!confirmLeave ? (
            <Button variant="ghost" onClick={() => setConfirmLeave(true)}>
              <LogOut /> Leave household
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm">
              <span className="font-medium text-red-200">Leave {h.name}? Your transactions stop being shared.</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => act("leave", leaveHousehold, "You left the household.")}>
                  {busy === "leave" ? <Spinner /> : null} Leave
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
