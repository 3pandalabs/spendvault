import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { GradientBackdrop } from "@/components/GradientBackdrop";
import { inter } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

// Titles and share tags follow 3pandalabs/brand brand.md "Consistency rules":
// home = "<App> — <line> | by 3PandaLabs", other pages = "<Page> — SpendVault",
// og:image = the 1200x630 card generated from brand/og (public/og.png).
const TITLE = "SpendVault — Every card, every receipt, down to the line item | by 3PandaLabs";
const DESCRIPTION =
  "Forward statements, purchase alerts and receipts and see where your money goes, down to the line item. SpendVault tracks subscriptions, flags hidden fees, shows what's safe to spend, and never asks for your bank login.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s — SpendVault" },
  description: DESCRIPTION,
  applicationName: "SpendVault",
  appleWebApp: { capable: true, title: "SpendVault", statusBarStyle: "black" },
  openGraph: {
    type: "website",
    siteName: "SpendVault by 3PandaLabs",
    locale: "en_US",
    alternateLocale: ["en_IN"],
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SpendVault by 3PandaLabs" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
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
    <html lang="en-US">
      <body className={`min-h-screen bg-zinc-950 text-zinc-100 antialiased ${inter.variable}`}>
        <GradientBackdrop />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
