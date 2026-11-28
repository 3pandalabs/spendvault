"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Eyebrow } from "@/components/app-ui";
import { EmptyState, ErrorText, LoadError, Loading, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { errorMessage, getMe, joinHousehold, previewHouseholdInvite } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";

export default function JoinHouseholdPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Join />
    </Suspense>
  );
}

const CODE_COPY: Record<string, string> = {
  invalid_or_expired_token: "This invite has expired or was already used. Ask for a new one.",
  wrong_account: "This invite was sent to a different email address. Sign out and sign in (or sign up) with that address to join.",
  already_in_household: "You're already in a household. Leave it in Settings → Household first.",
};

function Join() {
  const token = useSearchParams().get("token") ?? "";
  const { me, setMe } = useSession();
  const router = useRouter();
  const preview = useAsync(() => previewHouseholdInvite(token), token ? `invite:${token}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return <EmptyState icon={<Users />} title="No invite link" body="Open the link from your invite email." />;
  if (preview.error) return <LoadError error={preview.error} onRetry={preview.reload} />;
  if (!preview.data) return <Loading />;
  const p = preview.data;

  return (
    <div className="mx-auto max-w-lg py-6">
      <section className="spa-tile spa-glow spa-in rounded-2xl p-6">
        <Eyebrow>Household invite</Eyebrow>
        <p className="spa-display mt-2 text-2xl font-bold">
          {p.invitedBy ? `${p.invitedBy} invited you to ${p.householdName ?? "their household"}` : `Join ${p.householdName ?? "a household"}`}
        </p>
        {p.valid ? (
          <>
            <p className="mt-2 text-sm text-fg-muted">
              If you join, you and the other members see each other&apos;s transactions in a combined Overview and Transactions list. Your statements,
              receipts, alerts, budgets and settings stay your own. You can leave at any time in Settings → Household.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="spa-shine"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await joinHousehold(token);
                    setMe(await getMe());
                    router.replace("/household");
                  } catch (e) {
                    setError(errorMessage(e));
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Spinner /> : <Users />} Join
              </Button>
              <Link href="/dashboard">
                <Button variant="ghost">Not now</Button>
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-amber-200">
            {CODE_COPY[p.code ?? ""] ?? "This invite can't be used."} {p.code === "wrong_account" ? `(You're signed in as ${me.email}.)` : null}
          </p>
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </section>
    </div>
  );
}
