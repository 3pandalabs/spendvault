// Receipt vs statement classification heuristics. Pure module (no env/db).
//
// These only decide which pipeline a document goes to. They are deliberately
// conservative: anything that smells like a bank statement or a bank alert is
// NOT a receipt, so statement handling never regresses.

const RECEIPT_TERMS: Array<[string, RegExp]> = [
  ["tax_invoice", /\btax\s+invoice\b/i],
  ["invoice_no", /\binvoice\s*(?:no|number|#|date)\b/i],
  ["bill_no", /\bbill\s*(?:no|number|#|date)\b/i],
  ["receipt", /\b(?:e-?)?receipt\b/i],
  ["order_id", /\border\s*(?:id|no|number|#|summary|total|details)\b/i],
  ["gstin", /\bgstin\b/i],
  ["hsn", /\bhsn\b/i],
  ["qty", /\b(?:qty|quantity)\b/i],
  ["subtotal", /\bsub\s*-?\s*total\b/i],
  ["grand_total", /\b(?:grand|net|bill|item|order)\s+total\b/i],
  ["amount_paid", /\b(?:amount|total)\s+paid\b|\byou\s+paid\b/i],
  ["cashier", /\b(?:cashier|counter|till)\b/i],
  ["mrp", /\bmrp\b/i],
  ["cgst", /\b(?:cgst|sgst|utgst)\b/i],
  ["thank_you_shopping", /\bthank\s+you\s+for\s+(?:shopping|your\s+(?:order|purchase))\b|\bvisit\s+again\b/i],
];

// Statement furniture: any one of these and it's not a receipt.
const STATEMENT_TERMS =
  /\b(?:statement\s+(?:date|period|summary)|account\s+statement|card\s+statement|opening\s+balance|closing\s+balance|previous\s+balance|total\s+(?:amount\s+)?due|minimum\s+(?:amount\s+)?due|credit\s+limit|available\s+(?:credit\s+)?limit|payment\s+due\s+date|account\s+summary)\b/i;

// Bank alert phrasing ("Rs 500 debited from A/c XX12"): an alert, not a receipt.
const BANK_ALERT_TERMS = /\b(?:a\/c|acct\s*(?:no|xx)|avl\.?\s*bal|available\s+balance|debited\s+from|credited\s+to\s+your\s+(?:a\/c|account)|upi\s+ref)\b/i;

const MONEY = /(?:rs\.?|inr|₹|\$|usd)\s?\d|\d[\d,]*\.\d{2}\b/i;

/** Distinct receipt cues present in the text. */
export function receiptCues(text: string): string[] {
  const t = text.slice(0, 20_000);
  return RECEIPT_TERMS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

export function looksLikeStatementText(text: string): boolean {
  return STATEMENT_TERMS.test(text.slice(0, 20_000));
}

/** A receipt / invoice / e-bill (not a statement, not a bank alert). */
export function looksLikeReceipt(text: string): boolean {
  const t = text.slice(0, 20_000);
  if (!t.trim() || looksLikeStatementText(t) || BANK_ALERT_TERMS.test(t)) return false;
  if (!MONEY.test(t)) return false;
  return receiptCues(t).length >= 2;
}

/** Subject line of an order / payment confirmation or e-bill (never a statement). */
export function looksLikeReceiptSubject(subject: string | null | undefined): boolean {
  const s = subject ?? "";
  if (/statement/i.test(s)) return false;
  return /\b(?:receipt|invoice|e-?bill|your\s+(?:\w+\s+)?order|order\s+(?:confirmed|confirmation|delivered|#|id)|payment\s+(?:successful|received|confirmation)|purchase\s+confirmation|trip\s+with|booking\s+confirm)/i.test(s);
}

/** Image attachments big enough to be a photo/scan rather than a logo or tracking pixel. */
export const MIN_RECEIPT_IMAGE_BYTES = 20 * 1024;
