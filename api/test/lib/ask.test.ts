import { describe, expect, it, vi } from "vitest";
import { askSpendVault } from "../../src/lib/ask/run.js";
import { MAX_ROWS, runTool, TOOL_DEFS, TOOL_NAMES, TOOL_SCHEMAS, ToolInputError, type AskData } from "../../src/lib/ask/tools.js";
import type { LlmClient } from "../../src/lib/ingest/llm.js";
import { txn } from "../insights/helpers.js";

const u = (p: Parameters<typeof txn>[0]) => txn({ currency: "USD", ...p });

function fakeData(rows = [
  u({ postedOn: "2026-10-03", amount: 5.75, merchant: "Starbucks", category: "dining", descriptionRaw: "STARBUCKS STORE 123" }),
  u({ postedOn: "2026-10-17", amount: 6.25, merchant: "Starbucks", category: "dining", descriptionRaw: "STARBUCKS STORE 123" }),
  u({ postedOn: "2026-10-20", amount: 120, merchant: "Kroger", category: "groceries" }),
  u({ postedOn: "2026-10-21", amount: 900, merchant: "Card bill payment", category: "card_payment" }),
  u({ postedOn: "2026-10-25", amount: 2500, direction: "credit", category: "income", merchant: "Payroll" }),
  u({ postedOn: "2026-11-02", amount: 7, merchant: "Starbucks", category: "dining" }),
]) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const data: AskData = {
    currency: "USD",
    today: "2026-11-27",
    txns: async (...args) => (calls.push({ fn: "txns", args }), rows),
    receiptItems: async (...args) => (calls.push({ fn: "receiptItems", args }), [{ name: "Large Eggs", merchant: "Kroger", purchasedOn: "2026-10-20", lineTotal: 4.12, quantity: 1, unitPrice: 4.12, category: "groceries" }]),
    subscriptions: async () => ({ currency: "USD", monthlyTotal: 15.49, yearlyTotal: 185.88, items: [] }),
    cardDues: async () => [],
    budgets: async (month) => ({ month, items: [], monthlyBudget: null }),
    goals: async () => [],
  };
  return { data, calls };
}

describe("Ask tools: fixed, validated, user-scoped", () => {
  it("every tool definition has a schema and rejects unknown fields (no user id / SQL smuggling)", async () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const def of TOOL_DEFS) expect(def.input_schema.additionalProperties).toBe(false);
    const { data } = fakeData();
    await expect(runTool("spending_summary", { from: "2026-10-01", to: "2026-10-31", userId: "someone-else" }, data)).rejects.toBeInstanceOf(ToolInputError);
    await expect(runTool("find_transactions", { from: "2026-10-01", to: "2026-10-31", sql: "select * from users" }, data)).rejects.toBeInstanceOf(ToolInputError);
    await expect(runTool("subscriptions", { userId: "x" }, data)).rejects.toBeInstanceOf(ToolInputError);
    await expect(runTool("drop_table", {}, data)).rejects.toBeInstanceOf(ToolInputError);
  });
  it("caps ranges and row counts", async () => {
    const { data } = fakeData();
    await expect(runTool("spending_summary", { from: "2020-01-01", to: "2026-10-31" }, data)).rejects.toThrow("3 years");
    await expect(runTool("spending_summary", { from: "2026-11-01", to: "2026-10-01" }, data)).rejects.toThrow("before");
    await expect(runTool("find_transactions", { from: "2026-10-01", to: "2026-10-31", limit: 500 }, data)).rejects.toBeInstanceOf(ToolInputError);
    expect(TOOL_SCHEMAS.find_transactions.safeParse({ from: "2026-10-01", to: "2026-10-31", limit: MAX_ROWS }).success).toBe(true);
  });
  it("tools only read through the AskData they were given", async () => {
    const { data, calls } = fakeData();
    await runTool("receipt_items", { from: "2026-10-01", to: "2026-10-31", text: "eggs" }, data);
    expect(calls).toEqual([{ fn: "receiptItems", args: ["2026-10-01", "2026-10-31"] }]);
  });
  it("spending_summary: merchant filter, refunds/card payments excluded, income reported", async () => {
    const { data } = fakeData();
    const coffee = (await runTool("spending_summary", { from: "2026-10-01", to: "2026-10-31", merchant: "starbucks", group_by: "none" }, data)) as { total: number; purchases: number; income?: number };
    expect(coffee.total).toBe(12);
    expect(coffee.purchases).toBe(2);
    expect(coffee.income).toBeUndefined();
    const all = (await runTool("spending_summary", { from: "2026-10-01", to: "2026-10-31" }, data)) as { total: number; income: number; groups: Array<{ label: string }> };
    expect(all.total).toBe(132);
    expect(all.income).toBe(2500);
    expect(all.groups[0].label).toBe("Groceries");
  });
  it("find_transactions sorts and limits", async () => {
    const { data } = fakeData();
    const r = (await runTool("find_transactions", { from: "2026-10-01", to: "2026-11-30", sort: "largest", limit: 2, direction: "debit" }, data)) as { count: number; items: Array<{ amount: number }> };
    expect(r.count).toBe(5);
    expect(r.items.map((i) => i.amount)).toEqual([900, 120]);
  });
});

