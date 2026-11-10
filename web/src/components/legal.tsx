// Long-form layout for the public legal pages, in AdVault's LegalPage shape:
// own header with a way back to the site, big title, effective date, an
// amber-ruled summary, then prose. Server components only.
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Wordmark";

export const CONTACT_EMAIL = "hello@3pandalabs.com";
export const LAST_UPDATED = "9 November 2026";

export type TocEntry = { id: string; title: string };

/** AdVault's landing header: wordmark + tag left, Log in / Get started right. */
export function PublicHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-6 py-6">
      <Logo tagClassName="hidden sm:inline" />
      <nav className="flex items-center gap-2 text-sm">
        <Link href="/login" className="rounded-lg px-3 py-2 whitespace-nowrap text-zinc-300 hover:bg-white/10">
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-lg bg-amber-400 px-3 py-2 font-medium whitespace-nowrap text-zinc-950 hover:bg-amber-300"
        >
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
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 py-6">
        <Logo tagClassName="hidden sm:inline" />
        <nav className="text-sm">
          <Link href="/" className="rounded-lg px-3 py-2 whitespace-nowrap text-zinc-300 hover:bg-white/10">
            Back to site
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-6 pb-20">
        <article>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-zinc-500">Last updated {LAST_UPDATED}</p>
          <div className="mt-6 space-y-4 border-l-2 border-amber-400/40 pl-4 text-lg leading-relaxed text-zinc-300">{intro}</div>
          {toc.length ? (
            <nav aria-label="Contents" className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
              <p className="font-mono text-xs tracking-widest text-amber-300/80 uppercase">Contents</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-500">
                {toc.map((e) => (
                  <li key={e.id}>
                    <a href={`#${e.id}`} className="text-zinc-300 hover:text-amber-200 hover:underline">
                      {e.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="[&_li>strong]:font-medium [&_strong]:text-zinc-200">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mt-12 mb-3 text-xl font-semibold tracking-tight text-zinc-100">{title}</h2>
      <div className="space-y-4 leading-relaxed text-zinc-400 [&_li]:leading-relaxed">{children}</div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 mb-2 text-base font-semibold text-zinc-200">{children}</h3>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

export function Mail({ to = CONTACT_EMAIL }: { to?: string }) {
  return (
    <a href={`mailto:${to}`} className="text-amber-300 underline underline-offset-2 hover:text-amber-200">
      {to}
    </a>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-amber-300 underline underline-offset-2 hover:text-amber-200">
      {children}
    </Link>
  );
}
