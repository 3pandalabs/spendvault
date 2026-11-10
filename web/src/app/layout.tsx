import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { GradientBackdrop } from "@/components/GradientBackdrop";
import { inter } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

const TITLE = "SpendVault: every card and bank account, one spending dashboard";
const DESCRIPTION =
  "Forward your bank and credit-card statements and see where your money goes. SpendVault flags spending spikes, finds forgotten subscriptions and fees, and never asks for your bank login.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · SpendVault" },
  description: DESCRIPTION,
  applicationName: "SpendVault",
  appleWebApp: { capable: true, title: "SpendVault", statusBarStyle: "black" },
  openGraph: { type: "website", siteName: "SpendVault", locale: "en_IN", url: SITE_URL, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className={`min-h-screen bg-zinc-950 text-zinc-100 antialiased ${inter.variable}`}>
        <GradientBackdrop />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
