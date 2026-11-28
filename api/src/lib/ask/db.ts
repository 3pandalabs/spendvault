// AskData for ONE user: every read is bound to `userId` here, never taken
// from the model. DB-bound. Household data is NOT included (Ask is personal).
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { receiptItems, receipts } from "../../db/schema.js";
import { num, toNum } from "../money.js";
import { budgetLines } from "../insights/budgets.js";
import { loadBudgets, loadTxns } from "../insights/load.js";
import { computeSubscriptions } from "../insights/subscriptions.js";
import { addDays, addMonths, monthEnd, monthStart } from "../insights/util.js";
import type { AskData } from "./tools.js";
import { loadCardDues, loadGoals } from "../toolsDb.js";

export function askDataFor(userId: string, currency: string, today: string, monthlyBudget: number | null): AskData {
  return {
    currency,
    today,
    txns: (from, to) => loadTxns(userId, currency, from, to),
    async receiptItems(from, to) {
      const rows = await db
        .select({ i: receiptItems, merchant: receipts.merchant, purchasedOn: receipts.purchasedOn })
        .from(receiptItems)
        .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
        .where(
          and(
            eq(receiptItems.userId, userId),
            eq(receipts.userId, userId),
            eq(receipts.currency, currency),
            or(isNull(receipts.purchasedOn), and(gte(receipts.purchasedOn, from), lte(receipts.purchasedOn, to))),
          ),
        )
        .limit(2000);
      return rows.map((r) => ({
        name: r.i.name,
        merchant: r.merchant,
        purchasedOn: r.purchasedOn,
        lineTotal: num(r.i.lineTotal),
        quantity: r.i.quantity === null ? null : Number(r.i.quantity),
        unitPrice: toNum(r.i.unitPrice),
        category: r.i.category,
      }));
    },
    async subscriptions() {
      return computeSubscriptions({ txns: await loadTxns(userId, currency, addDays(today, -400)), currency, today });
    },
    cardDues: () => loadCardDues(userId, today),
    async budgets(month) {
      const [rows, txns] = await Promise.all([loadBudgets(userId), loadTxns(userId, currency, monthStart(addMonths(month, 0)), monthEnd(month))]);
      return { month, monthlyBudget, items: budgetLines(txns, currency, month, rows) };
    },
    async goals() {
      return (await loadGoals(userId, today)).map((g) => ({
        name: g.name,
        targetAmount: g.targetAmount,
        targetDate: g.targetDate,
        saved: g.progress.saved,
        remaining: g.progress.remaining,
        monthlyNeeded: g.progress.monthlyNeeded,
        status: g.progress.status,
      }));
    },
  };
}
