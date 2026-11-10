import { describe, expect, it, vi } from "vitest";
import { categorizeWithLlm, chunkPages, extractStatementWithLlm, type LlmClient } from "../../src/lib/ingest/llm.js";

function mockClient(responses: Array<{ input: unknown; stop_reason?: string; name?: string } | Error>) {
  const create = vi.fn(async () => {
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    if (r instanceof Error) throw r;
    return { stop_reason: r.stop_reason ?? "tool_use", content: [{ type: "tool_use", id: "t1", name: r.name ?? "record_statement", input: r.input }] };
  });
  return { client: { messages: { create } } as unknown as LlmClient, create };
}

const good = {
  institutionName: "HDFC Bank",
  accountKind: "credit_card",
  last4: "1234",
  currency: "INR",
  periodStart: "2026-10-06",
  periodEnd: "2026-11-05",
  previousBalance: 100,
  totalDue: 556,
  closingBalance: null,
  transactions: [
    { date: "2026-10-08", description: "SWIGGY", amount: 456, direction: "debit" },
    { date: "2026-10-09", description: "PAYMENT", amount: 100, direction: "credit" },
  ],
};

describe("LLM statement extraction (mocked client)", () => {
  it("validates and maps the forced tool output", async () => {
    const { client, create } = mockClient([{ input: good }]);
    const r = await extractStatementWithLlm(client, "claude-haiku-5-5", { pages: ["page 1 text"] });
    expect(r).toMatchObject({ parser: "llm", sourceKind: "statement", accountKind: "credit_card", last4: "1234", totalDue: 556, institutionName: "HDFC Bank" });
    expect(r.txns).toEqual([
      { postedOn: "2026-10-08", description: "SWIGGY", amount: 456, direction: "debit" },
      { postedOn: "2026-10-09", description: "PAYMENT", amount: 100, direction: "credit" },
    ]);
    const params = (create.mock.calls[0] as unknown[])[0] as { tool_choice: unknown; thinking?: unknown; model: string };
    expect(params.tool_choice).toEqual({ type: "tool", name: "record_statement" });
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.model).toBe("claude-haiku-5-5");
  });

  it("uses tool_choice auto for models that reject forced tools", async () => {
    const { client, create } = mockClient([{ input: good }]);
    await extractStatementWithLlm(client, "claude-opus-5-5", { pages: ["x"] });
    const params = (create.mock.calls[0] as unknown[])[0] as { tool_choice: unknown; thinking?: unknown };
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.thinking).toBeUndefined();
  });

  it("chunks long text and merges transactions, metadata from the first chunk", async () => {
    const second = { ...good, last4: "9999", totalDue: 1, transactions: [{ date: "2026-10-20", description: "UBER", amount: 300, direction: "debit" }] };
    const { client, create } = mockClient([{ input: good }, { input: second }]);
    const pages = ["a".repeat(30_000), "b".repeat(30_000)];
    expect(chunkPages(pages)).toHaveLength(2);
    const r = await extractStatementWithLlm(client, "claude-haiku-5-5", { pages });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.last4).toBe("1234");
    expect(r.totalDue).toBe(556);
    expect(r.txns.map((t) => t.description)).toEqual(["SWIGGY", "PAYMENT", "UBER"]);
  });

  it("rejects invalid output so the caller falls back to rules", async () => {
    await expect(extractStatementWithLlm(mockClient([{ input: { accountKind: "savings", transactions: [] } }]).client, "m", { pages: ["x"] })).rejects.toThrow(/validation/);
    const junk = { ...good, transactions: [1, 2, 3, { date: "02/11/2026", description: "x", amount: -5, direction: "debit" }] };
    await expect(extractStatementWithLlm(mockClient([{ input: junk }]).client, "m", { pages: ["x"] })).rejects.toThrow(/invalid transactions/);
    await expect(extractStatementWithLlm(mockClient([{ input: good, stop_reason: "max_tokens" }]).client, "m", { pages: ["x"] })).rejects.toThrow(/truncated/);
    await expect(extractStatementWithLlm(mockClient([new Error("529 overloaded")]).client, "m", { pages: ["x"] })).rejects.toThrow();
  });

  it("drops a single bad row but keeps the rest", async () => {
    const many = { ...good, transactions: [...good.transactions, ...Array.from({ length: 10 }, (_, i) => ({ date: "2026-10-1" + (i % 10), description: "S" + i, amount: 10, direction: "debit" })), { date: "bad", description: "x", amount: 1, direction: "debit" }] };
    const r = await extractStatementWithLlm(mockClient([{ input: many }]).client, "m", { pages: ["x"] });
    expect(r.txns).toHaveLength(12);
  });
});

describe("LLM categorization (mocked client)", () => {
  it("keeps only valid categories and in-range indexes", async () => {
    const { client } = mockClient([
      {
        name: "categorize_transactions",
        input: {
          items: [
            { index: 0, merchant: "Chai Point", category: "dining" },
            { index: 1, merchant: "Weird", category: "not_a_category" },
            { index: 7, merchant: "Out of range", category: "other" },
          ],
        },
      },
    ]);
    const r = await categorizeWithLlm(client, "claude-haiku-5-5", [
      { description: "CHAI POINT BLR", direction: "debit" },
      { description: "XYZ", direction: "debit" },
    ]);
    expect([...r.entries()]).toEqual([[0, { merchant: "Chai Point", category: "dining" }]]);
  });

  it("throws on a malformed response", async () => {
    const { client } = mockClient([{ name: "categorize_transactions", input: { nope: true } }]);
    await expect(categorizeWithLlm(client, "m", [{ description: "x", direction: "debit" }])).rejects.toThrow();
  });
});
