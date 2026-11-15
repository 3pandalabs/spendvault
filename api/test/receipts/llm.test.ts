import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../../src/lib/ingest/llm.js";
import { extractReceiptWithLlm, itemsReconcile, validateReceiptInput } from "../../src/lib/receipts/llm.js";

function mockClient(input: unknown, stop_reason = "tool_use") {
  const create = vi.fn(async () => ({ stop_reason, content: [{ type: "tool_use", id: "t1", name: "record_receipt", input }] }));
  return { client: { messages: { create } } as unknown as LlmClient, create };
}

type Params = {
  messages: Array<{ content: Array<{ type: string; text?: string; source?: { media_type: string } }> }>;
  tool_choice: unknown;
  thinking?: unknown;
};
const paramsOf = (create: ReturnType<typeof vi.fn>) => (create.mock.calls[0] as unknown[])[0] as Params;

const dmart = {
  isReceipt: true,
  merchant: "DMart",
  date: "2026-11-12",
  currency: "INR",
  subtotal: 4200,
  tax: 0,
  total: 4200,
  items: [
    { name: "Basmati rice 5kg", quantity: 2, unitPrice: 720, lineTotal: 1440, category: "groceries" },
    { name: "Milk 1L", quantity: 6, unitPrice: 54, lineTotal: 324, category: "groceries" },
    { name: "Atta 10kg", quantity: 1, unitPrice: 1136, lineTotal: 1136, category: "groceries" },
    { name: "Electric kettle", quantity: 1, unitPrice: 1300, lineTotal: 1300, category: "shopping" },
  ],
};

describe("receipt extraction (mocked client)", () => {
  it("validates and maps a photo receipt, sending an image block", async () => {
    const { client, create } = mockClient(dmart);
    const r = await extractReceiptWithLlm(client, "claude-haiku-5-5", { image: { mediaType: "image/jpeg", data: Buffer.from("jpg") } });
    expect(r).toMatchObject({ isReceipt: true, merchant: "DMart", date: "2026-11-12", total: 4200, tax: 0, itemsReconciled: true });
    expect(r.items).toHaveLength(4);
    expect(r.items[3]).toEqual({ name: "Electric kettle", quantity: 1, unitPrice: 1300, lineTotal: 1300, category: "shopping" });
    const params = paramsOf(create);
    expect(params.messages[0].content[0].type).toBe("image");
    expect(params.tool_choice).toEqual({ type: "tool", name: "record_receipt" });
    expect(params.thinking).toEqual({ type: "disabled" });
  });

  it("sends a scanned PDF as a document block and an e-receipt as text", async () => {
    const a = mockClient(dmart);
    await extractReceiptWithLlm(a.client, "claude-haiku-5-5", { pdf: Buffer.from("%PDF-1.4") });
    expect(paramsOf(a.create).messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    const b = mockClient(dmart);
    await extractReceiptWithLlm(b.client, "claude-haiku-5-5", { text: "Order total 4200" });
    const block = paramsOf(b.create).messages[0].content[0];
    expect(block.type).toBe("text");
    expect(block.text).toContain("<receipt>");
  });

  it("uses tool_choice auto for models that reject forced tools", async () => {
    const { client, create } = mockClient(dmart);
    await extractReceiptWithLlm(client, "claude-opus-5-5", { text: "x" });
    expect(paramsOf(create).tool_choice).toEqual({ type: "auto" });
    expect(paramsOf(create).thinking).toBeUndefined();
  });

  it("returns isReceipt=false with nothing else for a non-receipt", () => {
    const r = validateReceiptInput({ isReceipt: false, merchant: "HDFC", currency: "INR", total: 5000, items: [{ name: "x", lineTotal: 1, category: "other" }] });
    expect(r).toMatchObject({ isReceipt: false, merchant: null, total: null, items: [] });
  });

  it("drops bad item rows; unknown categories and unparseable dates become null", () => {
    const r = validateReceiptInput({
      ...dmart,
      date: "12/11/2026",
      items: [
        { name: "", lineTotal: 5 },
        { name: "Thing", lineTotal: 0 },
        { name: "Gadget", lineTotal: 99.999, category: "gizmos" },
        { name: "Coupon", lineTotal: -50, category: "shopping" },
      ],
    });
    expect(r.date).toBeNull();
    expect(r.items).toEqual([
      { name: "Gadget", quantity: null, unitPrice: null, lineTotal: 100, category: null },
      { name: "Coupon", quantity: null, unitPrice: null, lineTotal: -50, category: "shopping" },
    ]);
  });

  it("a missing or zero total stays null (never invented)", () => {
    expect(validateReceiptInput({ ...dmart, total: null }).total).toBeNull();
    expect(validateReceiptInput({ ...dmart, total: 0 }).total).toBeNull();
  });

  it("rejects a malformed envelope, a truncated response and empty input", async () => {
    expect(() => validateReceiptInput({ merchant: "x" })).toThrow();
    const { client } = mockClient(dmart, "max_tokens");
    await expect(extractReceiptWithLlm(client, "claude-haiku-5-5", { text: "x" })).rejects.toThrow(/truncated/);
    await expect(extractReceiptWithLlm(client, "claude-haiku-5-5", {})).rejects.toThrow(/empty/);
  });
});

describe("itemsReconcile", () => {
  it("accepts items == total, items + tax == total, within 2% or ₹1", () => {
    expect(itemsReconcile([{ lineTotal: 100 }, { lineTotal: 50 }], null, 150)).toBe(true);
    expect(itemsReconcile([{ lineTotal: 1000 }], 180, 1180)).toBe(true);
    expect(itemsReconcile([{ lineTotal: 99.4 }], null, 100)).toBe(true);
    expect(itemsReconcile([{ lineTotal: 500 }], null, 1000)).toBe(false);
    expect(itemsReconcile([], null, 100)).toBeNull();
    expect(itemsReconcile([{ lineTotal: 5 }], null, null)).toBeNull();
  });
});
