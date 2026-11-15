"use client";

import { Camera, FileUp, ImageOff } from "lucide-react";
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
 * group of one item is named by the item ("groceries ₹2,900, kettle ₹1,300").
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

/** "₹4,200 at DMart → groceries ₹2,900, kettle ₹1,300" */
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
  // eslint-disable-next-line @next/next/no-img-element -- object URL of a private, decrypted blob
  return <img src={cur.url} alt="Receipt" className="max-h-[28rem] w-auto rounded-lg border border-white/10" />;
}

/** "Add receipt": opens the camera on phones, a file picker elsewhere. */
export function AddReceiptButton({ onUploaded }: { onUploaded: (docs: Document[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const err = checkFiles(files);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const res = await uploadDocuments(files, { source: "upload", kind: "receipt" });
      onUploaded(res.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => camera.current?.click()} disabled={busy}>
          {busy ? <Spinner /> : <Camera />} Photo of a receipt
        </Button>
        <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          <FileUp /> Upload receipt
        </Button>
      </div>
      {/* capture opens the rear camera on phones; the second input allows files (PDF e-bills, screenshots). */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
