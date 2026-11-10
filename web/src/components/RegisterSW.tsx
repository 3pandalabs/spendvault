"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js. The worker only handles the Web Share Target POST;
 * it caches nothing else. Registered on every page (not just the signed-in
 * shell) so the share target works as soon as the app is installed.
 * Skipped in `next dev` unless the URL has ?sw=1, to keep HMR simple.
 */
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !window.location.search.includes("sw=1")) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
