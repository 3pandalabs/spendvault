import { FollowUs } from "@/components/FollowUs";
import Link from "next/link";

// The bottom row is the canonical org footer copied verbatim from
// 3pandalabs/brand `footer/` (via AdVault) — do not reword it. The links row
// above it is an ADDITION, same pattern AdVault uses for its legal links; the
// "not financial advice" line lives there too so the canonical row stays exact.
// The tagline line under it is brand `.footer-tagline` (DECIDED 2026-11-22).
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
        <span className="text-zinc-500 sm:ml-auto">SpendVault is not financial advice.</span>
      </div>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <FollowUs />
        <span>&copy; 3PandaLabs LLC, USA.</span>
        <span>All rights reserved.</span>
        <p className="mt-1 basis-full text-xs text-zinc-500">Built by pandas. Loved by people.</p>
      </div>
    </footer>
  );
}
