// Minimal PDF writer for tests: Helvetica text runs at absolute positions.
// Each run is drawn separately so pdfjs returns separate positioned items,
// like a real statement table.
export type Run = { x: number; y: number; text: string; size?: number };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function makePdf(pages: Run[][]): Buffer {
  const objs: string[] = [];
  const n = pages.length;
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((runs, i) => {
    const stream = runs.map((r) => `BT /F1 ${r.size ?? 9} Tf ${r.x} ${r.y} Td (${esc(r.text)}) Tj ET`).join("\n");
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A small HDFC-style card statement laid out as a table. */
export function hdfcStatementPdf(): Buffer {
  const rows: Run[] = [
    { x: 40, y: 750, text: "HDFC Bank Credit Card Statement", size: 12 },
    { x: 40, y: 730, text: "Card No: 4893 77XX XXXX 4417" },
    { x: 40, y: 716, text: "Statement Period: 06/10/2026 To 05/11/2026" },
    { x: 40, y: 690, text: "Previous Balance" },
    { x: 400, y: 690, text: "5,000.00" },
    { x: 40, y: 676, text: "Total Amount Due" },
    { x: 400, y: 676, text: "3,145.50" },
    { x: 40, y: 650, text: "Date" },
    { x: 120, y: 650, text: "Transaction Description" },
    { x: 400, y: 650, text: "Amount (in Rs.)" },
  ];
  const txns: Array<[string, string, string]> = [
    ["08/10/2026", "SWIGGY BANGALORE", "456.00"],
    ["11/10/2026", "AMAZON PAY INDIA PRIVATE", "2,499.00"],
    ["15/10/2026", "PAYMENT RECEIVED - THANK YOU", "5,000.00 Cr"],
    ["20/10/2026", "STARBUCKS COFFEE MUMBAI", "190.50"],
  ];
  txns.forEach(([d, desc, amt], i) => {
    const y = 634 - i * 14;
    rows.push({ x: 40, y, text: d }, { x: 120, y, text: desc }, { x: 400, y, text: amt });
  });
  return makePdf([rows]);
}
