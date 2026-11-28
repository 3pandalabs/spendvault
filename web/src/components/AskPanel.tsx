"use client";

// Ask SpendVault: questions about your own data (POST /ask). The conversation
// lives in memory only; nothing is stored server-side except token counts.

import { MessageCircleQuestion, Send } from "lucide-react";
import { useState } from "react";
import { delay } from "@/components/app-ui";
import { ErrorText, Panel, PanelTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, ask, errorMessage, getAskUsage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { AskTurn } from "@/lib/types";
import { cn } from "@/lib/utils";

const EXAMPLES = ["How much did I spend on coffee in October?", "What are my biggest subscriptions?", "When is my next card payment due?"];

export function AskPanel() {
  const usage = useAsync(getAskUsage, "ask-usage");
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const limit = usage.data?.limit ?? 20;
  const usedNow = used ?? usage.data?.used ?? 0;
  const off = unavailable || usage.data?.available === false;

  async function submit(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", text }]);
    setQ("");
    try {
      const r = await ask(text, history);
      setTurns((t) => [...t, { role: "assistant", text: r.answer }]);
      setUsed(r.usage.used);
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setQ(text);
      if (e instanceof ApiError && e.status === 503) setUnavailable(true);
      else {
        if (e instanceof ApiError && e.code === "ask_limit_reached") setUsed(limit);
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="spa-in" style={delay(0.08)}>
      <PanelTitle aside={!off && usage.data ? <span className="text-xs text-fg-muted tabular">{usedNow} of {limit} questions today</span> : null}>
        <span className="inline-flex items-center gap-2">
          <MessageCircleQuestion className="size-4 text-emerald-300" aria-hidden /> Ask SpendVault
        </span>
      </PanelTitle>
      {off ? (
        <p className="text-sm text-fg-muted">AI answers aren&apos;t switched on yet. Your dashboard, alerts and insights work without it.</p>
      ) : (
        <>
          {turns.length ? (
            <ul className="mb-3 max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
              {turns.map((t, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                    t.role === "user" ? "ml-6 bg-amber-400/10 text-amber-50" : "mr-6 border border-white/10 bg-white/[0.03]",
                  )}
                >
                  {t.text}
                </li>
              ))}
              {busy ? (
                <li className="mr-6 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-fg-muted">
                  <Spinner /> Looking at your data…
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => submit(x)}
                  disabled={busy || usedNow >= limit}
                  className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-left text-xs text-zinc-300 hover:border-amber-300/40 hover:text-zinc-100 disabled:opacity-50"
                >
                  {x}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(q);
            }}
          >
            <Input
              aria-label="Ask a question about your spending"
              placeholder="Ask about your spending…"
              maxLength={500}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={busy || usedNow >= limit}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={busy || q.trim().length < 2 || usedNow >= limit} aria-label="Ask">
              {busy ? <Spinner /> : <Send />}
            </Button>
          </form>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
          {turns.length ? (
            <button type="button" className="mt-2 text-xs text-accent-strong hover:underline" onClick={() => setTurns([])} disabled={busy}>
              New conversation
            </button>
          ) : null}
        </>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        Answers use your own data only. Your question and the totals it needs are sent to Anthropic (Claude) to write the answer; we don&apos;t store questions or answers.
      </p>
    </Panel>
  );
}
