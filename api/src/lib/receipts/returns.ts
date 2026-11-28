// Return windows + warranties from receipts. Pure module (no env/db).
//
// RETURN_POLICIES is the small, editable table of TYPICAL US return windows
// (standard items, days from purchase). Real policies vary by item, member
// tier, holiday season and state, so the UI always says "typical" and the
// user can override per receipt (receipts.return_days; 0 = final sale).

import { daysBetween, addDays, dayLabel, formatMoney, threshold } from "../insights/util.js";
import type { AlertCandidate } from "../insights/spikes.js";

export type ReturnPolicy = { key: string; name: string; days: number; match: RegExp; note?: string };

export const RETURN_POLICIES: readonly ReturnPolicy[] = [
  { key: "amazon", name: "Amazon", days: 30, match: /amazon|amzn/ },
  { key: "target", name: "Target", days: 90, match: /\btarget\b/ },
  { key: "walmart", name: "Walmart", days: 90, match: /walmart|wal-mart|wm supercenter/ },
  { key: "costco", name: "Costco", days: 90, match: /costco/, note: "90 days is for electronics and appliances; most other items have no set limit." },
  { key: "bestbuy", name: "Best Buy", days: 15, match: /best\s*buy|bestbuy/, note: "Longer for paid members." },
  { key: "apple", name: "Apple Store", days: 14, match: /^apple\b|apple\s*(store|\.com)|apple\s*online/ },
  { key: "homedepot", name: "Home Depot", days: 90, match: /home\s*depot|homedepot/ },
  { key: "lowes", name: "Lowe's", days: 90, match: /lowe'?s/ },
  { key: "ikea", name: "IKEA", days: 365, match: /ikea/, note: "New, unopened items." },
  { key: "kohls", name: "Kohl's", days: 180, match: /kohl'?s/ },
  { key: "macys", name: "Macy's", days: 30, match: /macy'?s/ },
  { key: "nike", name: "Nike", days: 60, match: /\bnike\b/ },
];

/** Categories where a return window is rarely useful (groceries, meals, fuel...). */
const NO_RETURN_CATEGORIES = new Set(["groceries", "dining", "food_delivery", "fuel", "transport", "travel", "utilities", "telecom", "subscriptions", "fees_charges", "health"]);

export function policyFor(merchant: string | null | undefined): ReturnPolicy | null {
  const m = (merchant ?? "").toLowerCase();
  if (!m.trim()) return null;
  return RETURN_POLICIES.find((p) => p.match.test(m)) ?? null;
}

export type ReturnWindowInput = { merchant: string | null; purchasedOn: string | null; returnDays: number | null };

export type ReturnWindow = {
  /** "typical" = from RETURN_POLICIES; "custom" = the user's override; null = unknown merchant. */
  source: "typical" | "custom" | null;
  policyName: string | null;
  days: number | null;
  note: string | null;
  closesOn: string | null;
  daysLeft: number | null;
  open: boolean;
};

export function returnWindow(r: ReturnWindowInput, today: string): ReturnWindow {
  const policy = policyFor(r.merchant);
  const custom = r.returnDays !== null && r.returnDays !== undefined;
  const days = custom ? r.returnDays! : (policy?.days ?? null);
  const source = custom ? "custom" : policy ? "typical" : null;
  if (days === null || !r.purchasedOn) {
    return { source, policyName: policy?.name ?? null, days, note: custom ? null : (policy?.note ?? null), closesOn: null, daysLeft: null, open: false };
  }
  const closesOn = addDays(r.purchasedOn, days);
  const daysLeft = daysBetween(today, closesOn);
  return { source, policyName: policy?.name ?? null, days, note: custom ? null : (policy?.note ?? null), closesOn, daysLeft, open: days > 0 && daysLeft >= 0 };
}

export type ReturnAlertReceipt = ReturnWindowInput & {
  id: string;
  total: number | null;
  currency: string;
  warrantyUntil: string | null;
  returned: boolean;
  itemCategories: readonly string[];
};

/** Worth a reminder: ≥ $25 / ₹1,000 and not all groceries/meals (an Amazon order of shoes, not a Walmart grocery run). */
export function returnWorthReminding(r: Pick<ReturnAlertReceipt, "total" | "currency" | "itemCategories">): boolean {
  if (r.total === null || r.total < threshold(1000, r.currency)) return false;
  if (r.itemCategories.length === 0) return true;
  return r.itemCategories.some((c) => !NO_RETURN_CATEGORIES.has(c));
}

export const RETURN_ALERT_DAYS = 3;
export const WARRANTY_ALERT_DAYS = 30;

export function returnWindowAlerts(receipts: readonly ReturnAlertReceipt[], today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const r of receipts) {
    const label = r.merchant ?? "a store";
    if (!r.returned && returnWorthReminding(r)) {
      const w = returnWindow(r, today);
      if (w.open && w.closesOn && w.daysLeft !== null && w.daysLeft <= RETURN_ALERT_DAYS) {
        const when = w.daysLeft === 0 ? "today" : w.daysLeft === 1 ? "tomorrow" : `in ${w.daysLeft} days`;
        out.push({
          kind: "return_window",
          dedupeKey: `return_window:${r.id}:${w.closesOn}`,
          title: `Return window for ${label} closes ${when}`,
          body:
            `Your ${r.total !== null ? `${formatMoney(r.total, r.currency)} ` : ""}${label} purchase from ${dayLabel(r.purchasedOn!)} can ` +
            `${w.source === "custom" ? "" : "typically "}be returned until ${dayLabel(w.closesOn)}. If you're not keeping it, return it now.`,
          merchant: r.merchant ?? undefined,
          amount: r.total ?? undefined,
          periodStart: w.closesOn,
          data: { receiptId: r.id, closesOn: w.closesOn, source: w.source },
        });
      }
    }
    if (r.warrantyUntil) {
      const left = daysBetween(today, r.warrantyUntil);
      if (left >= 0 && left <= WARRANTY_ALERT_DAYS) {
        out.push({
          kind: "warranty",
          dedupeKey: `warranty:${r.id}:${r.warrantyUntil}`,
          title: `Warranty for ${label} purchase ends ${left === 0 ? "today" : `in ${left} days`}`,
          body: `The warranty you noted for your ${label} purchase${r.purchasedOn ? ` from ${dayLabel(r.purchasedOn)}` : ""} ends on ${dayLabel(r.warrantyUntil)}. If anything's wrong with it, claim before then.`,
          merchant: r.merchant ?? undefined,
          amount: r.total ?? undefined,
          periodStart: r.warrantyUntil,
          data: { receiptId: r.id },
        });
      }
    }
  }
  return out;
}
