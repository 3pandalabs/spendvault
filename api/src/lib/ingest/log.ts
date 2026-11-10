// Ids-and-counts-only logging for the pipeline (never amounts, merchants,
// statement text, passwords or email content). JSON lines like pino's.
type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", fields: Fields, msg: string) {
  const line = JSON.stringify({ level, time: Date.now(), component: "ingest", ...fields, msg });
  if (level === "info") console.log(line);
  else console.error(line);
}

export const ingestLog = {
  info: (fields: Fields, msg: string) => emit("info", fields, msg),
  warn: (fields: Fields, msg: string) => emit("warn", fields, msg),
  error: (fields: Fields, msg: string) => emit("error", fields, msg),
};

/** Error class/code only: messages can echo document content (pdfjs, pg). */
export function errKind(err: unknown): string {
  const e = err as { name?: string; code?: string } | null;
  return [e?.name, e?.code].filter(Boolean).join(":") || "unknown";
}
