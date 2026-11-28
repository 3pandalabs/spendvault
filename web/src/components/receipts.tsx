"use client";

import { Camera, FileUp, ImageOff, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, fetchReceiptImage, uploadDocuments } from "@/lib/api";
import { CATEGORY_KEYS, categoryColor, categoryLabel } from "@/lib/categories";
import { moneyExact } from "@/lib/format";
import type { CategoryKey, Document, Receipt, ReceiptItem, ReceiptMatchStatus, ReceiptStatus } from "@/lib/types";
import { checkFiles } from "./UploadZone";
import { ErrorText, Spinner } from "./common";
import { Badge, type BadgeVariant } from "./ui/badge";
import { Button } from "./ui/button";

export const RECEIPT_STATUS: Record<ReceiptStatus, [string, BadgeVariant]> = {
  processing: ["Reading…", "info"],
  pending_extraction: ["Needs total", "warn"],
  extracted: ["Read", "good"],
  manual: ["Entered by you", "muted"],
  failed: ["Couldn't read", "bad"],
};

export const MATCH_STATUS: Record<ReceiptMatchStatus, [string, BadgeVariant]> = {
  unmatched: ["Not matched", "outline"],
  auto: ["Matched", "info"],
  confirmed: ["Confirmed", "good"],
};

export function ReceiptBadges({ r }: { r: Pick<Receipt, "status" | "matchStatus"> }) {
  const [s, sv] = RECEIPT_STATUS[r.status];
  const [m, mv] = MATCH_STATUS[r.matchStatus];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={sv}>
        {r.status === "processing" ? <Spinner className="size-3" /> : null}
        {s}
      </Badge>
      {r.status !== "processing" ? <Badge variant={mv}>{m}</Badge> : null}
    </span>
  );
}

/**
 * Line items grouped by category, scaled to `amount` so the parts add up to
 * what was charged. The biggest group is named by its category; a smaller
 * group of one item is named by the item ("groceries $25, phone case $15").
 */
export function itemSummary(items: ReceiptItem[], amount: number): Array<{ label: string; category: CategoryKey; amount: number }> {
  const groups = new Map<CategoryKey, { sum: number; items: ReceiptItem[] }>();
  for (const it of items) {
    const g = groups.get(it.category) ?? { sum: 0, items: [] };
    g.sum += it.lineTotal;
    g.items.push(it);
    groups.set(it.category, g);
  }
  const list = [...groups.entries()].filter(([, g]) => g.sum > 0).sort((a, b) => b[1].sum - a[1].sum);
  const weight = list.reduce((s, [, g]) => s + g.sum, 0);
  if (!weight) return [];
  return list.map(([category, g], i) => ({
    category,
    label: i > 0 && g.items.length === 1 ? g.items[0].name.toLowerCase() : categoryLabel(category).toLowerCase(),
    amount: Math.round(((amount * g.sum) / weight) * 100) / 100,
  }));
}

