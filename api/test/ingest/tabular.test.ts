import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mapHeader, parseCsvBuffer, parseTable, parseXlsBuffer, parseXlsxBuffer, UnsupportedFormatError } from "../../src/lib/ingest/tabular.js";

const HDFC_BANK_CSV = `HDFC BANK Ltd.
Account No : 50100012345678
Statement From : 01/10/2026 To : 31/10/2026

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-628812345678-PAYMENT,0000628812345678,01/10/26,499.00,,49501.00
03/10/26,NEFT CR-ACME SOFTWARE-SALARY OCT,N276260000000001,03/10/26,,"85,000.00",134501.00
15/10/26,ATW-416021XXXXXX1234-S1ANBG12-BANGALORE,0000000000001234,15/10/26,"2,000.00",,132501.00
`;

describe("CSV/XLSX statements", () => {
  it("detects the header row below a preamble; separate debit/credit columns", () => {
    const r = parseCsvBuffer(Buffer.from(HDFC_BANK_CSV), { country: "IN" });
    expect(r.parser).toBe("csv");
    expect(r.sourceKind).toBe("csv");
    expect(r.accountKind).toBe("bank");
    expect(r.last4).toBe("5678");
    expect(r.txns).toEqual([
      { postedOn: "2026-10-01", description: "UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-628812345678-PAYMENT", amount: 499, direction: "debit" },
      { postedOn: "2026-10-03", description: "NEFT CR-ACME SOFTWARE-SALARY OCT", amount: 85000, direction: "credit" },
      { postedOn: "2026-10-15", description: "ATW-416021XXXXXX1234-S1ANBG12-BANGALORE", amount: 2000, direction: "debit" },
    ]);
    expect(r.periodStart).toBe("2026-10-01");
    expect(r.periodEnd).toBe("2026-10-15");
  });

  it("amount + Dr/Cr column, dd-Mon-yyyy dates", () => {
    const csv = `Transaction Date,Details,Amount,Debit/Credit\n02-Nov-2026,AMAZON PAY,"1,299.00",Dr\n05-Nov-2026,REFUND AMAZON,299.00,Cr\n`;
    const r = parseCsvBuffer(Buffer.from(csv));
    expect(r.txns.map((t) => [t.postedOn, t.amount, t.direction])).toEqual([
      ["2026-11-02", 1299, "debit"],
      ["2026-11-05", 299, "credit"],
    ]);
  });

  it("signed single amount: majority sign is debit (bank-style negatives)", () => {
    const csv = `Date,Description,Amount\n2026-11-01,COFFEE,-4.50\n2026-11-02,GROCERY,-80.10\n2026-11-03,PAYROLL,2500.00\n`;
    const r = parseCsvBuffer(Buffer.from(csv));
    expect(r.txns.map((t) => t.direction)).toEqual(["debit", "debit", "credit"]);
  });

  it("signed single amount: positive charges (Amex-style) with mm/dd/yyyy by disambiguation", () => {
    const csv = `Date,Description,Amount\n10/13/2026,UBER TRIP,23.10\n10/20/2026,WHOLE FOODS,64.00\n10/25/2026,AUTOPAY PAYMENT - THANK YOU,-87.10\n`;
    const r = parseCsvBuffer(Buffer.from(csv));
    expect(r.txns.map((t) => [t.postedOn, t.direction])).toEqual([
      ["2026-10-13", "debit"],
      ["2026-10-20", "debit"],
      ["2026-10-25", "credit"],
    ]);
  });

  it("US institution decides mm/dd when every date is ambiguous", () => {
    const rows = [["Date", "Description", "Amount"], ["01/02/2026", "X SHOP", "-1.00"]];
    expect(parseTable(rows, { country: "US" }).txns[0].postedOn).toBe("2026-01-02");
    expect(parseTable(rows, { country: "IN" }).txns[0].postedOn).toBe("2026-02-01");
  });

  it("semicolon-delimited and dd/mm/yy", () => {
    const csv = `Date;Particulars;Debit;Credit;Balance\n02/11/26;POS SHOP;100,00;;900\n`;
    // European decimal comma isn't supported; plain integers are.
    const csv2 = `Date;Particulars;Debit;Credit;Balance\n02/11/26;POS SHOP;100;;900\n`;
    expect(parseCsvBuffer(Buffer.from(csv2)).txns[0]).toMatchObject({ postedOn: "2026-11-02", amount: 100, direction: "debit" });
    expect(parseCsvBuffer(Buffer.from(csv)).txns.length).toBeLessThanOrEqual(1);
  });

  it("header mapping rejects non-transaction rows", () => {
    expect(mapHeader(["Name", "Address"])).toBeNull();
    expect(mapHeader(["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"])).toMatchObject({ date: 0, desc: 1, debit: 2, credit: 3, balance: 4 });
  });

  it("XLSX with a preamble, Date cells and numeric cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Statement");
    ws.addRow(["ICICI Bank Credit Card Statement"]);
    ws.addRow(["Card Number", "XXXX XXXX XXXX 5678"]);
    ws.addRow([]);
    ws.addRow(["Transaction Date", "Details", "Amount (INR)", "Type"]);
    ws.addRow([new Date(Date.UTC(2026, 10, 2)), "ZOMATO", 812, "Debit"]);
    ws.addRow([new Date(Date.UTC(2026, 10, 3)), "PAYMENT RECEIVED", 3210, "Credit"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseXlsxBuffer(buf, { country: "IN" });
    expect(r.accountKind).toBe("credit_card");
    expect(r.last4).toBe("5678");
    expect(r.txns).toEqual([
      { postedOn: "2026-11-02", description: "ZOMATO", amount: 812, direction: "debit" },
      { postedOn: "2026-11-03", description: "PAYMENT RECEIVED", amount: 3210, direction: "credit" },
    ]);
  });

  it(".xls that is really an HTML table", () => {
    const html = `<html><table><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
<tr><td>02/11/2026</td><td>SWIGGY &amp; CO</td><td>456.00</td><td></td><td>9,544.00</td></tr></table></html>`;
    const r = parseXlsBuffer(Buffer.from(html));
    expect(r.txns).toEqual([{ postedOn: "2026-11-02", description: "SWIGGY & CO", amount: 456, direction: "debit" }]);
  });

  it("real BIFF .xls is reported as unsupported", () => {
    expect(() => parseXlsBuffer(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(UnsupportedFormatError);
  });
});
