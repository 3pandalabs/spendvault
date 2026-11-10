// Shared shapes for the ingest pipeline. Pure module (no env/db).

export type Direction = "debit" | "credit";
export type AccountKind = "credit_card" | "bank" | "unknown";
export type SourceKind = "statement" | "alert" | "csv";
export type DateOrder = "DMY" | "MDY";

export type ParsedTxn = {
  postedOn: string; // YYYY-MM-DD
  description: string;
  amount: number; // > 0, major units
  direction: Direction;
};

export type ParseResult = {
  parser: string; // "rules:statement" | "rules:alert" | "csv" | "llm"
  sourceKind: SourceKind;
  institutionKey?: string | null;
  institutionName?: string | null; // free text from the LLM, mapped to a key later
  accountKind: AccountKind;
  last4?: string | null;
  currency?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  previousBalance?: number | null;
  totalDue?: number | null;
  closingBalance?: number | null;
  txns: ParsedTxn[];
};

export const emptyResult = (parser: string, sourceKind: SourceKind): ParseResult => ({
  parser,
  sourceKind,
  accountKind: "unknown",
  txns: [],
});