/** "$40.00 at Target → groceries $25.00, phone case $15.00" (amounts via format.ts) */
export function ReceiptSummaryLine({ amount, currency, merchant, items }: { amount: number; currency: string; merchant: string | null; items: ReceiptItem[] }) {
  const parts = itemSummary(items, amount);
  return (
    <p className="text-sm">
      <span className="font-medium">{moneyExact(amount, currency)}</span>
      {merchant ? <> at {merchant}</> : null}
      {parts.length > 1 ? (
        <>
          {" → "}
          {parts.map((p, i) => (
            <span key={p.category}>
              {i > 0 ? ", " : ""}
              <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: categoryColor(p.category) }} aria-hidden />
              {p.label} {moneyExact(p.amount, currency)}
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

export function ReceiptItemsTable({
  items,
  currency,
  onCategory,
}: {
  items: ReceiptItem[];
  currency: string;
  onCategory?: (item: ReceiptItem, category: CategoryKey) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return <p className="text-sm text-fg-muted">No line items were read from this receipt.</p>;
  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border border-white/10">
        {items.map((it) => (
          <li key={it.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_12rem_7rem] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm">{it.name}</p>
              {it.quantity != null || it.unitPrice != null ? (
                <p className="text-xs text-fg-muted">
                  {it.quantity != null ? `${it.quantity} × ` : ""}
                  {it.unitPrice != null ? moneyExact(it.unitPrice, currency) : ""}
                </p>
              ) : null}
            </div>
            <span className="text-right text-sm tabular sm:order-last">{moneyExact(it.lineTotal, currency)}</span>
            <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(it.category) }} aria-hidden />
              {onCategory ? (
                <select
                  aria-label={`Category for ${it.name}`}
                  className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm hover:border-line-strong focus-visible:border-line-strong focus-visible:outline-none"
                  value={it.category}
                  disabled={busy === it.id}
                  onChange={async (e) => {
                    setBusy(it.id);
                    setError(null);
                    try {
                      await onCategory(it, e.target.value as CategoryKey);
                    } catch (err) {
                      setError(errorMessage(err));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {CATEGORY_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {categoryLabel(k)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm">{categoryLabel(it.category)}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

/** The decrypted original, fetched with the bearer token and shown from an object URL. */
export function ReceiptImage({ receipt }: { receipt: Pick<Receipt, "id" | "hasImage" | "mimeType"> }) {
  const [state, setState] = useState<{ id: string; url?: string; error?: string } | null>(null);
  const isImage = receipt.mimeType.startsWith("image/");
  useEffect(() => {
    if (!receipt.hasImage || !isImage) return;
    let alive = true;
    let url: string | null = null;
    fetchReceiptImage(receipt.id).then(
      (blob) => {
        url = URL.createObjectURL(blob);
        if (alive) setState({ id: receipt.id, url });
      },
      (e) => alive && setState({ id: receipt.id, error: errorMessage(e) }),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [receipt.id, receipt.hasImage, isImage]);

  if (!receipt.hasImage) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <ImageOff className="size-4" /> The original was deleted after reading (Settings › delete originals).
      </p>
    );
  }
  if (!isImage) return <p className="text-sm text-fg-muted">Original kept ({receipt.mimeType === "application/pdf" ? "PDF" : "email text"}).</p>;
  const cur = state?.id === receipt.id ? state : null;
  if (cur?.error) return <ErrorText>{cur.error}</ErrorText>;
  if (!cur?.url) return <Spinner />;
  return <ZoomableImage url={cur.url} />;
}

/** Tap to open full screen; tap again (or Esc) to close. */
function ZoomableImage({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative block w-full" aria-label="View the receipt full screen">
        {/* eslint-disable-next-line @next/next/no-img-element -- object URL of a private, decrypted blob */}
        <img src={url} alt="Receipt" className="mx-auto max-h-[28rem] w-auto rounded-xl border border-white/10" />
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-zinc-950/80 px-2.5 py-1 text-xs text-zinc-200 opacity-90 group-hover:opacity-100">
          <Maximize2 className="size-3" /> Zoom
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Receipt image"
          className="spa-fade fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/90 p-4"
          onClick={() => setOpen(false)}
        >
          <button className="fixed top-3 right-3 rounded-full bg-white/10 p-2 text-zinc-100 hover:bg-white/20" aria-label="Close" onClick={() => setOpen(false)}>
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- object URL of a private, decrypted blob */}
          <img src={url} alt="Receipt, full size" className="max-w-full" />
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- capture

const RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"]);
const SHRINK_OVER = 1.5 * 1024 * 1024;
const MAX_EDGE = 2400;

/**
 * Phone photos are often 4-12 MB, or HEIC on iPhones (which the API doesn't
 * take). Re-encode big or non-JPEG/PNG/WEBP images as a ~2400px JPEG in the
 * browser before upload: smaller, faster, and still sharp enough to read
 * line items. Anything that can't be decoded is sent as-is (the API decides).
 */
async function shrinkImage(file: File): Promise<File> {
  const supported = RECEIPT_TYPES.has(file.type);
  if (!file.type.startsWith("image/") || (supported && file.size <= SHRINK_OVER)) return file;
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || (supported && blob.size >= file.size)) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "receipt";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Upload one or more receipts (photos, PDFs, e-bill screenshots). */
export function useReceiptUpload(onUploaded: (docs: Document[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(list: FileList | File[] | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      const files = await Promise.all(picked.map(shrinkImage));
      const err = checkFiles(files);
      if (err) return setError(err);
      const res = await uploadDocuments(files, { source: "upload", kind: "receipt" });
      onUploaded(res.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, upload };
}

const RECEIPT_ACCEPT = "image/*,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.pdf";

/** Hidden camera + file inputs; call `.camera()` / `.files()` to open them. */
export function useReceiptPickers(upload: (files: FileList | null) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void upload(e.target.files);
    e.target.value = "";
  };
  const inputs = (
    <>
      {/* capture opens the rear camera on phones; the second input allows several files (PDF e-bills, screenshots). */}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={onChange} />
      <input ref={files} type="file" multiple accept={RECEIPT_ACCEPT} className="hidden" onChange={onChange} />
    </>
  );
  return { inputs, camera: () => camera.current?.click(), files: () => files.current?.click() };
}

/** "Add receipt": opens the camera on phones, a file picker elsewhere. */
export function AddReceiptButton({ onUploaded, compact }: { onUploaded: (docs: Document[]) => void; compact?: boolean }) {
  const { busy, error, upload } = useReceiptUpload(onUploaded);
  const pick = useReceiptPickers(upload);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={pick.camera} disabled={busy} className="spa-shine">
          {busy ? <Spinner /> : <Camera />} {compact ? "Snap" : "Snap a receipt"}
        </Button>
        <Button variant="outline" onClick={pick.files} disabled={busy}>
          <FileUp /> {compact ? "Upload" : "Upload receipts"}
        </Button>
      </div>
      {pick.inputs}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Drag-and-drop area for several receipts at once (desktop), tap-to-pick on phones. */
export function ReceiptDropZone({ onUploaded }: { onUploaded: (docs: Document[]) => void }) {
  const { busy, error, upload } = useReceiptUpload(onUploaded);
  const pick = useReceiptPickers(upload);
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose receipt files to upload"
        data-drag={drag || undefined}
        onClick={pick.files}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick.files())}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        className="spa-drop flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-white/15 px-4 py-4 transition-colors hover:bg-white/[0.04]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300">
          {busy ? <Spinner className="size-5" /> : <FileUp className="size-5" />}
        </span>
        <span className="min-w-0 text-sm">
          <span className="font-medium text-fg">Drop receipts here</span>
          <span className="block text-xs text-fg-muted">Photos, screenshots or PDF e-bills · up to 10 at a time · big photos are shrunk first</span>
        </span>
      </div>
      {pick.inputs}
      <div className="mt-1">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

/** Stacked strip of a receipt's item categories, scaled to what was charged. */
export function ItemStrip({ items, amount }: { items: ReceiptItem[]; amount: number }) {
  const parts = itemSummary(items, amount);
  const total = parts.reduce((s, p) => s + p.amount, 0);
  if (!total) return null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden>
      {parts.map((p) => (
        <div key={p.category} className="spa-grow" style={{ width: `${(p.amount / total) * 100}%`, background: categoryColor(p.category) }} />
      ))}
    </div>
  );
}

/**
 * Receipts that look like the same purchase uploaded twice: same shop, total
 * and date (the check ReceiptCash ran server-side; here it's a hint only).
 */
export function duplicateReceiptIds(list: Receipt[]): Set<string> {
  const seen = new Map<string, string>();
  const out = new Set<string>();
  for (const r of list) {
    if (r.total == null || !r.purchasedOn || !r.merchant) continue;
    const key = `${r.merchant.trim().toLowerCase()}|${r.total}|${r.purchasedOn}|${r.currency}`;
    const first = seen.get(key);
    if (first) {
      out.add(first);
      out.add(r.id);
    } else seen.set(key, r.id);
  }
  return out;
}
