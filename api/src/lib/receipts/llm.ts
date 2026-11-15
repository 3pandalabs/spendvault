// Claude receipt extraction (vision for photos, PDF document blocks for scans,
// plain text for e-receipts) with tool use + Zod validation. Pure module: the
// caller passes the client and model, so it unit-tests with a mocked client.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATEGORY_KEYS, type Category } from "../categories.js";
import { toolInput, toolRequest, type LlmClient, type LlmImage } from "../ingest/llm.js";
import { round2 } from "../money.js";

export type ReceiptItemParsed = {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number; // may be negative for a discount line
  category: Category | null;
};

export type ReceiptExtraction = {
  isReceipt: boolean;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  currency: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: ReceiptItemParsed[];
  itemsReconciled: boolean | null;
};

export type ReceiptInput = { image?: LlmImage; pdf?: Buffer; text?: string };

const RECEIPT_TOOL = {
  name: "record_receipt",
  description: "Record what a shop receipt, tax invoice, e-bill or order confirmation says: merchant, date, totals and every line item.",
  input_schema: {
    type: "object" as const,
    properties: {
      isReceipt: { type: "boolean", description: "false if this is NOT a purchase receipt/invoice (e.g. a bank statement, a bank alert, an ad)" },
      merchant: { type: ["string", "null"], description: "Shop / brand name as a customer would call it, e.g. 'DMart', 'Swiggy'" },
      date: { type: ["string", "null"], description: "Purchase date, YYYY-MM-DD" },
      currency: { type: "string", description: "ISO 4217 code, e.g. INR or USD" },
      subtotal: { type: ["number", "null"] },
      tax: { type: ["number", "null"], description: "Total tax (GST/CGST+SGST/IGST/VAT/sales tax) if printed separately" },
      total: { type: ["number", "null"], description: "Final amount paid, after discounts, tax, tip and round-off" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Item as printed, lightly cleaned up" },
            quantity: { type: ["number", "null"] },
            unitPrice: { type: ["number", "null"] },
            lineTotal: { type: "number", description: "Amount for this line; negative for a discount line" },
            category: { type: "string", enum: CATEGORY_KEYS, description: "Spending category of THIS item (a kettle at a grocery store is 'shopping')" },
          },
          required: ["name", "lineTotal", "category"],
        },
      },
    },
    required: ["isReceipt", "currency", "items"],
  },
};

const RECEIPT_SYSTEM = `You read purchase receipts, tax invoices, e-bills and order confirmations (mostly Indian, some US).
Rules:
- Record each purchased line item once with its line total. Discounts/coupons are separate lines with a negative lineTotal.
- Do NOT record tax, subtotal, total, round-off, tip, delivery or packing fees as items unless they are charged as a separate line the customer paid for (delivery/packing fees ARE items).
- total is the final amount paid. If a field is not printed, use null. Never guess numbers you cannot read.
- If the document is not a purchase receipt (bank statement, transaction alert, advertisement), set isReceipt false and leave the rest empty.`;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optNum = z.number().finite().nullable().optional();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().nullable().optional(),
  unitPrice: z.number().finite().nullable().optional(),
  lineTotal: z.number().finite().refine((n) => n !== 0, "zero line"),
  category: z.string().optional().nullable(),
});

const receiptSchema = z.object({
  isReceipt: z.boolean(),
  merchant: z.string().trim().max(120).nullable().optional(),
  date: z.string().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).catch("INR").default("INR"),
  subtotal: optNum,
  tax: optNum,
  total: optNum,
  items: z.array(z.unknown()).default([]),
});

export const MAX_RECEIPT_ITEMS = 200;

/** Items (+ tax) add up to the total within max(₹1, 2%). null when there's nothing to compare. */
export function itemsReconcile(items: Array<{ lineTotal: number }>, tax: number | null, total: number | null): boolean | null {
  if (total === null || total <= 0 || items.length === 0) return null;
  const sum = items.reduce((s, i) => s + i.lineTotal, 0);
  const tol = Math.max(1, total * 0.02);
  return Math.abs(sum - total) <= tol || (tax !== null && Math.abs(sum + tax - total) <= tol);
}

/** Validate one record_receipt tool input. Drops bad item rows; rejects a malformed envelope. */
export function validateReceiptInput(input: unknown): ReceiptExtraction {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) throw new Error("llm: receipt output failed validation");
  const d = parsed.data;
  const empty: ReceiptExtraction = { isReceipt: false, merchant: null, date: null, currency: d.currency, subtotal: null, tax: null, total: null, items: [], itemsReconciled: null };
  if (!d.isReceipt) return empty;
  const items: ReceiptItemParsed[] = [];
  for (const raw of d.items.slice(0, MAX_RECEIPT_ITEMS)) {
    const r = itemSchema.safeParse(raw);
    if (!r.success) continue;
    const cat = r.data.category && (CATEGORY_KEYS as string[]).includes(r.data.category) ? (r.data.category as Category) : null;
    items.push({
      name: r.data.name,
      quantity: r.data.quantity ?? null,
      unitPrice: r.data.unitPrice === null || r.data.unitPrice === undefined ? null : round2(r.data.unitPrice),
      lineTotal: round2(r.data.lineTotal),
      category: cat,
    });
  }
  const total = d.total !== null && d.total !== undefined && d.total > 0 ? round2(d.total) : null;
  const tax = d.tax !== null && d.tax !== undefined && d.tax >= 0 ? round2(d.tax) : null;
  const date = d.date && DATE.safeParse(d.date).success ? d.date : null;
  return {
    isReceipt: true,
    merchant: d.merchant ? d.merchant : null,
    date,
    currency: d.currency,
    subtotal: d.subtotal ?? null,
    tax,
    total,
    items,
    itemsReconciled: itemsReconcile(items, tax, total),
  };
}

/** One Claude call. Throws on any API/shape failure (the caller marks the receipt pending). */
export async function extractReceiptWithLlm(client: LlmClient, model: string, input: ReceiptInput): Promise<ReceiptExtraction> {
  const req = toolRequest(model, RECEIPT_TOOL.name);
  let content: Anthropic.ContentBlockParam[];
  if (input.image) {
    content = [
      { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data.toString("base64") } },
      { type: "text", text: `Read this receipt photo. ${req.extra}`.trim() },
    ];
  } else if (input.pdf) {
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf.toString("base64") } },
      { type: "text", text: `Read this receipt / invoice. ${req.extra}`.trim() },
    ];
  } else if (input.text?.trim()) {
    content = [{ type: "text", text: `<receipt>\n${input.text.slice(0, 40_000)}\n</receipt>\n${req.extra}`.trim() }];
  } else {
    throw new Error("llm: empty input");
  }
  const res = await client.messages.create({
    model,
    max_tokens: 8_000,
    system: RECEIPT_SYSTEM,
    tools: [RECEIPT_TOOL as unknown as Anthropic.Tool],
    tool_choice: req.tool_choice,
    ...(req.thinking ? { thinking: req.thinking } : {}),
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "max_tokens") throw new Error("llm: output truncated");
  return validateReceiptInput(toolInput(res, RECEIPT_TOOL.name));
}
