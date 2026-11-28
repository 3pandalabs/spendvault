"use client";

import { PlusBadge, PlusRequiredNote } from "@/components/plus";
import { Download, LogOut, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCOUNT_TABS, SubTabs } from "@/components/app-ui";
import { ErrorText, Field, LoadError, PageHeader, Panel, PanelTitle, Skeleton, Spinner, Toggle, selectClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCategoryRule, ApiError, clearTokens, deleteCategoryRule, deleteMe, downloadAuthed, errorMessage, exportMe, listCategoryRules, logout, updateMe } from "@/lib/api";
import { CATEGORY_KEYS, categoryColor, categoryLabel } from "@/lib/categories";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { TAX_TAGS, type CategoryKey, type Currency, type MePatch } from "@/lib/types";

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

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
          <p className="mt-4 text-sm text-fg-muted">
            Dates use your time zone: <span className="text-fg">{me.timezone ?? browserZone() ?? (me.baseCurrency === "INR" ? "Asia/Kolkata" : "America/New_York")}</span>
            <span className="block text-xs">Set from this browser. It decides &quot;today&quot; for due dates, return windows and summary emails.</span>
          </p>
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
              id="digest-weekly"
              label="Weekly summary email"
              description="Monday morning: last week's spending vs the week before, top categories and card payments coming up."
              checked={me.digestWeekly ?? false}
              disabled={saving === "weekly"}
              onChange={(v) => patch("weekly", { digestWeekly: v })}
            />
            <Toggle
              id="digest-monthly"
              label="Monthly summary email"
              description="On the 1st: last month vs the month before, top categories, new subscriptions and upcoming card payments."
              checked={me.digestMonthly ?? true}
              disabled={saving === "monthly"}
              onChange={(v) => patch("monthly", { digestMonthly: v })}
            />
            {me.billing?.features.digests === false ? <PlusRequiredNote feature="digests" className="my-2" /> : null}
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

        <RulesPanel />
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
      <TaxExport busy={busy} onDownload={(path, name) => csv("tax", path, name)} />
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}

function TaxExport({ busy, onDownload }: { busy: string | null; onDownload: (path: string, name: string) => void }) {
  const { me } = useSession();
  const plusOnly = me.billing?.features.tax_export === false;
  const [thisYear] = useState(() => new Date().getFullYear());
  const [year, setYear] = useState(thisYear);
  const [tag, setTag] = useState("");
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">Tax export (CSV) {plusOnly ? <PlusBadge /> : null}</p>
      <p className="mt-0.5 text-sm text-fg-muted">
        Transactions and receipt items you tagged tax deductible, business or HSA/FSA eligible, for one year. Handy for your accountant; not tax advice.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Tax year" className={`${selectClass} w-28`} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={thisYear - n}>
              {thisYear - n}
            </option>
          ))}
        </select>
        <select aria-label="Tax tag" className={`${selectClass} w-48`} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tax tags</option>
          {TAX_TAGS.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => onDownload(`/me/export/tax.csv?year=${year}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`, `spendvault-tax-${year}${tag ? `-${tag}` : ""}`)}
        >
          {busy === "tax" ? <Spinner /> : <Download />} Download
        </Button>
      </div>
    </div>
  );
}

function RulesPanel() {
  const rules = useAsync(listCategoryRules, "category-rules");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState<CategoryKey>("groceries");
  const [applyToPast, setApplyToPast] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const add = useAction();
  const del = useAction();
  const items = rules.data?.items ?? [];
  return (
    <Panel>
      <PanelTitle>Category rules</PanelTitle>
      <p className="text-sm text-fg-muted">
        &quot;This merchant is always this category.&quot; Rules apply to every new statement. You also create one when you change a category on
        Transactions with &quot;Apply to all&quot; ticked.
      </p>
      {rules.error ? (
        <LoadError error={rules.error} onRetry={rules.reload} />
      ) : !rules.data ? (
        <Skeleton className="mt-3 h-16" />
      ) : items.length ? (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-white/10">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm capitalize">{r.merchant}</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(r.category) }} aria-hidden />
                <span className="truncate">{categoryLabel(r.category)}</span>
              </span>
              <button
                type="button"
                aria-label={`Delete rule for ${r.merchant}`}
                disabled={del.busy}
                className="shrink-0 rounded-full p-1.5 text-fg-muted hover:bg-white/10 hover:text-zinc-100"
                onClick={() =>
                  del.run(async () => {
                    await deleteCategoryRule(r.id);
                    rules.setData({ items: items.filter((x) => x.id !== r.id) });
                  }, errorMessage)
                }
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">No rules yet.</p>
      )}
      <ErrorText>{del.error}</ErrorText>
      <form
        className="mt-4 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setNotice(null);
          const m = merchant.trim();
          if (!m) return add.setError("Enter a merchant name, e.g. Trader Joe's.");
          await add.run(async () => {
            const r = await addCategoryRule({ merchant: m, category, applyToPast });
            setMerchant("");
            setNotice(applyToPast ? `Saved. ${r.updated} past transaction${r.updated === 1 ? "" : "s"} updated.` : "Saved.");
            rules.reload();
          }, errorMessage);
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
          <Input aria-label="Merchant" placeholder="Merchant, as shown on Transactions" maxLength={80} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          <select aria-label="Category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as CategoryKey)}>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(k)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" disabled={add.busy}>
            {add.busy ? <Spinner /> : <Plus />} Add rule
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" className="size-4 accent-accent" checked={applyToPast} onChange={(e) => setApplyToPast(e.target.checked)} />
          Apply to past transactions too (ones you set by hand stay as they are)
        </label>
        {notice ? <p className="text-sm text-down">{notice}</p> : null}
        <ErrorText>{add.error}</ErrorText>
      </form>
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
