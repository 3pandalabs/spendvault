"use client";

import {
  Camera,
  FileUp,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Settings,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, getMe, logout } from "@/lib/api";
import { setDisplayCurrency } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { SessionProvider, useSignedIn } from "@/lib/session";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorText, LoadError, Loading, Spinner } from "./common";
import { useReceiptPickers, useReceiptUpload } from "./receipts";
import { Logo } from "./Wordmark";

/** /login that comes back here afterwards. */
export function loginUrl() {
  const here = window.location.pathname + window.location.search;
  return here === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
}

type NavItem = { href: string; label: string; icon: typeof Inbox; also?: string[] };

// Organised around what you do: see it (Overview, Transactions), add detail
// (Receipts), check what came in (Inbox), act on it (Insights).
const MAIN: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/documents", label: "Inbox", icon: Inbox, also: ["/share"] },
  { href: "/alerts", label: "Insights", icon: TrendingUp, also: ["/savings", "/subscriptions", "/budgets"] },
  { href: "/net-worth", label: "Net worth", icon: Landmark },
];
const ACCOUNT: NavItem[] = [
  { href: "/setup", label: "Setup", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings, also: ["/household"] },
];
// Phones: four tabs + More (Inbox, Net worth, Setup, Settings live in the sheet).
const TABS = [MAIN[0], MAIN[1], MAIN[2], MAIN[4]];
const MORE = [MAIN[3], MAIN[5], ...ACCOUNT];

const match = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
const isActive = (pathname: string, item: NavItem) => [item.href, ...(item.also ?? [])].some((h) => match(pathname, h));

