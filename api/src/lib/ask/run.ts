// Ask SpendVault: a short manual tool-use loop over the fixed tools in
// tools.ts. Pure module (client, model and the user-scoped AskData are passed
// in), so it unit-tests with a mocked client.
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "../ingest/llm.js";
import { ASK_SYSTEM, askUserTurn, runTool, TOOL_DEFS, ToolInputError, type AskData } from "./tools.js";

export const MAX_TOOL_ROUNDS = 6;
export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;

export type AskTurn = { role: "user" | "assistant"; text: string };

export type AskResult = {
  answer: string;
  toolsUsed: string[];
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  stop: "answered" | "refused" | "truncated" | "too_many_steps";
};

const textOf = (content: Anthropic.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

export async function askSpendVault(
  client: LlmClient,
  model: string,
  input: { question: string; history?: readonly AskTurn[]; data: AskData },
): Promise<AskResult> {
  const { data } = input;
  const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS).filter((t) => t.text.trim());
  const messages: Anthropic.MessageParam[] = [];
  for (const t of history) {
    // Strictly alternate user/assistant; drop anything that would break the order.
    const last = messages[messages.length - 1];
    if ((last?.role ?? "assistant") === t.role) continue;
    messages.push({ role: t.role, content: t.text.slice(0, 2000) });
  }
  if (messages[messages.length - 1]?.role === "user") messages.pop();
  messages.push({ role: "user", content: askUserTurn(input.question.slice(0, MAX_QUESTION_CHARS), data.today, data.currency) });

  const used = new Set<string>();
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: ASK_SYSTEM,
      tools: TOOL_DEFS as unknown as Anthropic.Tool[],
      // auto: newer models reject forced tool_choice, and plain chit-chat needs no tool.
      tool_choice: { type: "auto" },
      messages,
    });
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;
    const stop = res.stop_reason as string | null;
    if (stop === "refusal") {
      return { answer: "Sorry, I can't help with that one. Try asking about your spending, subscriptions, cards or goals.", toolsUsed: [...used], toolCalls, inputTokens, outputTokens, stop: "refused" };
    }
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (stop !== "tool_use" || toolUses.length === 0) {
      const answer = textOf(res.content) || "I couldn't find an answer to that in your data.";
      return { answer, toolsUsed: [...used], toolCalls, inputTokens, outputTokens, stop: stop === "max_tokens" ? "truncated" : "answered" };
    }
    if (round === MAX_TOOL_ROUNDS) break;
    // Keep the whole assistant turn (thinking blocks included) and answer every tool call in ONE user message.
    messages.push({ role: "assistant", content: res.content as unknown as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        toolCalls++;
        used.add(tu.name);
        try {
          const out = await runTool(tu.name, tu.input, data);
          return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(out) };
        } catch (err) {
          const msg = err instanceof ToolInputError ? err.message : "tool failed";
          return { type: "tool_result" as const, tool_use_id: tu.id, content: `Error: ${msg}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return {
    answer: "That question needed more steps than I can take. Try asking something narrower, like one month or one category.",
    toolsUsed: [...used],
    toolCalls,
    inputTokens,
    outputTokens,
    stop: "too_many_steps",
  };
}
