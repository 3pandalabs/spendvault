// RFC 4180 CSV writer for the data export. Pure.
//
// Text cells that start with = + - @ (or a tab/CR) get a leading apostrophe so
// a spreadsheet never runs a merchant name as a formula (CSV injection).
// Numbers are written as plain numbers, so negative amounts stay numeric.

export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + rows, CRLF line endings, UTF-8 BOM so Excel reads ₹ and accents. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
