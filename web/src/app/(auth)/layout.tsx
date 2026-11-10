import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/Wordmark";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// AdVault's auth layout: centred wordmark over one glass card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-5 sm:p-6">{children}</Card>
        <p className="mt-6 text-center text-xs text-zinc-500">
          No bank login, ever. We only read the statements you choose to send.
        </p>
      </main>
      <Footer />
    </div>
  );
}
