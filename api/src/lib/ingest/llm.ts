// Claude extraction + categorization with tool use and Zod validation.
// Pure module: the caller passes the client and model (env stays out, so the
// response handling is unit-testable with a mocked client).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATEGORY_KEYS, type Category } from "../categories.js";
import type { ParsedTxn, ParseResult } from "./types.js";

export type LlmClient = Pick<Anthropic, "messages">;

// Models that reject forced tool_choice ("tool"/"any") with a 400: ask for the
// tool with tool_choice auto + an explicit instruction instead.
const NO_FORCED_TOOL = /^claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/;

function toolRequest(model: string, toolName: string) {
  if (NO_FORCED_TOOL.test(model)) {
    return { tool_choice: { type: "auto" as const }, extra: `Respond ONLY by calling the ${toolName} tool exactly once.` };
  }
  // Forced tool use is incompatible with extended thinking; models that think
  // by default (e.g. Haiku 5.5) need it switched off explicitly.
  return { tool_choice: { type: "tool" as const, name: toolName }, thinking: { type: "disabled" as const }, extra: "" };
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optNum = z.number().finite().nullable().optional();

export const llmTxnSchema = z.object({
  date: DATE,
  description: z.string().trim().min(1).max(300),
  amount: z.number().finite().positive(),
  direction: z.enum(["debit", "credit"]),
});

export const llmStatementSchema = z.object({
  institutionName: z.string().max(120).nullable().optional(),
  accountKind: z.enum(["credit_card", "bank", "unknown"]),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  periodStart: DATE.nullable().optional(),
  periodEnd: DATE.nullable().optional(),
  previousBalance: optNum,
  totalDue: optNum,
  closingBalance: optNum,
  transactions: z.array(z.unknown()),
});

const STATEMENT_TOOL = {
  name: "record_statement",
  description: "Record the account metadata and every transaction line found in a bank or credit-card statement.",
  input_schema: {
    type: "object" as const,
    properties: {
      institutionName: { type: ["string", "null"], description: "Issuing bank / card company, e.g. 'HDFC Bank'" },
      accountKind: { type: "string", enum: ["credit_card", "bank", "unknown"] },
      last4: { type: ["string", "null"], description: "Last 4 digits of the card or account number" },
      currency: { type: "string", description: "ISO 4217 code, e.g. INR or USD" },
      periodStart: { type: ["string", "null"], description: "YYYY-MM-DD" },
      periodEnd: { type: ["string", "null"], description: "YYYY-MM-DD" },
      previousBalance: { type: ["number", "null"], description: "Previous / opening balance" },
      totalDue: { type: ["number", "null"], description: "Credit cards: total amount due" },
      closingBalance: { type: ["number", "null"], description: "Bank accounts: closing balance" },
      transactions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            description: { type: "string" },
            amount: { type: "number", description: "Always positive" },
            direction: { type: "string", enum: ["debit", "credit"], description: "debit = money out / charge; credit = payment, refund, deposit" },
          },
          required: ["date", "description", "amount", "direction"],
        },
      },
    },
    required: ["accountKind", "currency", "transactions"],
  },
};

const STATEMENT_SYSTEM = `You extract transactions from Indian and US bank and credit-card statements (text extracted from a PDF; columns are separated by runs of spaces).
Rules:
- Record every individual transaction line exactly once: date (YYYY-MM-DD), description as printed, amount as a positive number, direction.
- Credit card: purchases, fees, interest and GST are debits; payments, refunds, reversals and cashback are credits ("Cr" suffix).
- Bank account: withdrawals are debits, deposits are credits. Never record the running balance as an amount.
- EXCLUDE summary rows: opening/closing/previous balance lines, totals, minimum due, credit limits, reward point tables, EMI schedules, and anything that is not a single dated transaction.
- If a field is not present, use null. Do not invent transactions.`;

export const LLM_CHUNK_CHARS = 40_000;

/** Group pages into chunks of at most ~maxChars (a single huge page becomes its own chunk). */
export function chunkPages(pages: string[], maxChars = LLM_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const p of pages) {
    if (cur && cur.length + p.length > maxChars) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\f\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

function toolInput(res: { content: Array<{ type: string }> }, name: string): unknown {
  const block = res.content.find((b) => b.type === "tool_use" && (b as Anthropic.ToolUseBlock).name === name) as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error("llm: no tool_use block");
  return block.input;
}

/** Validate one record_statement tool input. Drops individual bad rows; rejects when too many are bad. */
export function validateStatementInput(input: unknown): Omit<ParseResult, "parser" | "sourceKind"> {
  const parsed = llmStatementSchema.safeParse(input);
  if (!parsed.success) throw new Error("llm: statement output failed validation");
  const d = parsed.data;
  const txns: ParsedTxn[] = [];
  let bad = 0;
  for (const raw of d.transactions) {
    const t = llmTxnSchema.safeParse(raw);
    if (!t.success) {
      bad++;
      continue;
    }
    txns.push({ postedOn: t.data.date, description: t.data.description, amount: Math.round(t.data.amount * 100) / 100, direction: t.data.direction });
  }
  if (bad > Math.max(2, d.transactions.length * 0.2)) throw new Error("llm: too many invalid transactions");
  return {
    institutionName: d.institutionName ?? null,
    accountKind: d.accountKind,
    last4: d.last4 ?? null,
    currency: d.currency,
    periodStart: d.periodStart ?? null,
    periodEnd: d.periodEnd ?? null,
    previousBalance: d.previousBalance ?? null,
    totalDue: d.totalDue ?? null,
    closingBalance: d.closingBalance ?? null,
    txns,
  };
}

export type LlmImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: Buffer };

