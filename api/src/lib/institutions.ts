// Banks and card issuers we recognize. Pure module (no env).
// `senders` match the email From domain; `names` match subject/filename/PDF text.
// `passwordHint` is shown in the password vault UI. These are the commonly
// published patterns; banks change them, so the UI words them as "usually".

export type Institution = {
  key: string;
  name: string;
  country: "IN" | "US";
  kinds: Array<"credit_card" | "bank">;
  senders: string[];
  names: RegExp;
  passwordHint: string | null;
};

export const INSTITUTIONS: Institution[] = [
  { key: "hdfc", name: "HDFC Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["hdfcbank.net", "hdfcbank.com", "hdfcbank.bank.in"], names: /hdfc/i, passwordHint: "Usually the first 4 letters of your name (caps) + last 4 digits of the card, or your customer ID" },
  { key: "icici", name: "ICICI Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["icicibank.com", "icicibank.bank.in"], names: /icici/i, passwordHint: "Usually the first 4 letters of your name (lowercase) + date of birth as DDMM" },
  { key: "sbicard", name: "SBI Card", country: "IN", kinds: ["credit_card"], senders: ["sbicard.com"], names: /sbi\s*card/i, passwordHint: "Usually date of birth as DDMMYYYY + last 4 digits of the card" },
  { key: "sbi", name: "State Bank of India", country: "IN", kinds: ["bank"], senders: ["sbi.co.in", "onlinesbi.com", "sbi.bank.in"], names: /state bank of india|\bsbi\b/i, passwordHint: "Usually the last 5 digits of your registered mobile + date of birth as DDMMYY" },
  { key: "axis", name: "Axis Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["axisbank.com", "axisbank.bank.in"], names: /axis\s*bank/i, passwordHint: "Usually the first 4 letters of your name (caps) + date of birth as DDMM" },
  { key: "kotak", name: "Kotak Mahindra Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["kotak.com", "kotak.bank.in"], names: /kotak/i, passwordHint: "Usually your CRN (customer relationship number) or date of birth" },
  { key: "amex_in", name: "American Express (India)", country: "IN", kinds: ["credit_card"], senders: ["americanexpress.co.in", "aexp.com"], names: /american\s*express|amex/i, passwordHint: null },
  { key: "idfc", name: "IDFC FIRST Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["idfcfirstbank.com"], names: /idfc/i, passwordHint: "Usually the first 4 letters of your name + date of birth as DDMM" },
  { key: "indusind", name: "IndusInd Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["indusind.com"], names: /indusind/i, passwordHint: "Usually the first 4 letters of your name + date of birth as DDMM" },
  { key: "yes", name: "YES Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["yesbank.in"], names: /yes\s*bank/i, passwordHint: "Usually the first 4 letters of your name + date of birth as DDMM" },
  { key: "au", name: "AU Small Finance Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["aubank.in"], names: /au\s*(small\s*finance)?\s*bank/i, passwordHint: null },
  { key: "rbl", name: "RBL Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["rblbank.com"], names: /rbl\s*bank/i, passwordHint: null },
  { key: "onecard", name: "OneCard", country: "IN", kinds: ["credit_card"], senders: ["getonecard.app"], names: /onecard/i, passwordHint: null },
  { key: "hsbc_in", name: "HSBC India", country: "IN", kinds: ["credit_card", "bank"], senders: ["hsbc.co.in"], names: /hsbc/i, passwordHint: null },
  { key: "sc", name: "Standard Chartered", country: "IN", kinds: ["credit_card", "bank"], senders: ["sc.com"], names: /standard\s*chartered/i, passwordHint: null },
  { key: "federal", name: "Federal Bank", country: "IN", kinds: ["credit_card", "bank"], senders: ["federalbank.co.in"], names: /federal\s*bank/i, passwordHint: null },
  { key: "bob", name: "Bank of Baroda", country: "IN", kinds: ["credit_card", "bank"], senders: ["bankofbaroda.com", "bobfinancial.com", "bobcard.co.in"], names: /bank of baroda|bobcard/i, passwordHint: null },
  { key: "pnb", name: "Punjab National Bank", country: "IN", kinds: ["bank"], senders: ["pnb.co.in"], names: /punjab national/i, passwordHint: null },
  { key: "canara", name: "Canara Bank", country: "IN", kinds: ["bank"], senders: ["canarabank.com"], names: /canara/i, passwordHint: null },
  { key: "chase", name: "Chase", country: "US", kinds: ["credit_card", "bank"], senders: ["chase.com"], names: /\bchase\b/i, passwordHint: null },
  { key: "amex_us", name: "American Express (US)", country: "US", kinds: ["credit_card"], senders: ["americanexpress.com", "welcome.americanexpress.com"], names: /american\s*express/i, passwordHint: null },
  { key: "citi", name: "Citi", country: "US", kinds: ["credit_card", "bank"], senders: ["citi.com", "info.citi.com"], names: /\bciti(bank)?\b/i, passwordHint: null },
  { key: "capitalone", name: "Capital One", country: "US", kinds: ["credit_card", "bank"], senders: ["capitalone.com"], names: /capital\s*one/i, passwordHint: null },
  { key: "bofa", name: "Bank of America", country: "US", kinds: ["credit_card", "bank"], senders: ["bankofamerica.com", "ealerts.bankofamerica.com"], names: /bank of america/i, passwordHint: null },
  { key: "discover", name: "Discover", country: "US", kinds: ["credit_card"], senders: ["discover.com"], names: /\bdiscover\b/i, passwordHint: null },
  { key: "wellsfargo", name: "Wells Fargo", country: "US", kinds: ["credit_card", "bank"], senders: ["wellsfargo.com"], names: /wells\s*fargo/i, passwordHint: null },
  { key: "usbank", name: "U.S. Bank", country: "US", kinds: ["credit_card", "bank"], senders: ["usbank.com"], names: /\bu\.?\s?s\.? bank\b/i, passwordHint: null },
  { key: "pnc", name: "PNC Bank", country: "US", kinds: ["credit_card", "bank"], senders: ["pnc.com"], names: /\bpnc\b/i, passwordHint: null },
  { key: "truist", name: "Truist", country: "US", kinds: ["credit_card", "bank"], senders: ["truist.com"], names: /\btruist\b/i, passwordHint: null },
  { key: "usaa", name: "USAA", country: "US", kinds: ["credit_card", "bank"], senders: ["usaa.com"], names: /\busaa\b/i, passwordHint: null },
  { key: "navyfederal", name: "Navy Federal Credit Union", country: "US", kinds: ["credit_card", "bank"], senders: ["navyfederal.org"], names: /navy\s*federal/i, passwordHint: null },
  { key: "ally", name: "Ally Bank", country: "US", kinds: ["bank"], senders: ["ally.com"], names: /\bally\s*(bank|financial)\b/i, passwordHint: null },
  { key: "synchrony", name: "Synchrony", country: "US", kinds: ["credit_card"], senders: ["synchrony.com", "synchronybank.com"], names: /\bsynchrony\b/i, passwordHint: null },
];

const BY_KEY = new Map(INSTITUTIONS.map((i) => [i.key, i]));

export const institutionByKey = (key: string | null | undefined) => (key ? BY_KEY.get(key) : undefined);
export const institutionName = (key: string | null | undefined) => institutionByKey(key)?.name ?? null;

/** Match the From address domain (or any parent domain) against `senders`. */
export function institutionFromSender(from: string | null | undefined): Institution | undefined {
  const domain = from?.toLowerCase().match(/@([a-z0-9.-]+)/)?.[1];
  if (!domain) return undefined;
  return INSTITUTIONS.find((i) => i.senders.some((s) => domain === s || domain.endsWith(`.${s}`)));
}

/**
 * Match free text (subject, filename, first page of the PDF). The EARLIEST
 * mention wins: the issuer's name heads its own statement, while other banks
 * show up later in transaction lines ("NEFT from HDFC"). Ties go to list
 * order, which puts "SBI Card" before "SBI".
 */
export function institutionFromText(text: string | null | undefined): Institution | undefined {
  if (!text) return undefined;
  let best: { inst: Institution; at: number } | undefined;
  for (const inst of INSTITUTIONS) {
    const m = inst.names.exec(text);
    if (m && (!best || m.index < best.at)) best = { inst, at: m.index };
  }
  return best?.inst;
}

/** Gmail rejects filters whose criteria run past ~1,500 characters; stay well under. */
export const GMAIL_FILTER_MAX = 1500;

/**
 * Gmail search that catches statements and alert mails from every known
 * sender, US and India alike (people often hold cards in both countries).
 * US senders come first only for readability; Gmail ignores the order.
 */
export function gmailFilterQuery(): string {
  const ordered = [...INSTITUTIONS.filter((i) => i.country === "US"), ...INSTITUTIONS.filter((i) => i.country !== "US")];
  const all = [...new Set(ordered.flatMap((i) => i.senders))];
  // Gmail's from:chase.com already matches mail from any subdomain, so drop
  // subdomains whose parent is listed (keeps the query short).
  const domains = all.filter((d) => !all.some((p) => p !== d && d.endsWith(`.${p}`)));
  // US banks word alerts as "transaction" / "purchase" / "charged"; Indian ones
  // as "debited" / "spent" / "txn".
  return `from:(${domains.join(" OR ")}) (statement OR "e-statement" OR debited OR spent OR transaction OR purchase OR charged OR "txn")`;
}
