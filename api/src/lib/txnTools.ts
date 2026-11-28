// Transaction tools: split validation, tags, notes, merchant rule keys. Pure module (no env/db).

import { isCategory, NON_SPEND } from "./categories.js";
import { round2 } from "./money.js";

export const MAX_SPLIT_PARTS = 10;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_NOTE_LENGTH = 500;

export type SplitPartInput = { category: string; amount: number };

export class SplitError extends Error {}

/**
 * A split must have 2–10 parts in known categories, every amount > 0, adding
 * up to the transaction amount within 1 cent. Parts in the same category are
 * merged. Returns the cleaned parts (2 dp).
 */
export function validateSplit(txnAmount: number, parts: readonly SplitPartInput[]): SplitPartInput[] {
  if (parts.length < 2 || parts.length > MAX_SPLIT_PARTS) throw new SplitError("split_needs_2_to_10_parts");
  const merged = new Map<string, number>();
  for (const p of parts) {
    if (!isCategory(p.category)) throw new SplitError("invalid_category");
    if (!(p.amount > 0) || !Number.isFinite(p.amount)) throw new SplitError("split_amount_must_be_positive");
    merged.set(p.category, round2((merged.get(p.category) ?? 0) + p.amount));
  }
  const sum = round2([...merged.values()].reduce((s, v) => s + v, 0));
  if (Math.abs(sum - round2(txnAmount)) > 0.01) throw new SplitError("split_must_add_up");
  if (merged.size < 2) throw new SplitError("split_needs_2_categories");
  return [...merged.entries()].map(([category, amount]) => ({ category, amount }));
}

/** Split parts that count as spend (NON_SPEND parts fold into the transaction's own category). */
export function spendSplitParts(txnCategory: string, parts: readonly SplitPartInput[]): SplitPartInput[] {
  const m = new Map<string, number>();
  for (const p of parts) {
    const c = NON_SPEND.has(p.category as never) ? txnCategory : p.category;
    m.set(c, round2((m.get(c) ?? 0) + p.amount));
  }
  return [...m.entries()].map(([category, amount]) => ({ category, amount }));
}

/** Lowercase, trimmed, spaces → "-", only [a-z0-9-_], ≤ 30 chars, deduped, ≤ 10. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw
      .toLowerCase()
      .trim()
      .replace(/^#/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, MAX_TAG_LENGTH);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export const normalizeNote = (n: string | null | undefined): string | null => {
  const t = (n ?? "").replace(/\s+$/g, "").trim().slice(0, MAX_NOTE_LENGTH);
  return t ? t : null;
};

/** The key a merchant → category rule is stored under (category_rules.merchant). */
export const ruleKey = (merchant: string) => merchant.trim().toLowerCase();
