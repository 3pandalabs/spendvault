// Rules parser for per-transaction alert emails (and SMS-like text). Pure module.
// One alert = one transaction. Built as a set of independent extractors
// (amount, direction, last4, merchant, date) rather than one regex per bank,
// because banks reword these mails constantly.
import { dateFinder, parseDate } from "./text.js";
import type { AccountKind, DateOrder, ParsedTxn, ParseResult } from "./types.js";

const CURRENCY_AMOUNT = /(?:(?:Rs|INR|USD)\.?\s?|₹\s?|\$\s?)(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
// Spend verbs, then credit verbs. The FIRST one in the text decides direction:
// "debited from A/c XX12 and credited to VPA x@y" is a debit.
const DEBIT_WORDS = /\b(debited|spent|charged|charge of|used (?:for|at)|withdrawn|withdrawal|purchase|paid|payment of|transaction of|made a|sent|deducted|txn of)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|reversed|reversal|cashback)\b/i;
const NOT_A_TXN = /\b(otp|one[- ]time password|verification code)\b/i;

/** Is this email body a transaction alert (vs a promo / newsletter / reminder)? */
export function looksLikeAlert(text: string): boolean {
  const t = text.replace(/\s+/g, " ").slice(0, 4000);
  if (NOT_A_TXN.test(t) || PROMO.test(t)) return false;
  return CURRENCY_AMOUNT.test(t) && STRONG_WORDS.test(t);
}

// Promos say "cashback" and "purchase" too; an alert needs a past-tense money verb.
const STRONG_WORDS = /\b(debited|spent|charged|charge of|used for|withdrawn|credited|deposited|transaction of|transaction with|txn of|refund(?:ed)? of)\b/i;
const PROMO = /(\d+\s?% off|order now|shop now|use code|limited[- ]period|apply now|pre-approved|win up to)/i;

const STOP = String.raw`(?=\s+(?:on|via|using|with|from|ref|avl|available|info|at|has|have|was|is|for)\b|[.,;:\n]|\s+\d{1,2}[-/]|\s*$)`;
const MERCHANT_PATTERNS: RegExp[] = [
  /\bInfo:?\s*([^.\n]{3,80}?)(?=\.\s|\.$|\n|\s+Avl|\s+Available|$)/i,
  new RegExp(String.raw`\b(?:at|@)\s+([A-Za-z0-9][\w&'.*#\- /]{1,60}?)${STOP}`, "i"),
  new RegExp(String.raw`\btransaction with\s+([A-Za-z0-9][\w&'.*#\- /]{1,60}?)${STOP}`, "i"),
  /\bto\s+VPA\s+([\w.\-]+@[\w.\-]+)/i,
  /\bVPA\s+([\w.\-]+@[\w.\-]+)/i,
  new RegExp(String.raw`\btowards\s+([A-Za-z0-9][\w&'.*#\- /]{1,60}?)${STOP}`, "i"),
  /;\s*([A-Za-z0-9][\w&'.\- ]{1,40}?)\s+credited/i,
  new RegExp(String.raw`\b(?:transferred to|paid to|sent to|to)\s+([A-Za-z][\w&'.\- ]{1,50}?)${STOP}`, "i"),
  new RegExp(String.raw`\bfrom\s+([A-Za-z][\w&'.@\- ]{1,50}?)${STOP}`, "i"),
];

const LAST4_PATTERNS: RegExp[] = [
  /(?:card|a\/c|acct|account|ac)\b[^.\d]{0,40}?(?:[xX*•]+|ending(?:\s+(?:in|with))?|no\.?)\s*:?\s*(\d{3,6})(?!\d)/i,
  /(?:[xX*•]{2,})(\d{4})(?!\d)/,
  /ending(?:\s+(?:in|with))?\s*(\d{4})(?!\d)/i,
];

function first<T>(text: string, patterns: RegExp[], pick: (m: RegExpMatchArray) => T | null): T | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = pick(m);
      if (v) return v;
    }
  }
  return null;
}

function directionOf(t: string): "debit" | "credit" | null {
  const d = t.search(DEBIT_WORDS);
  const c = t.search(CREDIT_WORDS);
  if (d < 0 && c < 0) return null;
  if (d < 0) return "credit";
  if (c < 0) return "debit";
  return d <= c ? "debit" : "credit";
}

function kindOf(t: string): AccountKind {
  if (/credit\s*card/i.test(t)) return "credit_card";
  if (/\b(a\/c|acct|account|debit card|upi|vpa|neft|imps|atm)\b/i.test(t)) return "bank";
  if (/\bcard\b/i.test(t)) return "credit_card";
  return "unknown";
}

export type AlertOptions = { order?: DateOrder; fallbackDate?: string };

export function parseAlertText(text: string, opts: AlertOptions = {}): ParseResult {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 4000);
  const base: ParseResult = { parser: "rules:alert", sourceKind: "alert", accountKind: kindOf(t), txns: [] };
  if (NOT_A_TXN.test(t)) return base;
  const am = t.match(CURRENCY_AMOUNT);
  const direction = directionOf(t);
  if (!am || !direction) return base;
  const amount = Number(am[1].replace(/,/g, ""));
  if (!(amount > 0)) return base;

  let postedOn: string | null = null;
  for (const m of t.matchAll(dateFinder())) {
    postedOn = parseDate(m[0], opts.order ?? (am[0].includes("$") ? "MDY" : "DMY"));
    if (postedOn) break;
  }
  postedOn ??= opts.fallbackDate ?? null;
  if (!postedOn) return base;

  const last4 = first(t, LAST4_PATTERNS, (m) => m[1].slice(-4));
  const merchant =
    first(t, MERCHANT_PATTERNS, (m) => {
      const v = m[1].trim().replace(/\s+/g, " ");
      // Reject captures that are really account phrases ("your A/c", "Card XX1234").
      if (!v || /^(your|the|a\/c|acct|account|card|ac)\b/i.test(v) || /[xX*]{2,}\d/.test(v)) return null;
      return v;
    }) ?? (direction === "credit" ? "Credit" : "Card/account transaction");

  const txn: ParsedTxn = { postedOn, description: merchant.slice(0, 200), amount, direction };
  return {
    ...base,
    last4,
    currency: am[0].includes("$") || /^usd/i.test(am[0]) ? "USD" : "INR",
    periodStart: postedOn,
    periodEnd: postedOn,
    txns: [txn],
  };
}
