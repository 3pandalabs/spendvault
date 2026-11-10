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
import { Button } from "./ui/button";
import { Logo } from "./Wordmark";

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
    <div className="min-h-screen">
      <TopBar />
      <div className="min-w-0">
        <main className="pb-tabbar mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8 lg:pb-12">
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

/**
 * AdVault's dashboard header: wordmark left, ghost nav links right, on a
 * hairline-bordered bar over the backdrop. Seven destinations don't fit a
 * single row below lg, so phones and tablets get the wordmark here and the
 * bottom tab bar below instead.
 */
function TopBar() {
  const pathname = usePathname();
  const signOut = useSignOut();
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/70 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:py-4">
        <Logo href="/dashboard" tagClassName="hidden sm:inline lg:hidden xl:inline" />
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm lg:flex">
          {[...PRIMARY, ...SECONDARY].map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2 text-zinc-300 hover:bg-white/10 hover:text-zinc-100",
                  active && "bg-white/10 text-zinc-100",
                )}
              >
                {l.label}
              </Link>
            );
          })}
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </nav>
      </div>
    </header>
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
        <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            role="dialog"
            aria-label="More"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-zinc-900 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">More</p>
              <button aria-label="Close" className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-zinc-100" onClick={() => setMoreOpen(false)}>
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
                      isActive(pathname, l.href) ? "bg-white/10 font-medium text-zinc-100" : "text-zinc-300 hover:bg-white/5",
                    )}
                  >
                    <Icon className="size-5" /> {l.label}
                  </Link>
                );
              })}
              <button onClick={signOut} className="flex items-center gap-3 rounded-lg px-3 py-3 text-base text-zinc-400 hover:bg-white/5">
                <LogOut className="size-5" /> Sign out
              </button>
            </nav>
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-zinc-950/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {PRIMARY.map((l) => {
          const Icon = l.icon;
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(tab, active ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200")}
            >
              <Icon className="size-5" />
              {l.label}
            </Link>
          );
        })}
        <button
          className={cn(tab, moreActive || moreOpen ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200")}
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
