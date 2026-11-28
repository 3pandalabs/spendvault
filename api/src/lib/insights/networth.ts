// Simple net worth (GET /net-worth, Overview card). Pure.
//
//   net worth = manual assets + bank balances − manual liabilities − card balances
//
// Account balances come from the latest parsed statement's closing balance
// (documents.closing_balance: card = new balance / total due, bank = closing
// balance). Only accounts in the user's base currency, with includeInNetWorth
// on, count. A bank overdraft (negative closing) reduces assets; a card in
// credit (negative balance) reduces liabilities.

import { round2 } from "./util.js";

export type NetWorthAccountInput = {
  accountId: string;
  label: string;
  kind: string; // credit_card | bank | unknown
  currency: string;
  includeInNetWorth: boolean;
  balance: number | null;
  asOf: string | null; // statement period end (or processed date)
};

export type NetWorthItemInput = { id: string; kind: "asset" | "liability"; type: string; name: string; amount: number; updatedAt: string };

export type NetWorthData = {
  currency: string;
  netWorth: number;
  assets: number;
  liabilities: number;
  hasData: boolean;
  asOf: string | null; // oldest balance date used (how stale the number can be)
  accounts: Array<NetWorthAccountInput & { side: "asset" | "liability" | null; counted: boolean }>;
  items: NetWorthItemInput[];
};

export function computeNetWorth(opts: { currency: string; accounts: readonly NetWorthAccountInput[]; items: readonly NetWorthItemInput[] }): NetWorthData {
  let assets = 0;
  let liabilities = 0;
  let asOf: string | null = null;
  const accounts = opts.accounts.map((a) => {
    const side = a.kind === "bank" ? ("asset" as const) : a.kind === "credit_card" ? ("liability" as const) : null;
    const counted = side !== null && a.includeInNetWorth && a.balance !== null && a.currency === opts.currency;
    if (counted) {
      if (side === "asset") assets += a.balance!;
      else liabilities += a.balance!;
      if (a.asOf && (asOf === null || a.asOf < asOf)) asOf = a.asOf;
    }
    return { ...a, side, counted };
  });
  for (const i of opts.items) {
    if (i.kind === "asset") assets += i.amount;
    else liabilities += i.amount;
  }
  return {
    currency: opts.currency,
    netWorth: round2(assets - liabilities),
    assets: round2(assets),
    liabilities: round2(liabilities),
    hasData: opts.items.length > 0 || accounts.some((a) => a.counted),
    asOf,
    accounts,
    items: [...opts.items],
  };
}
