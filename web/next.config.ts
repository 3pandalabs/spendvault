import type { NextConfig } from "next";

// Fail the build rather than shipping a bundle that points at localhost.
// NEXT_PUBLIC_* is inlined at build time, so an unset value silently compiles
// the fallback in src/lib/api.ts into every browser bundle. .env.production
// supplies the value; this assertion makes a future omission loud.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is unset at build time. It is inlined into the browser " +
      "bundle, so wrangler.jsonc `vars` cannot supply it — set it in web/.env.production.",
  );
}

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or a fix to the
        // share-target handler would take a day to reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
