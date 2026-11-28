// Item-level categories → category breakdown. Pure module (no env/db).
//
// A matched receipt whose line items add up (itemsReconciled) splits its
// transaction's amount across the items' categories, so "₹4,200 at DMart"
// shows as groceries ₹2,900 + shopping ₹1,300 in the dashboard's
// byCategory. Tax, round-off and discounts are spread proportionally so the
// parts always sum to the transaction amount: spend totals never change.
import { CATEGORIES, NON_SPEND, isCategory } from "../categories.js";
import { round2 } from "../money.js";

export type SplitPart = { category: string; amount: number };
export type SplitItem = { category: string; lineTotal: number };

/**
 * Parts for one transaction, or null when splitting wouldn't change anything
 * (no usable items, or everything lands in the transaction's own category).
 * Item categories that aren't spend (income, transfers, ...) fold into the
 * transaction's category.
 */
export function allocateItems(txnAmount: number, txnCategory: string, items: readonly SplitItem[]): SplitPart[] | null {
  if (!(txnAmount > 0) || !items.length) return null;
  const byCat = new Map<string, number>();
  for (const it of items) {
    const cat = isCategory(it.category) && !NON_SPEND.has(it.category) ? it.category : txnCategory;
    byCat.set(cat, (byCat.get(cat) ?? 0) + it.lineTotal);
  }
  const groups = [...byCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const weight = groups.reduce((s, [, v]) => s + v, 0);
  if (weight <= 0) return null;
  if (groups.length === 1 && groups[0][0] === txnCategory) return null;
  const parts = groups.map(([category, v]) => ({ category, amount: round2((txnAmount * v) / weight) }));
  // Rounding remainder goes to the largest part.
  const diff = round2(txnAmount - parts.reduce((s, p) => s + p.amount, 0));
  if (diff !== 0) parts[0].amount = round2(parts[0].amount + diff);
  return parts.filter((p) => p.amount > 0);
}

/** One matched, reconciled receipt's transaction and its line items. */
export type ItemizedTxn = { amount: number; category: string; items: readonly SplitItem[] };

export type ItemizedSummary = {
  /** Transactions with a matched receipt whose items add up. */
  txnCount: number;
  /** Their total spend (the transaction amounts, not the receipt totals). */
  amount: number;
  /** That spend by item category, largest first; sums to `amount`. */
  byCategory: Array<{ category: string; label: string; amount: number }>;
};

/**
 * Item-level view of the receipt-backed part of a month: every matched
 * transaction counts, including ones whose items all share its category
 * (allocateItems returns null for those, so they land whole in that category).
 */
export function summarizeItemized(txns: readonly ItemizedTxn[]): ItemizedSummary {
  const byCat = new Map<string, number>();
  let amount = 0;
  let txnCount = 0;
  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    txnCount += 1;
    amount += t.amount;
    const parts = allocateItems(t.amount, t.category, t.items) ?? [{ category: t.category, amount: t.amount }];
    for (const p of parts) byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.amount);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, v]) => ({ category, label: isCategory(category) ? CATEGORIES[category].label : category, amount: round2(v) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return { txnCount, amount: round2(amount), byCategory };
}
