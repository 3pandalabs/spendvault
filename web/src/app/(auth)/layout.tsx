import type { Metadata } from "next";
import { Logo } from "@/components/Wordmark";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-accent-soft to-bg px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-xl shadow-indigo-950/5">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-fg-muted">
        No bank login, ever. We only read the statements you choose to send.
      </p>
    </div>
  );
}
