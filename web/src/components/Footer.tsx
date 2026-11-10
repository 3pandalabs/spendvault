import Link from "next/link";

// The bottom row is the canonical org footer copied verbatim from
// 3pandalabs/brand `footer/` (via AdVault) — do not reword it. The links row
// above it is an ADDITION, same pattern AdVault uses for its legal links; the
// "not financial advice" line lives there too so the canonical row stays exact.
export function Footer() {
  return (
    <footer className="border-t border-white/10 px-6 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 pb-4 text-sm">
        <Link href="/privacy" className="text-zinc-400 hover:text-zinc-200">
          Privacy
        </Link>
        <Link href="/terms" className="text-zinc-400 hover:text-zinc-200">
          Terms
        </Link>
        <Link href="/delete-account" className="text-zinc-400 hover:text-zinc-200">
          Delete account
        </Link>
        <a href="mailto:hello@3pandalabs.com" className="text-zinc-400 hover:text-zinc-200">
          Contact
        </a>
        <span className="text-zinc-500 sm:ml-auto">SpendVault is not financial advice.</span>
      </div>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <span>&copy; 3PandaLabs LLC, USA.</span>
        <span>All rights reserved.</span>
      </div>
    </footer>
  );
}
