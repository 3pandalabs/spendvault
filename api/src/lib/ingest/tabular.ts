// CSV / XLSX / HTML-table "xls" statement parsing. Pure module (no env/db).
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { findLast4, inferDateOrder, parseDate, parseLooseAmount } from "./text.js";
import type { AccountKind, DateOrder, ParsedTxn, ParseResult } from "./types.js";

export type Cell = string;
export type TableOptions = { country?: "IN" | "US" | null; kinds?: Array<"credit_card" | "bank"> };

type Columns = {
  date: number;
  desc: number;
  amount: number;
  debit: number;
  credit: number;
  drcr: number;
  balance: number;
};

const norm = (c: string) => c.toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Map header cells to column roles, or null when the row isn't a txn header. */
export function mapHeader(row: Cell[]): Columns | null {
  const h = row.map((c) => norm(String(c ?? "")));
  const find = (re: RegExp, skip: (s: string) => boolean = () => false) => h.findIndex((c) => c.length <= 40 && re.test(c) && !skip(c));
  const drcr = find(/^(dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit|credit ?\/ ?debit|type|txn type|transaction type|dr cr|cr dr)$/);
  let date = find(/\b(txn|transaction|posting|post|trans|tran)?\s*date\b/, (c) => /value/.test(c));
  if (date < 0) date = find(/\bdate\b/);
  const desc = find(/narration|description|particulars|details|remarks|merchant|payee|transaction$/, (c) => /date|type/.test(c));
  const debit = find(/\b(debit|withdrawal|withdrawals|dr|paid out|money out|charges?)\b/, (c) => /\//.test(c) || h.indexOf(c) === drcr);
  const credit = find(/\b(credit|deposit|deposits|cr|paid in|money in|payments?)\b/, (c) => /\//.test(c) || /date|type/.test(c) || h.indexOf(c) === drcr);
  const amount = find(/\bamount\b|\bamt\b|\bvalue\b/, (c) => /balance|debit|credit|withdrawal|deposit|date/.test(c));
  const balance = find(/balance/);
  if (date < 0 || desc < 0) return null;
  if (amount < 0 && debit < 0 && credit < 0) return null;
  return { date, desc, amount, debit, credit, drcr, balance };
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return String(o.text);
    return "";
  }
  return String(v).trim();
}

/** Parse a table (rows of cells) that contains a txn header somewhere in its first 30 rows. */
export function parseTable(rows: Cell[][], opts: TableOptions = {}): ParseResult {
  let headerIdx = -1;
  let cols: Columns | null = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    cols = mapHeader(rows[i]);
    if (cols) {
      headerIdx = i;
      break;
    }
  }
  const result: ParseResult = { parser: "csv", sourceKind: "csv", accountKind: "unknown", txns: [] };
  if (!cols) return result;
  const c = cols;

  const preamble = rows.slice(0, headerIdx).map((r) => r.join(" ")).join("\n");
  const body = rows.slice(headerIdx + 1);
  const fallbackOrder: DateOrder = opts.country === "US" ? "MDY" : "DMY";
  const order = opts.country ? fallbackOrder : inferDateOrder(body.map((r) => r[c.date] ?? ""), fallbackOrder);

  type Raw = { postedOn: string; description: string; value: number; negative: boolean; marker: "cr" | "dr" | null; side: "debit" | "credit" | null };
  const raws: Raw[] = [];
  for (const r of body) {
    const postedOn = parseDate(String(r[c.date] ?? "").split(/\s+(?=\d{1,2}:\d{2})/)[0], order);
    if (!postedOn) continue;
    const description = String(r[c.desc] ?? "").replace(/\s+/g, " ").trim();
    if (!description) continue;
    if (c.debit >= 0 || c.credit >= 0) {
      const d = c.debit >= 0 ? parseLooseAmount(r[c.debit]) : null;
      const cr = c.credit >= 0 ? parseLooseAmount(r[c.credit]) : null;
      if (d && d.value > 0) raws.push({ postedOn, description, value: d.value, negative: false, marker: null, side: "debit" });
      else if (cr && cr.value > 0) raws.push({ postedOn, description, value: cr.value, negative: false, marker: null, side: "credit" });
      else if (c.amount >= 0) {
        const a = parseLooseAmount(r[c.amount]);
        if (a && a.value > 0) raws.push({ postedOn, description, ...a, side: null });
      }
      continue;
    }
    const a = parseLooseAmount(r[c.amount]);
    if (!a || !(a.value > 0)) continue;
    let marker = a.marker;
    if (c.drcr >= 0) {
      const t = String(r[c.drcr] ?? "").toLowerCase();
      if (/^c|credit/.test(t)) marker = "cr";
      else if (/^d|debit/.test(t)) marker = "dr";
    }
    raws.push({ postedOn, description, value: a.value, negative: a.negative, marker, side: null });
  }

  // Signed single-amount column: most rows are spending, so whichever sign the
  // majority carries is "debit" (banks print debits negative; Amex prints charges positive).
  const signed = raws.filter((x) => x.side === null && x.marker === null);
  const negatives = signed.filter((x) => x.negative).length;
  const negativeIsDebit = negatives * 2 >= signed.length;

  const txns: ParsedTxn[] = raws.map((x) => {
    let direction: "debit" | "credit";
    if (x.side) direction = x.side;
    else if (x.marker) direction = x.marker === "cr" ? "credit" : "debit";
    else direction = x.negative === negativeIsDebit ? "debit" : "credit";
    return { postedOn: x.postedOn, description: x.description.slice(0, 300), amount: Math.round(x.value * 100) / 100, direction };
  });

  let accountKind: AccountKind = "unknown";
  if (c.balance >= 0) accountKind = "bank";
  else if (/card/i.test(preamble) || rows[headerIdx].some((h) => /card/i.test(String(h)))) accountKind = "credit_card";
  else if (opts.kinds?.length === 1) accountKind = opts.kinds[0];

  const dates = txns.map((t) => t.postedOn).sort();
  return {
    ...result,
    accountKind,
    last4: findLast4(preamble),
    currency: opts.country === "US" ? "USD" : "INR",
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    txns,
  };
}

