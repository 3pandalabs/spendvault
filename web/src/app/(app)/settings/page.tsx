"use client";

import { Download, LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCOUNT_TABS, SubTabs } from "@/components/app-ui";
import { ErrorText, Field, PageHeader, Panel, PanelTitle, Spinner, Toggle, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, clearTokens, deleteMe, downloadAuthed, errorMessage, exportMe, logout, updateMe } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Currency, MePatch } from "@/lib/types";

export default function SettingsPage() {
  const { me, setMe } = useSession();
  const router = useRouter();
  const [name, setName] = useState(me.displayName);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState(false);

  async function patch(field: string, b: MePatch) {
    setSaving(field);
    setError(null);
    try {
      setMe(await updateMe(b));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" subtitle={me.email} />
      <SubTabs label="Account" items={ACCOUNT_TABS} />
      <div className="max-w-2xl space-y-4">
        <Panel>
          <PanelTitle>Profile</PanelTitle>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setSavedName(false);
              if (await patch("name", { displayName: name.trim() })) setSavedName(true);
            }}
          >
            <Field label="Name" htmlFor="name" className="min-w-0 flex-1">
              <Input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" variant="outline" disabled={saving === "name" || name.trim() === me.displayName}>
              {saving === "name" ? <Spinner /> : null} Save
            </Button>
          </form>
          {savedName ? <p className="mt-2 text-sm text-down">Saved.</p> : null}
          <Field label="Currency for totals" htmlFor="currency" className="mt-4" hint="Which currency the dashboard and savings totals use.">
            <select
              id="currency"
              className={`${selectClass} sm:w-60`}
              value={me.baseCurrency}
              disabled={saving === "currency"}
              onChange={(e) => patch("currency", { baseCurrency: e.target.value as Currency })}
            >
              <option value="USD">US dollar ($)</option>
              <option value="INR">Indian rupee (₹)</option>
            </select>
          </Field>
        </Panel>

        <Panel>
          <PanelTitle>Preferences</PanelTitle>
          <div className="divide-y divide-line">
            <Toggle
              id="alert-emails"
              label="Email me spending alerts"
              description="A short email when we spot a spike, a new fee or a price hike."
              checked={me.alertEmails}
              disabled={saving === "alerts"}
              onChange={(v) => patch("alerts", { alertEmails: v })}
            />
            <Toggle
              id="delete-originals"
              label="Delete original files after reading"
              description="Recommended. We keep only the extracted transactions and receipt items. Turn off to keep statements and receipt photos so you can re-read or view them later."
              checked={me.deleteOriginals}
              disabled={saving === "originals"}
              onChange={(v) => patch("originals", { deleteOriginals: v })}
            />
          </div>
        </Panel>
        <ErrorText>{error}</ErrorText>

        <ExportPanel />
        <DeletePanel
          onDeleted={() => {
            clearTokens();
            // Hard navigation: the shell would otherwise race us to /login.
            window.location.replace("/?deleted=1");
          }}
        />

        <Button
          variant="ghost"
          onClick={async () => {
            await logout().catch(() => undefined);
            router.replace("/login");
          }}
        >
          <LogOut /> Sign out
        </Button>
      </div>
    </>
  );
}

function ExportPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = () => new Date().toISOString().slice(0, 10);

  async function csv(key: string, path: string, name: string) {
    setBusy(key);
    setError(null);
    try {
      await downloadAuthed(path, `${name}-${day()}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("json");
    setError(null);
    try {
      const data = await exportMe();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spendvault-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelTitle>Your data is yours</PanelTitle>
      <p className="text-sm text-fg-muted">
        Take it with you any time, no questions asked. CSV files open in Excel, Google Sheets or Numbers; the full export has every transaction,
        account, alert and receipt (with line items) as JSON.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => csv("txns", "/me/export/transactions.csv", "spendvault-transactions")} disabled={busy !== null}>
          {busy === "txns" ? <Spinner /> : <Download />} Transactions (CSV)
        </Button>
        <Button variant="outline" onClick={() => csv("items", "/me/export/receipt-items.csv", "spendvault-receipt-items")} disabled={busy !== null}>
          {busy === "items" ? <Spinner /> : <Download />} Receipt items (CSV)
        </Button>
        <Button variant="ghost" onClick={download} disabled={busy !== null}>
          {busy === "json" ? <Spinner /> : <Download />} Everything (JSON)
        </Button>
      </div>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}

function DeletePanel({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteMe(password);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 && err.code !== "session_ended" ? "That password is wrong." : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Panel className="border-red-400/30">
      <PanelTitle>Delete account</PanelTitle>
      <p className="text-sm text-fg-muted">
        Permanently deletes your account and everything in it: documents, receipts, transactions, saved passwords, alerts and your WhatsApp link. This
        can&apos;t be undone. Export first if you want a copy.
      </p>
      {!open ? (
        <Button variant="destructive" className="mt-3" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="Enter your password to confirm" htmlFor="del-pw">
            <Input id="del-pw" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password}>
              {busy ? <Spinner /> : null} Delete everything
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