type Block = { type: string; [k: string]: unknown };
const resp = (content: Block[], stop: string, usage = { input_tokens: 100, output_tokens: 20 }) => ({ content, stop_reason: stop, usage });

describe("Ask loop", () => {
  it("runs the requested tool, feeds the result back, returns the answer and token usage", async () => {
    const { data } = fakeData();
    const create = vi
      .fn()
      .mockResolvedValueOnce(resp([{ type: "tool_use", id: "tu1", name: "spending_summary", input: { from: "2026-10-01", to: "2026-10-31", merchant: "starbucks", group_by: "none" } }], "tool_use"))
      .mockResolvedValueOnce(resp([{ type: "text", text: "You spent $12.00 at Starbucks in October." }], "end_turn"));
    const client = { messages: { create } } as unknown as LlmClient;
    const r = await askSpendVault(client, "claude-haiku-5-5", { question: "How much on coffee in October?", data });
    expect(r.answer).toBe("You spent $12.00 at Starbucks in October.");
    expect(r.toolsUsed).toEqual(["spending_summary"]);
    expect(r).toMatchObject({ toolCalls: 1, inputTokens: 200, outputTokens: 40, stop: "answered" });
    const second = create.mock.calls[1][0];
    expect(second.tool_choice).toEqual({ type: "auto" });
    const toolResult = second.messages.at(-1).content[0];
    expect(toolResult.tool_use_id).toBe("tu1");
    expect(JSON.parse(toolResult.content).total).toBe(12);
    expect(second.messages[0].content).toContain("Today is 2026-11-27");
  });
  it("bad tool input goes back as an error result, not a crash", async () => {
    const { data } = fakeData();
    const create = vi
      .fn()
      .mockResolvedValueOnce(resp([{ type: "tool_use", id: "t", name: "find_transactions", input: { from: "2026-10-01", to: "2026-10-31", userId: "other" } }], "tool_use"))
      .mockResolvedValueOnce(resp([{ type: "text", text: "Sorry." }], "end_turn"));
    const r = await askSpendVault({ messages: { create } } as unknown as LlmClient, "m", { question: "q?", data });
    const tr = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(tr.is_error).toBe(true);
    expect(r.answer).toBe("Sorry.");
  });
  it("refusals and runaway loops end cleanly; history alternates", async () => {
    const { data } = fakeData();
    const refuse = vi.fn().mockResolvedValue(resp([], "refusal"));
    expect((await askSpendVault({ messages: { create: refuse } } as unknown as LlmClient, "m", { question: "q", data })).stop).toBe("refused");
    const loop = vi.fn().mockResolvedValue(resp([{ type: "tool_use", id: "x", name: "subscriptions", input: {} }], "tool_use"));
    const r = await askSpendVault({ messages: { create: loop } } as unknown as LlmClient, "m", {
      question: "q",
      data,
      history: [
        { role: "assistant", text: "dropped: can't start with assistant" },
        { role: "user", text: "earlier q" },
        { role: "user", text: "dup user dropped" },
        { role: "assistant", text: "earlier a" },
      ],
    });
    expect(r.stop).toBe("too_many_steps");
    // (the SDK call receives the live array; the first three entries are history + the question)
    const msgs = loop.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>;
    expect(msgs.slice(0, 3).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toBe("earlier q");
    expect(String(msgs[2].content)).toContain("Question: q");
  });
});
