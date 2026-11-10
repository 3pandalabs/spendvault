import type { Txn } from "../../src/lib/insights/util.js";

let n = 0;
export function txn(p: Partial<Txn> & { postedOn: string; amount: number }): Txn {
  n += 1;
  return {
    id: p.id ?? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    accountId: "acct-1",
    merchant: "Some Shop",
    category: "shopping",
    direction: "debit",
    currency: "INR",
    descriptionRaw: p.merchant ?? "SOME SHOP",
    sourceKind: "statement",
    ...p,
  };
}

/** Monthly charges on the given day for consecutive months starting at `start` (YYYY-MM). */
export function monthly(merchant: string, category: string, start: string, amounts: number[], day = 5): Txn[] {
  return amounts.map((amount, i) => {
    const idx = +start.slice(0, 4) * 12 + (+start.slice(5, 7) - 1) + i;
    const m = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    return txn({ postedOn: `${m}-${String(day).padStart(2, "0")}`, amount, merchant, category, descriptionRaw: merchant.toUpperCase() });
  });
}
