// SpendVault service worker. ONE job: receive files from the Android share
// sheet (Web Share Target, see src/app/manifest.ts) and hand them to /share.
//
// It deliberately caches nothing else: no app pages, no API responses, no
// offline mode. Financial data must never sit in a cache on the device.
// Every other request passes straight through to the network.

const SHARE_CACHE = "sv-share-inbox";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(stashShare(event.request));
  }
  // No respondWith: the browser handles the request normally.
});

async function stashShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("file").filter((f) => f && typeof f === "object" && "name" in f);
    const cache = await caches.open(SHARE_CACHE);
    // Replace any previous unsent share: the newest share is what the user expects to see.
    for (const key of await cache.keys()) await cache.delete(key);
    let i = 0;
    for (const file of files) {
      i += 1;
      await cache.put(
        `/__share/${Date.now()}-${i}`,
        new Response(file, {
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-filename": encodeURIComponent(file.name || `shared-${i}`),
          },
        }),
      );
    }
    return Response.redirect(files.length ? "/share" : "/share?error=empty", 303);
  } catch {
    return Response.redirect("/share?error=read", 303);
  }
}
