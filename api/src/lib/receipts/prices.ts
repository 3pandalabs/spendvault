// Item price tracker: the same item bought on different days → price history
// ("Eggs up 18% since August"). Pure module (no env/db).
//
// Same item = same normalized name (lowercase, SKUs/codes and punctuation
// removed, words sorted is NOT done: "large eggs 12ct" and "eggs large" stay
// different on purpose; sizes matter) in the same currency. Unit price =
// unitPrice, else lineTotal / quantity, else lineTotal. Discount lines
// (negative) are ignored. Needs ≥ 2 purchases on different dates.

import { round2 } from "../money.js";

export type PriceItemInput = {
  receiptId: string;
  merchant: string | null;
  purchasedOn: string | null;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  currency: string;
};

export type PricePoint = { date: string; unitPrice: number; merchant: string | null; receiptId: string };

export type PriceTrack = {
  key: string;
  name: string;
  currency: string;
  points: PricePoint[]; // oldest first, one per date (the lowest that day)
  firstPrice: number;
  latestPrice: number;
  /** latest vs first, in % (rounded to 1 dp). */
  changePct: number;
  since: string;
  latestOn: string;
  minPrice: number;
  maxPrice: number;
};

export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\d{5,}\b/g, " ") // SKUs / UPCs
    .replace(/\b(qty|x)\s*\d+\b/g, " ")
    .replace(/[^a-z0-9%.\s]+/g, " ")
    .replace(/\s+\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function unitPriceOf(i: Pick<PriceItemInput, "quantity" | "unitPrice" | "lineTotal">): number | null {
  if (i.lineTotal <= 0) return null;
  if (i.unitPrice !== null && i.unitPrice > 0) return round2(i.unitPrice);
  if (i.quantity !== null && i.quantity > 0) return round2(i.lineTotal / i.quantity);
  return round2(i.lineTotal);
}

export function priceTracks(items: readonly PriceItemInput[], opts: { minChangePct?: number; limit?: number } = {}): PriceTrack[] {
  const groups = new Map<string, { name: string; currency: string; byDate: Map<string, PricePoint> }>();
  for (const it of items) {
    if (!it.purchasedOn) continue;
    const key = normalizeItemName(it.name);
    if (key.length < 3) continue;
    const price = unitPriceOf(it);
    if (price === null) continue;
    const gk = `${key}|${it.currency}`;
    const g = groups.get(gk) ?? { name: it.name, currency: it.currency, byDate: new Map() };
    const prev = g.byDate.get(it.purchasedOn);
    if (!prev || price < prev.unitPrice) g.byDate.set(it.purchasedOn, { date: it.purchasedOn, unitPrice: price, merchant: it.merchant, receiptId: it.receiptId });
    if (!prev || it.purchasedOn >= [...g.byDate.keys()].sort().at(-1)!) g.name = it.name;
    groups.set(gk, g);
  }
  const out: PriceTrack[] = [];
  for (const [gk, g] of groups) {
    const points = [...g.byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < 2) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const changePct = Math.round(((last.unitPrice - first.unitPrice) / first.unitPrice) * 1000) / 10;
    if (Math.abs(changePct) < (opts.minChangePct ?? 0)) continue;
    const prices = points.map((p) => p.unitPrice);
    out.push({
      key: gk.split("|")[0],
      name: g.name,
      currency: g.currency,
      points,
      firstPrice: first.unitPrice,
      latestPrice: last.unitPrice,
      changePct,
      since: first.date,
      latestOn: last.date,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
    });
  }
  out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || b.latestOn.localeCompare(a.latestOn) || a.key.localeCompare(b.key));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Eggs up 18% since August" / "Milk down 5% since March 2025" / "Bread: same price since June". */
export function priceHeadline(t: Pick<PriceTrack, "name" | "changePct" | "since" | "latestOn">): string {
  const m = MONTHS[+t.since.slice(5, 7) - 1];
  const since = t.since.slice(0, 4) === t.latestOn.slice(0, 4) ? m : `${m} ${t.since.slice(0, 4)}`;
  const pct = Math.round(Math.abs(t.changePct));
  if (pct === 0) return `${t.name}: same price since ${since}`;
  return `${t.name} ${t.changePct > 0 ? "up" : "down"} ${pct}% since ${since}`;
}