/** Extract a statement. `pages` are text pages, or pass `image` for a photo. Throws on any failure (caller falls back). */
export async function extractStatementWithLlm(client: LlmClient, model: string, input: { pages?: string[]; image?: LlmImage }): Promise<ParseResult> {
  const req = toolRequest(model, STATEMENT_TOOL.name);
  const chunks = input.image ? [""] : chunkPages(input.pages ?? []);
  if (!chunks.length) throw new Error("llm: empty input");
  let merged: ParseResult | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const content: Anthropic.ContentBlockParam[] = input.image
      ? [
          { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data.toString("base64") } },
          { type: "text", text: `Extract this statement photo. ${req.extra}`.trim() },
        ]
      : [
          {
            type: "text",
            text: `${chunks.length > 1 ? `Statement part ${i + 1} of ${chunks.length}.${i > 0 ? " Metadata may be absent in this part; record its transactions." : ""}\n` : ""}<statement>\n${chunks[i]}\n</statement>\n${req.extra}`.trim(),
          },
        ];
    const res = await client.messages.create({
      model,
      max_tokens: 16_000,
      system: STATEMENT_SYSTEM,
      tools: [STATEMENT_TOOL as unknown as Anthropic.Tool],
      tool_choice: req.tool_choice,
      ...(req.thinking ? { thinking: req.thinking } : {}),
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "max_tokens") throw new Error("llm: output truncated");
    const part = validateStatementInput(toolInput(res, STATEMENT_TOOL.name));
    if (!merged) merged = { parser: "llm", sourceKind: "statement", ...part };
    else merged.txns.push(...part.txns);
  }
  return merged!;
}

const CATEGORIZE_TOOL = {
  name: "categorize_transactions",
  description: "Assign a clean merchant name and a spending category to each transaction.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            merchant: { type: "string", description: "Short human-readable merchant name, e.g. 'Swiggy'" },
            category: { type: "string", enum: CATEGORY_KEYS },
          },
          required: ["index", "merchant", "category"],
        },
      },
    },
    required: ["items"],
  },
};

const categorizeSchema = z.object({
  items: z.array(z.object({ index: z.number().int().nonnegative(), merchant: z.string().trim().min(1).max(60), category: z.string() })),
});

/** Categorize descriptions Claude-side. Returns index → result; unknown categories are dropped. Throws on API/shape errors. */
export async function categorizeWithLlm(
  client: LlmClient,
  model: string,
  items: Array<{ description: string; direction: "debit" | "credit" }>,
): Promise<Map<number, { merchant: string; category: Category }>> {
  const out = new Map<number, { merchant: string; category: Category }>();
  if (!items.length) return out;
  const req = toolRequest(model, CATEGORIZE_TOOL.name);
  const list = items.slice(0, 100).map((it, i) => `${i}\t${it.direction}\t${it.description.slice(0, 120)}`).join("\n");
  const res = await client.messages.create({
    model,
    max_tokens: 8_000,
    system: `Categorize Indian/US card and bank transactions. Categories: ${CATEGORY_KEYS.join(", ")}. "card_payment" = paying a credit-card bill; "transfers" = person-to-person UPI/NEFT; use "other" only when nothing fits.`,
    tools: [CATEGORIZE_TOOL as unknown as Anthropic.Tool],
    tool_choice: req.tool_choice,
    ...(req.thinking ? { thinking: req.thinking } : {}),
    messages: [{ role: "user", content: `index\tdirection\tdescription\n${list}\n${req.extra}`.trim() }],
  });
  const parsed = categorizeSchema.safeParse(toolInput(res, CATEGORIZE_TOOL.name));
  if (!parsed.success) throw new Error("llm: categorize output failed validation");
  for (const it of parsed.data.items) {
    if (it.index >= Math.min(items.length, 100)) continue;
    if (!(CATEGORY_KEYS as string[]).includes(it.category)) continue;
    out.set(it.index, { merchant: it.merchant, category: it.category as Category });
  }
  return out;
}
