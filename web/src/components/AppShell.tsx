"use client";

import {
  Bell,
  FileText,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  MoreHorizontal,
  PiggyBank,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, getMe, logout } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { SessionProvider, useSignedIn } from "@/lib/session";
import { cn } from "@/lib/utils";
import { LoadError, Loading } from "./common";
import { BrandMark, Logo } from "./Wordmark";

/** /login that comes back here afterwards. */
export function loginUrl() {
  const here = window.location.pathname + window.location.search;
  return here === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
}

const PRIMARY = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/savings", label: "Savings", icon: PiggyBank },
];
const SECONDARY = [
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/setup", label: "Setup", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Gate on what renders, NOT a security boundary: every request carries a
 * bearer token the API validates. No middleware (see ../../CLAUDE.md).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const signedIn = useSignedIn();
  const me = useAsync(getMe, signedIn ? "me" : null);

  useEffect(() => {
    if (!signedIn) router.replace(loginUrl());
  }, [signedIn, router]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace(loginUrl());
  }, [me.error, router]);

  if (!signedIn) return null;

  return (
    <div className="min-h-screen md:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Logo href="/dashboard" />
        </header>
        <main className="pb-tabbar mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8 md:pb-10">
          {me.data ? (
            <SessionProvider value={{ me: me.data, refresh: me.reload, setMe: me.setData }}>{children}</SessionProvider>
          ) : me.error ? (
            <LoadError error={me.error} onRetry={me.reload} />
          ) : (
            <Loading />
          )}
        </main>
      </div>
      <TabBar />
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

function Sidebar() {
  const pathname = usePathname();
  const signOut = useSignOut();
  const item = (l: (typeof PRIMARY)[number]) => {
    const Icon = l.icon;
    const active = isActive(pathname, l.href);
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-bg-subtle hover:text-fg",
          active && "bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent",
        )}
      >
        <Icon className="size-4" /> {l.label}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white px-3 py-5 md:flex">
      <div className="px-2">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <BrandMark /> SpendVault
        </Link>
        <a
          href="https://3pandalabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block font-mono text-[10px] uppercase tracking-widest text-fg-muted hover:text-fg"
        >
          by 3PandaLabs
        </a>
      </div>
      <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
        {PRIMARY.map(item)}
        <div className="my-2 border-t border-line" />
        {SECONDARY.map(item)}
      </nav>
      <button
        onClick={signOut}
        className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-bg-subtle hover:text-fg"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </aside>
  );
}

function TabBar() {
  const pathname = usePathname();
  const signOut = useSignOut();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = SECONDARY.some((l) => isActive(pathname, l.href));

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const tab = "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium";

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            role="dialog"
            aria-label="More"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">More</p>
              <button aria-label="Close" className="rounded-full p-2" onClick={() => setMoreOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex flex-col">
              {SECONDARY.map((l) => {
                const Icon = l.icon;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-base",
                      isActive(pathname, l.href) ? "bg-accent-soft font-medium text-accent" : "text-fg",
                    )}
                  >
                    <Icon className="size-5" /> {l.label}
                  </Link>
                );
              })}
              <button onClick={signOut} className="flex items-center gap-3 rounded-lg px-3 py-3 text-base text-fg-muted">
                <LogOut className="size-5" /> Sign out
              </button>
            </nav>
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {PRIMARY.map((l) => {
          const Icon = l.icon;
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(tab, active ? "text-accent" : "text-fg-muted")}
            >
              <Icon className="size-5" />
              {l.label}
            </Link>
          );
        })}
        <button
          className={cn(tab, moreActive || moreOpen ? "text-accent" : "text-fg-muted")}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>
    </>
  );
}
