// Spending categories + the built-in merchant keyword map. Pure module (no env).
// Keys are stable identifiers stored in transactions.category; labels are UI copy.

export const CATEGORIES = {
  food_delivery: { label: "Food delivery", essential: false },
  dining: { label: "Restaurants & cafes", essential: false },
  groceries: { label: "Groceries", essential: true },
  shopping: { label: "Shopping", essential: false },
  fuel: { label: "Fuel", essential: true },
  transport: { label: "Cabs & transport", essential: true },
  travel: { label: "Travel & hotels", essential: false },
  utilities: { label: "Bills & utilities", essential: true },
  telecom: { label: "Mobile & internet", essential: true },
  subscriptions: { label: "Subscriptions", essential: false },
  entertainment: { label: "Entertainment", essential: false },
  health: { label: "Health & pharmacy", essential: true },
  education: { label: "Education", essential: true },
  rent: { label: "Rent & housing", essential: true },
  insurance: { label: "Insurance", essential: true },
  investments: { label: "Investments", essential: false },
  emi_loans: { label: "EMI & loans", essential: true },
  fees_charges: { label: "Fees, interest & charges", essential: false },
  cash: { label: "Cash withdrawal", essential: false },
  transfers: { label: "Transfers (UPI/NEFT)", essential: false },
  card_payment: { label: "Card bill payment", essential: false },
  income: { label: "Income & refunds", essential: false },
  other: { label: "Other", essential: false },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
export const isCategory = (x: unknown): x is Category => typeof x === "string" && x in CATEGORIES;

/**
 * Categories that are not "spend": moving money between your own accounts
 * (paying the card bill from the bank account) or money coming in. Excluded
 * from spend totals and spike detection so the card bill isn't counted twice.
 */
export const NON_SPEND: ReadonlySet<Category> = new Set(["card_payment", "income", "transfers", "investments"]);

// Ordered: first match wins. Patterns run against the lowercased raw
// description. Keep entries specific enough not to swallow unrelated text.
export const MERCHANT_RULES: Array<{ match: RegExp; merchant: string; category: Category }> = [
  { match: /swiggy\s*instamart|instamart/, merchant: "Swiggy Instamart", category: "groceries" },
  { match: /swiggy/, merchant: "Swiggy", category: "food_delivery" },
  { match: /zomato|blinkit|grofers/, merchant: "Zomato/Blinkit", category: "food_delivery" },
  { match: /zepto/, merchant: "Zepto", category: "groceries" },
  { match: /bigbasket|bbnow|bb\s*daily/, merchant: "BigBasket", category: "groceries" },
  { match: /dmart|avenue\s*supermart/, merchant: "DMart", category: "groceries" },
  { match: /jiomart|reliance\s*(fresh|smart|retail)/, merchant: "Reliance Retail", category: "groceries" },
  { match: /more\s*retail|spencer|nature'?s\s*basket/, merchant: "Supermarket", category: "groceries" },
  { match: /amazon\s*prime|primevideo|prime\s*video/, merchant: "Amazon Prime", category: "subscriptions" },
  { match: /amazon|amzn/, merchant: "Amazon", category: "shopping" },
  { match: /flipkart|fkrt/, merchant: "Flipkart", category: "shopping" },
  { match: /myntra/, merchant: "Myntra", category: "shopping" },
  { match: /ajio/, merchant: "Ajio", category: "shopping" },
  { match: /nykaa/, merchant: "Nykaa", category: "shopping" },
  { match: /meesho/, merchant: "Meesho", category: "shopping" },
  { match: /decathlon|ikea|croma|reliance\s*digital|vijay\s*sales/, merchant: "Retail store", category: "shopping" },
  { match: /netflix/, merchant: "Netflix", category: "subscriptions" },
  { match: /spotify/, merchant: "Spotify", category: "subscriptions" },
  { match: /youtube\s*premium|google\s*\*?youtube/, merchant: "YouTube Premium", category: "subscriptions" },
  { match: /hotstar|jiocinema|jiohotstar/, merchant: "JioHotstar", category: "subscriptions" },
  { match: /sonyliv|zee5|apple\.com\/bill|itunes|apple\s*services/, merchant: "Streaming/App store", category: "subscriptions" },
  { match: /google\s*(play|storage|one)|google\s*\*/, merchant: "Google", category: "subscriptions" },
  { match: /microsoft|msft|office\s*365|adobe|canva|notion|openai|chatgpt|anthropic|claude\.ai/, merchant: "Software subscription", category: "subscriptions" },
  { match: /bookmyshow|pvr|inox|cinepolis|district/, merchant: "Movies & events", category: "entertainment" },
  { match: /uber\s*eats/, merchant: "Uber Eats", category: "food_delivery" },
  { match: /doordash|grubhub|instacart/, merchant: "Food delivery (US)", category: "food_delivery" },
  { match: /uber|ola\s*cabs|olacabs|\bola\b|rapido|blusmart|lyft/, merchant: "Cab ride", category: "transport" },
  { match: /irctc|indian\s*railway/, merchant: "IRCTC", category: "travel" },
  { match: /makemytrip|goibibo|cleartrip|yatra|ixigo|easemytrip|booking\.com|agoda|airbnb|oyo|expedia|marriott|hilton|taj\s*hotels/, merchant: "Travel booking", category: "travel" },
  { match: /indigo|air\s*india|vistara|akasa|spicejet|interglobe|united\s*airlines|delta\s*air|american\s*airlines|emirates/, merchant: "Airline", category: "travel" },
  { match: /fastag|nhai|metro\s*rail|dmrc|bmrcl|namma\s*metro/, merchant: "Tolls & metro", category: "transport" },
  { match: /indian\s*oil|iocl|bharat\s*petroleum|bpcl|hpcl|hindustan\s*petroleum|shell|nayara|petrol|fuel|\bhp\s*pay|chevron|exxon|costco\s*gas/, merchant: "Fuel station", category: "fuel" },
  { match: /airtel|jio\b|reliance\s*jio|vodafone|\bvi\b|bsnl|act\s*fibernet|hathway|tata\s*play|dish\s*tv|comcast|xfinity|verizon|t-mobile|at&t/, merchant: "Telecom/internet", category: "telecom" },
  { match: /electricity|bescom|tata\s*power|adani\s*(electricity|energy)|msedcl|bses|tneb|cesc|torrent\s*power|water\s*bill|gas\s*bill|indane|bharat\s*gas|hp\s*gas|mahanagar\s*gas|igl|pg&e|con\s*edison/, merchant: "Utility bill", category: "utilities" },
  { match: /bbps|billdesk|bill\s*pay/, merchant: "Bill payment", category: "utilities" },
  { match: /apollo|pharmeasy|netmeds|1mg|medplus|practo|hospital|clinic|diagnostic|pharmacy|cvs|walgreens/, merchant: "Health", category: "health" },
  { match: /lic\b|life\s*insurance|policybazaar|hdfc\s*ergo|icici\s*lombard|star\s*health|acko|digit\s*insurance|niva\s*bupa|geico|state\s*farm/, merchant: "Insurance", category: "insurance" },
  { match: /zerodha|groww|upstox|kuvera|coin\s*by|mutual\s*fund|\bsip\b|nps|ppf|indmoney|smallcase|vanguard|fidelity|robinhood|schwab/, merchant: "Investment", category: "investments" },
  { match: /school|college|university|byju|unacademy|udemy|coursera|vedantu|fees?\s*payment/, merchant: "Education", category: "education" },
  { match: /\brent\b|nobroker|housing\.com|cred\s*rent|maintenance|society/, merchant: "Rent/housing", category: "rent" },
  { match: /\bemi\b|loan|bajaj\s*fin|home\s*credit/, merchant: "EMI/loan", category: "emi_loans" },
  {
    match: /late\s*(payment)?\s*fee|finance\s*charge|interest\s*(charged|debit)?|overlimit|over\s*limit|annual\s*fee|joining\s*fee|membership\s*fee|cash\s*advance\s*fee|forex|cross\s*currency|markup|foreign\s*currency\s*transaction|surcharge|gst\s*on|igst|cgst|sgst|penal|bounce\s*charge|service\s*charge|sms\s*charge|amc\b/,
    merchant: "Bank fee/charge",
    category: "fees_charges",
  },
  { match: /\batm\b|cash\s*withdrawal|nwd|cash\s*wdl/, merchant: "ATM withdrawal", category: "cash" },
  { match: /payment\s*received|thank\s*you\s*for\s*(your\s*)?payment|bbps\s*payment\s*received|autopay|auto\s*debit\s*payment|card\s*payment|cc\s*payment|payment\s*-\s*thank/, merchant: "Card bill payment", category: "card_payment" },
  { match: /salary|sal\s*cr|refund|reversal|cashback|interest\s*credit|int\.?\s*pd|dividend/, merchant: "Income/refund", category: "income" },
  { match: /starbucks|cafe|coffee|chaayos|third\s*wave|blue\s*tokai|restaurant|dhaba|bar\s*&|pub\b|dominos|domino'?s|pizza|mcdonald|kfc|burger\s*king|subway|haldiram|barbeque|chipotle/, merchant: "Restaurant/cafe", category: "dining" },
  { match: /upi|imps|neft|rtgs|transfer|paytm|phonepe|gpay|google\s*pay|bhim|zelle|venmo/, merchant: "Transfer", category: "transfers" },
];

/** Turn a raw statement description into a short display merchant name. */
export function cleanMerchantName(raw: string): string {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/\b(pos|ecom|e-com|vps|ref(\s*no)?|txn|upi|imps|neft|rtgs|ach|nach|purchase|debit|credit|card)\b[:\s-]*/gi, " ")
    .replace(/\b\d{6,}\b/g, " ") // reference numbers
    .replace(/[*#/_]+/g, " ")
    .replace(/\b(in|ind|india|mumbai|bangalore|bengaluru|delhi|new delhi|gurgaon|gurugram|noida|pune|chennai|hyderabad|kolkata|blr|mum|del)\b\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = raw.trim();
  s = s.slice(0, 40);
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export type CategoryMatch = { merchant: string; category: Category; matched: boolean };

/**
 * Built-in categorization. `userRules` (merchant lowercase → category) win over
 * the built-in map. `matched` is false when we fell back to "other", which is
 * the signal to try the LLM categorizer.
 */
export function categorize(description: string, direction: "debit" | "credit", userRules?: Map<string, Category>): CategoryMatch {
  const lower = description.toLowerCase();
  const rule = MERCHANT_RULES.find((r) => r.match.test(lower));
  const merchant = rule?.merchant && !["Transfer", "Bank fee/charge", "Restaurant/cafe", "Retail store"].includes(rule.merchant)
    ? rule.merchant
    : cleanMerchantName(description);
  const userCat = userRules?.get(merchant.toLowerCase());
  if (userCat) return { merchant, category: userCat, matched: true };
  if (rule) {
    // A credit that looks like a merchant purchase is a refund.
    if (direction === "credit" && rule.category !== "card_payment" && rule.category !== "transfers") {
      return { merchant, category: "income", matched: true };
    }
    return { merchant, category: rule.category, matched: true };
  }
  return { merchant, category: direction === "credit" ? "income" : "other", matched: direction === "credit" };
}