/**
 * Gate on what renders, NOT a security boundary: every request carries a
 * bearer token the API validates. No middleware (see ../../CLAUDE.md).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signedIn = useSignedIn();
  const me = useAsync(getMe, signedIn ? "me" : null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!signedIn) router.replace(loginUrl());
  }, [signedIn, router]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace(loginUrl());
  }, [me.error, router]);

  if (!signedIn) return null;
  // Dates/counts follow the base currency (en-US, or en-IN for INR). Set before
  // children render so the first paint already uses the right locale.
  if (me.data) setDisplayCurrency(me.data.baseCurrency);

  return (
    <div className="min-h-screen lg:pl-64">
      <Sidebar me={me.data} onAdd={() => setAddOpen(true)} />
      <TopBar onAdd={() => setAddOpen(true)} />
      <main className="spa-main mx-auto w-full max-w-6xl min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {me.data ? (
          <SessionProvider value={{ me: me.data, refresh: me.reload, setMe: me.setData }}>{children}</SessionProvider>
        ) : me.error ? (
          <LoadError error={me.error} onRetry={me.reload} />
        ) : (
          <Loading />
        )}
      </main>
      <TabBar />
      {addOpen ? <QuickAdd onClose={() => setAddOpen(false)} /> : null}
    </div>
  );
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    await logout().catch(() => undefined);
    router.replace("/login");
  };
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "spa-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
        active ? "bg-white/10 font-medium text-zinc-50" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active ? "text-amber-300" : "")} aria-hidden />
      {item.label}
    </Link>
  );
}

/** Desktop: fixed left rail with the wordmark, nav, an Add button and the account. */
function Sidebar({ me, onAdd }: { me: Me | undefined; onAdd: () => void }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-zinc-950/70 px-4 py-5 backdrop-blur-md lg:flex">
      <div className="px-2">
        <Logo href="/dashboard" stack="phone-lg" />
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="spa-shine mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 text-sm font-semibold text-zinc-950 shadow-[0_10px_30px_-12px_rgba(251,191,36,.8)] hover:bg-amber-300"
      >
        <Plus className="size-4" /> Add receipt or statement
      </button>
      <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
        {MAIN.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <p className="mt-7 mb-2 px-3 font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">Account</p>
      <nav aria-label="Account" className="flex flex-col gap-1">
        {ACCOUNT.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="mt-auto border-t border-white/10 pt-4">
        {me ? (
          <p className="truncate px-3 text-sm text-zinc-300" title={me.email}>
            {me.displayName || me.email}
            <span className="block truncate text-xs text-zinc-500">{me.email}</span>
          </p>
        ) : null}
        <button onClick={signOut} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

/** Phones and tablets: wordmark + Add. */
function TopBar({ onAdd }: { onAdd: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/70 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Logo href="/dashboard" stack="phone-lg" />
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a receipt or statement"
          className="spa-shine inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>
    </header>
  );
}

function TabBar() {
  const pathname = usePathname();
  const signOut = useSignOut();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((l) => isActive(pathname, l));

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const tab = "spa-tab relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium";
  const dot = <span className="spa-tab-dot absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-amber-300 to-emerald-300" aria-hidden />;

  return (
    <>
      {moreOpen ? (
        <Sheet title="More" onClose={() => setMoreOpen(false)}>
          <nav className="flex flex-col gap-1">
            {MORE.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} onClick={() => setMoreOpen(false)} />
            ))}
            <button onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-400 hover:bg-white/5">
              <LogOut className="size-[18px]" /> Sign out
            </button>
          </nav>
        </Sheet>
      ) : null}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(tab, active ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200")}
            >
              {dot}
              <Icon className="size-5" aria-hidden />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          className={cn(tab, moreActive || moreOpen ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200")}
          aria-current={moreActive ? "page" : undefined}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          {dot}
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}

/** Bottom sheet on phones, centred dialog on desktop. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="spa-fade fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="spa-sheet absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-zinc-900 p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl shadow-black/50 lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[28rem] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl lg:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">{title}</p>
          <button aria-label="Close" className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-zinc-100" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The one "Add" entry point: snap/upload receipts here, or go add statements. */
function QuickAdd({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { busy, error, upload } = useReceiptUpload(() => {
    onClose();
    router.push("/receipts");
  });
  const pick = useReceiptPickers(upload);
  const row = "spa-tile flex w-full items-center gap-3 rounded-xl p-3 text-left";
  const icon = "grid size-10 shrink-0 place-items-center rounded-xl";
  return (
    <Sheet title="Add to SpendVault" onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-amber-300/80 uppercase">Receipts</p>
      <div className="grid gap-2">
        <button type="button" className={row} onClick={pick.camera} disabled={busy}>
          <span className={cn(icon, "bg-amber-400 text-zinc-950")}>{busy ? <Spinner className="size-5" /> : <Camera className="size-5" />}</span>
          <span className="min-w-0 text-sm">
            <span className="font-medium">Snap a receipt</span>
            <span className="block text-xs text-fg-muted">Opens the camera on your phone</span>
          </span>
        </button>
        <button type="button" className={row} onClick={pick.files} disabled={busy}>
          <span className={cn(icon, "bg-amber-400/10 text-amber-300")}>
            <FileUp className="size-5" />
          </span>
          <span className="min-w-0 text-sm">
            <span className="font-medium">Upload receipts</span>
            <span className="block text-xs text-fg-muted">Photos, screenshots or PDF e-bills, several at once</span>
          </span>
        </button>
      </div>
      {pick.inputs}
      <ErrorText>{error}</ErrorText>
      <p className="mt-4 mb-2 font-mono text-[10px] tracking-[0.2em] text-amber-300/80 uppercase">Statements</p>
      <div className="grid gap-2">
        <Link href="/documents" className={row} onClick={onClose}>
          <span className={cn(icon, "bg-violet-400/10 text-violet-300")}>
            <Inbox className="size-5" />
          </span>
          <span className="min-w-0 text-sm">
            <span className="font-medium">Upload a statement</span>
            <span className="block text-xs text-fg-muted">PDF, CSV or Excel from your bank or card</span>
          </span>
        </Link>
        <Link href="/setup" className={row} onClick={onClose}>
          <span className={cn(icon, "bg-emerald-400/10 text-emerald-300")}>
            <Mail className="size-5" />
          </span>
          <span className="min-w-0 text-sm">
            <span className="font-medium">Forward statements automatically</span>
            <span className="block text-xs text-fg-muted">One Gmail filter + purchase alerts from your bank</span>
          </span>
        </Link>
      </div>
    </Sheet>
  );
}
