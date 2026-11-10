// Email / file classification helpers. Pure module.

export type FileType = "pdf" | "csv" | "xlsx" | "xls" | "text" | "eml" | "image";

const EXT_TYPES: Record<string, FileType> = {
  pdf: "pdf",
  csv: "csv",
  tsv: "csv",
  xlsx: "xlsx",
  xls: "xls",
  txt: "text",
  eml: "eml",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
};

const MIME_TYPES: Record<string, FileType> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/tab-separated-values": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/plain": "text",
  "message/rfc822": "eml",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
};

export const extOf = (filename: string | null | undefined) => filename?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";

/** File type by extension first (mail clients mislabel mime constantly), then mime, then magic bytes. */
export function fileTypeOf(mime: string | null | undefined, filename: string | null | undefined, head?: Buffer): FileType | null {
  const byExt = EXT_TYPES[extOf(filename)];
  if (byExt) return byExt;
  const byMime = MIME_TYPES[(mime ?? "").toLowerCase().split(";")[0].trim()];
  if (byMime) return byMime;
  if (head) {
    if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
    if (head[0] === 0x50 && head[1] === 0x4b) return "xlsx"; // zip container
    if (head[0] === 0xd0 && head[1] === 0xcf) return "xls"; // OLE2
  }
  return null;
}

/** Canonical mime for a stored document. */
export function mimeFor(type: FileType, given?: string | null): string {
  switch (type) {
    case "pdf":
      return "application/pdf";
    case "csv":
      return "text/csv";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "text":
      return "text/plain";
    case "eml":
      return "message/rfc822";
    case "image":
      return given && given.startsWith("image/") ? given.split(";")[0] : "image/jpeg";
  }
}

/** Attachments worth keeping from an email: statements only. */
export function isStatementAttachment(mime: string | null | undefined, filename: string | null | undefined): boolean {
  const t = fileTypeOf(mime, filename);
  return t === "pdf" || t === "csv" || t === "xlsx" || t === "xls";
}

export type ForwardingConfirmation = {
  provider: "gmail" | "outlook";
  forwardFrom: string | null;
  code: string | null;
  confirmUrl: string | null;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Gmail / Outlook "confirm forwarding to this address" mails. */
export function detectForwardingConfirmation(from: string | null | undefined, subject: string | null | undefined, text: string | null | undefined): ForwardingConfirmation | null {
  const f = (from ?? "").toLowerCase();
  const s = subject ?? "";
  const body = text ?? "";
  if (f.includes("forwarding-noreply@google.com") || /gmail forwarding confirmation/i.test(s)) {
    const code = s.match(/\(#(\d{5,12})\)/)?.[1] ?? body.match(/confirmation code:?\s*(\d{5,12})/i)?.[1] ?? null;
    const forwardFrom =
      s.match(new RegExp(`receive mail from\\s+(${EMAIL.source})`, "i"))?.[1] ??
      body.match(new RegExp(`(${EMAIL.source})\\s+has requested`, "i"))?.[1] ??
      null;
    const confirmUrl = body.match(/https:\/\/(?:mail-settings|mail|isolated\.mail)\.google\.com\/[^\s<>"')\]]+/i)?.[0] ?? null;
    return { provider: "gmail", forwardFrom, code, confirmUrl };
  }
  const isMicrosoft = /@(?:[\w-]+\.)*(?:microsoft|outlook|office365|office|live|hotmail)\.com\b/.test(f);
  if (isMicrosoft && /verif|confirm|forward/i.test(`${s} ${body.slice(0, 2000)}`)) {
    const code = body.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? null;
    const confirmUrl = body.match(/https:\/\/[^\s<>"')\]]+/i)?.[0] ?? null;
    const forwardFrom = body.match(EMAIL)?.[0] ?? null;
    return { provider: "outlook", forwardFrom, code, confirmUrl };
  }
  return null;
}
