"use client";

import { CheckCircle2, FileText, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { EmptyState, ErrorText, Loading, PageHeader, Spinner } from "@/components/common";
import { checkFiles } from "@/components/UploadZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, uploadDocuments } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { clearSharedFiles, readSharedFiles } from "@/lib/shareInbox";
import type { Document } from "@/lib/types";

const noop = () => () => undefined;

const SHARE_ERRORS: Record<string, string> = {
  nosw: "SpendVault was still starting up and couldn't catch that file. Share it again; it works from the second time on.",
  empty: "Nothing came through with that share. Share the PDF or spreadsheet file itself, not a link to it.",
  read: "We couldn't read the shared file. Try sharing it again, or upload it from Documents.",
};

/**
 * Landing page for the Web Share Target. public/sw.js stashes the shared files
 * in Cache Storage and redirects here. If the user wasn't signed in, the app
 * shell sent them to /login?next=/share first; the files waited in the cache.
 */
export default function SharePage() {
  const errorKey = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("error"), () => null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Document[] | null>(null);

  useEffect(() => {
    let alive = true;
    readSharedFiles()
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
  }, []);

  async function upload() {
    if (!files?.length) return;
    const err = checkFiles(files);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const res = await uploadDocuments(files, { source: "share", password: password || undefined, savePassword: Boolean(password) });
      await clearSharedFiles();
      setDone(res.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    await clearSharedFiles();
    setFiles([]);
  }

  if (done) {
    return (
      <>
        <PageHeader title="Sent to SpendVault" />
        <div className="rounded-2xl border border-line bg-white p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-down" />
          <p className="mt-2 font-medium">
            Got {done.length} file{done.length === 1 ? "" : "s"}. We&apos;re reading {done.length === 1 ? "it" : "them"} now.
          </p>
          <p className="mt-1 text-sm text-fg-muted">This usually takes under a minute.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/documents">
              <Button>See progress</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline">Dashboard</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Shared file" subtitle="Files you shared to SpendVault from another app." />
      {errorKey && SHARE_ERRORS[errorKey] && !files?.length ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          {SHARE_ERRORS[errorKey]}
        </p>
      ) : null}
      {files === null ? (
        <Loading />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Share2 />}
          title="Nothing waiting"
          body="On Android, tap Share on a statement in your banking app, email or Files, and pick SpendVault."
          action={
            <Link href="/documents">
              <Button variant="outline">Upload instead</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4 rounded-2xl border border-line bg-white p-4">
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-fg-muted">{fmtBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <label className="block text-sm">
            <span className="font-medium">PDF password</span> <span className="text-fg-muted">(only if it&apos;s locked and not saved yet)</span>
            <Input type="password" autoComplete="off" className="mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button onClick={upload} disabled={busy}>
              {busy ? <Spinner /> : null} Send to SpendVault
            </Button>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
