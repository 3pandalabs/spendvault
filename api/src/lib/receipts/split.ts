// Item-level categories → category breakdown. Pure module (no env/db).
//
// A matched receipt whose line items add up (itemsReconciled) splits its
// transaction's amount across the items' categories, so "₹4,200 at DMart"
// shows as groceries ₹2,900 + shopping ₹1,300 in the dashboard's
// byCategory. Tax, round-off and discounts are spread proportionally so the
// parts always sum to the transaction amount: spend totals never change.
import { NON_SPEND, isCategory } from "../categories.js";
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
