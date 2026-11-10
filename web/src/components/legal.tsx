// Long-form layout for the public legal pages. Server components only.
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Wordmark";

export const CONTACT_EMAIL = "hello@3pandalabs.com";
export const LAST_UPDATED = "9 November 2026";

export type TocEntry = { id: string; title: string };

export function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
      <Logo />
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/login" className="text-fg-muted hover:text-fg">
          Sign in
        </Link>
        <Link href="/signup" className="hidden rounded-full bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90 sm:inline-flex">
          Get started
        </Link>
      </nav>
    </header>
  );
}

export function LegalPage({
  title,
  intro,
  toc,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  toc: TocEntry[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20">
        <article className="rounded-3xl border border-line bg-white p-5 sm:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-sm text-fg-muted">Last updated: {LAST_UPDATED}</p>
          <div className="mt-6 space-y-4 text-[15px] leading-7 text-fg">{intro}</div>
          {toc.length ? (
            <nav aria-label="Contents" className="mt-8 rounded-2xl border border-line bg-bg-subtle p-5">
              <p className="text-sm font-semibold text-fg">Contents</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {toc.map((e) => (
                  <li key={e.id}>
                    <a href={`#${e.id}`} className="text-accent hover:underline">
                      {e.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      <div className="mt-3 space-y-4 text-[15px] leading-7 text-fg">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-semibold text-fg">{children}</h3>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

export function Mail({ to = CONTACT_EMAIL }: { to?: string }) {
  return (
    <a href={`mailto:${to}`} className="font-medium text-accent hover:underline">
      {to}
    </a>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}
