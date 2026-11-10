// Rules parser for statement TEXT (PDF text reconstructed into lines, or a
// pasted .txt). Pure module. Used when no LLM key is set, and as the fallback
// when the LLM call fails. Handles:
//   - card statements: "<date> <description> <amount>[ Cr]" (HDFC/ICICI/SBI Card style)
//   - US card statements: "MM/DD <description> [-]<amount>" with the year from the period
//   - bank statements with Debit/Credit/Balance columns: the LAST number on a
//     line is the running balance; direction comes from the balance delta.
import { DATE_SRC, findAmounts, findDates, findLast4, inferDateOrder, parseDate, type AmountToken } from "./text.js";
import type { AccountKind, DateOrder, ParsedTxn, ParseResult } from "./types.js";

export type StatementOptions = {
  /** Institution country, if known: decides dd/mm vs mm/dd. */
  country?: "IN" | "US" | null;
  /** Institution kinds, if known (a bank-only institution → bank). */
  kinds?: Array<"credit_card" | "bank">;
};

const LINE_DATE = new RegExp(`^\\s*(${DATE_SRC}|\\d{1,2}/\\d{1,2}(?![/\\d]))`, "i");
const TIME = /^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?/i;

// Lines that carry a date and an amount but are not transactions.
const SUMMARY =
  /\b(total amount|total dues?|grand total|sub ?total|opening balance|closing balance|previous balance|minimum (amount )?due|min\.? amt|credit limit|available (credit )?limit|cash limit|payment due date|statement date|reward points?|points (earned|redeemed)|balance b\/?f|brought forward|carried forward|new balance|balance as on|statement summary)\b/i;

const CREDIT_HINT = /^(by|cr)\b|\/cr\/|\bcredit(ed)?\b|\bdeposit\b|\bsalary\b|\brefund\b|\breversal\b|\bcashback\b|\bint\.?\s*pd\b|\binterest credit\b|neft cr|imps cr/i;
const PAYMENT_HINT = /payment received|thank you|payment - thank|autopay payment|bbps payment/i;

// Tried in priority order (each pattern across all lines before the next).
const TOTAL_DUE = [/total amount due/i, /total dues?\b/i, /new balance/i, /total outstanding/i, /(?<!minimum |min\.? )amount due/i];
const PREVIOUS = [/previous (statement )?balance/i, /opening balance/i, /balance b\/?f/i, /brought forward/i, /last statement balance/i];
const CLOSING = [/closing balance/i, /balance c\/?f/i, /carried forward/i];

function signedValue(a: AmountToken): number {
  return a.negative || a.marker === "cr" ? -a.value : a.value;
}

/** The amount for `label` on its own line, or via a header row + value row. */
function labelValue(lines: string[], res: RegExp[]): number | null {
  for (const re of res) {
    const v = labelValueOne(lines, re);
    if (v !== null) return v;
  }
  return null;
}

function labelValueOne(lines: string[], re: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(re);
    if (!m || m.index === undefined) continue;
    const after = line.slice(m.index + m[0].length);
    // "Total Dues  Payment Due Date ..." → next label begins before an amount: header row.
    const own = findAmounts(after);
    if (own.length && !/[a-z]{3,}/i.test(after.slice(0, own[0].index).replace(/rs\.?|inr|usd|₹|\$|[:=(]|in\s/gi, ""))) {
      return signedValue(own[0]);
    }
    // Header row: columns split by 2+ spaces, values on the next line with amounts.
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const idx = cols.findIndex((c) => re.test(c));
    if (idx >= 0 && cols.length > 1) {
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        const vals = findAmounts(lines[j]);
        if (vals.length === cols.length) return signedValue(vals[idx]);
        if (vals.length) break;
      }
    }
  }
  return null;
}

function findPeriod(lines: string[], order: DateOrder): { start: string | null; end: string | null } {
  for (const line of lines.slice(0, 80)) {
    if (!/period|from|billing cycle|opening\s*\/\s*closing|statement of account|between/i.test(line)) continue;
    const ds = findDates(line, order);
    if (ds.length >= 2) {
      const [a, b] = ds[0] <= ds[1] ? [ds[0], ds[1]] : [ds[1], ds[0]];
      return { start: a, end: b };
    }
  }
  for (const line of lines.slice(0, 80)) {
    if (/statement date|as on/i.test(line)) {
      const ds = findDates(line, order);
      if (ds.length) return { start: null, end: ds[0] };
    }
  }
  return { start: null, end: null };
}

/** Header line of a bank statement table with a running balance column. */
function hasBalanceTable(lines: string[]): boolean {
  return lines.some((l) => /\bbalance\b/i.test(l) && /\b(debit|withdrawal|withdrawals|dr)\b/i.test(l) && /\b(credit|deposit|deposits|cr)\b/i.test(l) && /date/i.test(l));
}

function cleanDescription(s: string, order: DateOrder): string {
  let d = s.replace(new RegExp(DATE_SRC, "gi"), " ").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ");
  d = d.replace(/\s+/g, " ").trim();
  // Trailing small integers are reward points / serials; leading long numbers are ref ids.
  d = d.replace(/(\s+[+-]?\d{1,5})+$/, "").replace(/^(\d{6,}\s+)+/, "").replace(/^[-–|:.\s]+|[-–|:\s]+$/g, "");
  void order;
  return d.trim();
}

