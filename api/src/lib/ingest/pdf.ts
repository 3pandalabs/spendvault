// PDF → text lines with pdfjs (legacy build, Node). Pure module (no env/db):
// the caller supplies candidate passwords.
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

export type PositionedItem = { str: string; x: number; y: number; width: number; height: number };

/**
 * Rebuild visual lines from positioned text items: group by rounded y
 * (descending = top to bottom), sort by x, and join with a gap-aware
 * separator. Wide gaps (table columns) become 2+ spaces so the rules parser
 * can tell "description  amount" apart from "two words".
 */
export function itemsToLines(items: PositionedItem[]): string[] {
  const usable = items.filter((i) => i.str.trim().length > 0);
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(2, Math.min(it.height || 0, 12) * 0.4);
    if (row && Math.abs(row[0].y - it.y) <= tol) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd: number | null = null;
    let prevH = 10;
    for (const it of row) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        const charW = Math.max(prevH, it.height || 0, 4) * 0.5;
        if (gap > charW * 2.5) line += " ".repeat(Math.min(8, Math.max(2, Math.round(gap / (charW * 2)))));
        else if (gap > charW * 0.25 && !line.endsWith(" ") && !it.str.startsWith(" ")) line += " ";
      }
      line += it.str;
      prevEnd = it.x + (it.width || it.str.length * (it.height || 10) * 0.5);
      prevH = it.height || prevH;
    }
    return line.replace(/\s+$/, "");
  });
}

export type PdfTextResult =
  | { ok: true; pages: string[]; passwordIndex: number | null }
  | { ok: false; reason: "needs_password" };

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | undefined;
const loadPdfJs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

const isPasswordError = (err: unknown) => (err as { name?: string } | null)?.name === "PasswordException";

async function extractWith(pdfjs: PdfJs, buf: Buffer, password?: string): Promise<string[]> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf), // copied: pdfjs transfers (detaches) the buffer
    password,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PositionedItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const it = raw as TextItem;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height || Math.abs(it.transform[3]) });
      }
      pages.push(itemsToLines(items).join("\n"));
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/**
 * Text of every page. Tries no password, then each candidate in order;
 * `passwordIndex` says which candidate worked (null = none needed).
 */
export async function extractPdfText(buf: Buffer, candidates: string[]): Promise<PdfTextResult> {
  const pdfjs = await loadPdfJs();
  try {
    return { ok: true, pages: await extractWith(pdfjs, buf), passwordIndex: null };
  } catch (err) {
    if (!isPasswordError(err)) throw err;
  }
  for (let i = 0; i < candidates.length; i++) {
    try {
      return { ok: true, pages: await extractWith(pdfjs, buf, candidates[i]), passwordIndex: i };
    } catch (err) {
      if (!isPasswordError(err)) throw err;
    }
  }
  return { ok: false, reason: "needs_password" };
}
