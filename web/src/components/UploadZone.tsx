"use client";

import { FileUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage, uploadDocuments } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import type { Document } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorText, Spinner } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export const ACCEPT = ".pdf,.csv,.xlsx,.xls,.txt,.eml,application/pdf,text/csv";
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

/** Client-side check matching ROUTES.md limits (≤10 files, ≤10 MB each). Returns an error or null. */
export function checkFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Up to ${MAX_FILES} files at a time.`;
  const big = files.find((f) => f.size > MAX_BYTES);
  if (big) return `${big.name} is over 10 MB. Split it, or export a shorter date range.`;
  return null;
}

export function UploadZone({ onUploaded }: { onUploaded: (docs: Document[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add(list: FileList | null) {
    if (!list) return;
    setError(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...Array.from(list).filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  async function upload() {
    const err = checkFiles(files);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const res = await uploadDocuments(files, { source: "upload", password: password || undefined, savePassword });
      setFiles([]);
      setPassword("");
      onUploaded(res.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose statement files to upload"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-bg-subtle",
        )}
      >
        <FileUp className="size-7 text-accent" aria-hidden />
        <p className="mt-2 font-medium">Drop statements here, or tap to choose</p>
        <p className="mt-1 text-xs text-fg-muted">PDF, CSV or Excel · up to 10 files · 10 MB each</p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      </div>

      {files.length > 0 ? (
        <div className="mt-4 space-y-3">
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                  {fmtBytes(f.size)}
                  <button
                    aria-label={`Remove ${f.name}`}
                    className="rounded-full p-1 hover:bg-white"
                    onClick={() => setFiles((x) => x.filter((y) => y !== f))}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-sm">
              <span className="font-medium">PDF password</span> <span className="text-fg-muted">(optional)</span>
              <Input
                type="password"
                autoComplete="off"
                className="mt-1"
                placeholder="If the statement is password-protected"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button onClick={upload} disabled={busy}>
              {busy ? <Spinner /> : <FileUp />} Upload {files.length} file{files.length === 1 ? "" : "s"}
            </Button>
          </div>
          {password ? (
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" className="size-4 accent-accent" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
              Save this password (encrypted) for future statements
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