function csvRows(text: string, delimiter: string): Cell[][] {
  try {
    return (parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, bom: true, trim: true }) as string[][]).map((r) =>
      r.map((c) => String(c ?? "")),
    );
  } catch {
    return [];
  }
}

export function parseCsvBuffer(buf: Buffer, opts: TableOptions = {}): ParseResult {
  const text = buf.toString("utf8");
  if (/<table/i.test(text.slice(0, 20000))) return parseTable(htmlRows(text), opts);
  let best: ParseResult | null = null;
  for (const d of [",", "\t", ";", "|"]) {
    const r = parseTable(csvRows(text, d), opts);
    if (!best || r.txns.length > best.txns.length) best = r;
    if (r.txns.length) break;
  }
  return best ?? parseTable([], opts);
}

/** Rows from an HTML table ("xls" exports from several Indian banks are HTML). */
export function htmlRows(html: string): Cell[][] {
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, " ")
      .trim();
  const rows: Cell[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export async function parseXlsxBuffer(buf: Buffer, opts: TableOptions = {}): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  let best: ParseResult = parseTable([], opts);
  for (const ws of wb.worksheets) {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[]; // 1-based
      rows.push(values.slice(1).map(cellToString));
    });
    const r = parseTable(rows, opts);
    if (r.txns.length > best.txns.length) best = r;
  }
  return best;
}

export class UnsupportedFormatError extends Error {}

/** .xls: real BIFF files aren't readable here; HTML / TSV disguised as .xls are. */
export function parseXlsBuffer(buf: Buffer, opts: TableOptions = {}): ParseResult {
  if (buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new UnsupportedFormatError("Legacy .xls files aren't supported yet. Export the statement as CSV or XLSX.");
  }
  return parseCsvBuffer(buf, opts);
}
