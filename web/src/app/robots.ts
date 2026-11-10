import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the landing page and /privacy, /terms, /delete-account are public.
// Authed pages also send `robots: { index: false }` from their layout.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/transactions",
          "/alerts",
          "/savings",
          "/documents",
          "/setup",
          "/settings",
          "/share",
          "/share-target",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
