"use client";

// Reads the files public/sw.js stashed from a Web Share Target POST.
const SHARE_CACHE = "sv-share-inbox";

export async function readSharedFiles(): Promise<File[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-filename") ?? "shared-file");
    files.push(new File([blob], name, { type: res.headers.get("content-type") ?? blob.type }));
  }
  return files;
}

export async function clearSharedFiles() {
  if (typeof caches === "undefined") return;
  await caches.delete(SHARE_CACHE);
}