export function detectOrder(text: string, opts: StatementOptions): DateOrder {
  const fallback: DateOrder = opts.country === "US" ? "MDY" : "DMY";
  const samples: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(LINE_DATE);
    if (m) samples.push(m[1]);
  }
  // Institution country is authoritative when known; samples only break ties.
  if (opts.country) return fallback;
  return inferDateOrder(samples, fallback);
}

export function parseStatementText(text: string, opts: StatementOptions = {}): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ").trimEnd());
  const order = detectOrder(text, opts);
  const bankMode = hasBalanceTable(lines) || (opts.kinds?.length === 1 && opts.kinds[0] === "bank");
  const period = findPeriod(lines, order);
  const refYear = Number((period.end ?? period.start ?? "").slice(0, 4)) || undefined;
  const refMonth = Number((period.end ?? "").slice(5, 7)) || undefined;

  const totalDue = labelValue(lines, TOTAL_DUE);
  const previousBalance = labelValue(lines, PREVIOUS);
  const closingBalance = labelValue(lines, CLOSING);

  const txns: ParsedTxn[] = [];
  let prevBalance: number | null = bankMode ? previousBalance : null;
  let lastWasTxn = false;
  let continuations = 0;

  for (const line of lines) {
    const dm = line.match(LINE_DATE);
    if (!dm) {
      // Wrapped description (bank statements): a short wordy line right after a txn.
      if (bankMode && lastWasTxn && continuations < 2 && txns.length) {
        const t = line.trim();
        if (t && t.length <= 60 && /[a-z]{2,}/i.test(t) && !findAmounts(t).length && !SUMMARY.test(t) && !/page \d+|^date\b/i.test(t)) {
          txns[txns.length - 1].description = `${txns[txns.length - 1].description} ${t}`.slice(0, 300);
          continuations++;
          continue;
        }
      }
      lastWasTxn = false;
      continue;
    }
    let postedOn = parseDate(dm[1], order, refYear);
    if (!postedOn) {
      lastWasTxn = false;
      continue;
    }
    // Year-less US dates in a Dec→Jan statement belong to the previous year.
    if (/^\d{1,2}\/\d{1,2}$/.test(dm[1].trim()) && refYear && refMonth && Number(postedOn.slice(5, 7)) > refMonth) {
      postedOn = `${refYear - 1}${postedOn.slice(4)}`;
    }
    let rest = line.slice(dm[0].length);
    // Optional second date (value date) and time.
    const second = rest.match(new RegExp(`^\\s*(${DATE_SRC})`, "i"));
    if (second) rest = rest.slice(second[0].length);
    const time = rest.match(TIME);
    if (time) rest = rest.slice(time[0].length);

    if (SUMMARY.test(rest)) {
      lastWasTxn = false;
      continue;
    }
    const amounts = findAmounts(rest);
    if (!amounts.length) {
      lastWasTxn = false;
      continue;
    }
    const description = cleanDescription(rest.slice(0, amounts[0].index), order);
    if (!/[a-z]{2,}/i.test(description)) {
      lastWasTxn = false;
      continue;
    }

    let amount: number;
    let direction: "debit" | "credit";
    if (bankMode && amounts.length >= 2) {
      const balTok = amounts[amounts.length - 1];
      const balance = balTok.marker === "dr" || balTok.negative ? -balTok.value : balTok.value;
      const candidates = amounts.slice(0, -1).filter((a) => a.value > 0);
      if (!candidates.length) {
        prevBalance = balance;
        lastWasTxn = false;
        continue;
      }
      const tok = candidates[candidates.length - 1];
      amount = tok.value;
      if (prevBalance !== null && Math.abs(prevBalance - amount - balance) < 0.011) direction = "debit";
      else if (prevBalance !== null && Math.abs(prevBalance + amount - balance) < 0.011) direction = "credit";
      else if (amounts.length >= 3 && candidates.length === 1) {
        // Debit | Credit | Balance with one empty-as-0.00 column: position decides.
        direction = amounts.indexOf(tok) === amounts.length - 2 ? "credit" : "debit";
      } else direction = tok.marker === "cr" || CREDIT_HINT.test(description) ? "credit" : "debit";
      prevBalance = balance;
    } else {
      const tok = amounts[amounts.length - 1];
      amount = tok.value;
      direction = tok.marker === "cr" || tok.negative || (tok.marker !== "dr" && PAYMENT_HINT.test(description)) ? "credit" : "debit";
    }
    if (!(amount > 0)) {
      lastWasTxn = false;
      continue;
    }
    txns.push({ postedOn, description, amount, direction });
    lastWasTxn = true;
    continuations = 0;
  }

  let accountKind: AccountKind = "unknown";
  if (bankMode) accountKind = "bank";
  else if (/credit card|card (no|number)|total amount due|minimum amount due|total dues|new balance|card ending/i.test(text)) accountKind = "credit_card";
  else if (opts.kinds?.length === 1) accountKind = opts.kinds[0];

  const dates = txns.map((t) => t.postedOn).sort();
  return {
    parser: "rules:statement",
    sourceKind: "statement",
    accountKind,
    last4: findLast4(text.slice(0, 4000)),
    currency: opts.country === "US" || (/\$\s?\d/.test(text) && !/₹|rs\.|inr/i.test(text)) ? "USD" : "INR",
    periodStart: period.start ?? dates[0] ?? null,
    periodEnd: period.end ?? dates[dates.length - 1] ?? null,
    previousBalance: previousBalance === null ? null : Math.abs(previousBalance),
    totalDue: totalDue === null ? null : Math.abs(totalDue),
    closingBalance: closingBalance ?? (bankMode ? prevBalance : null),
    txns,
  };
}
