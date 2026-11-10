import { describe, expect, it } from "vitest";
import { extractPdfText, itemsToLines } from "../../src/lib/ingest/pdf.js";
import { parseStatementText } from "../../src/lib/ingest/statement.js";
import { hdfcStatementPdf, makePdf } from "../fixtures/makePdf.js";

describe("itemsToLines", () => {
  it("groups by y (top first), sorts by x, keeps column gaps", () => {
    const lines = itemsToLines([
      { str: "499.00", x: 400, y: 600, width: 25, height: 9 },
      { str: "SWIGGY", x: 120, y: 600.6, width: 30, height: 9 },
      { str: "02/11/2026", x: 40, y: 600, width: 45, height: 9 },
      { str: "Header", x: 40, y: 700, width: 30, height: 9 },
      { str: "BANGALORE", x: 152, y: 600, width: 45, height: 9 },
    ]);
    expect(lines[0]).toBe("Header");
    expect(lines[1]).toMatch(/^02\/11\/2026 {2,}SWIGGY BANGALORE {2,}499\.00$/);
  });
});

describe("extractPdfText (real PDF through pdfjs)", () => {
  it("reconstructs table lines that the rules parser can read", async () => {
    const r = await extractPdfText(hdfcStatementPdf(), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.pages.join("\n");
    expect(text).toMatch(/08\/10\/2026 {2,}SWIGGY BANGALORE {2,}456\.00/);
    const parsed = parseStatementText(text, { country: "IN" });
    expect(parsed.txns).toHaveLength(4);
    expect(parsed.last4).toBe("4417");
    expect(parsed.totalDue).toBe(3145.5);
    expect(parsed.previousBalance).toBe(5000);
    expect(parsed.txns[2]).toMatchObject({ direction: "credit", amount: 5000 });
  });

  it("handles multiple pages", async () => {
    const pdf = makePdf([[{ x: 40, y: 700, text: "page one" }], [{ x: 40, y: 700, text: "page two" }]]);
    const r = await extractPdfText(pdf, []);
    expect(r.ok && r.pages).toEqual(["page one", "page two"]);
  });
});
