// Tax helpers: reserved tags + HSA/FSA-eligible item suggestions. Pure module (no env/db).
//
// Suggestions only. SpendVault is not tax advice: eligibility depends on the
// plan and the item, so the UI says "may be eligible" and the user decides.

export const TAX_TAGS = [
  { tag: "tax-deductible", label: "Tax deductible" },
  { tag: "business", label: "Business" },
  { tag: "hsa-fsa", label: "HSA/FSA eligible" },
] as const;

export type TaxTag = (typeof TAX_TAGS)[number]["tag"];
export const TAX_TAG_KEYS: readonly string[] = TAX_TAGS.map((t) => t.tag);
export const isTaxTag = (t: string): t is TaxTag => TAX_TAG_KEYS.includes(t);

// Common over-the-counter items the IRS treats as medical care (CARES Act
// made OTC medicines and menstrual products eligible without a prescription).
const HSA_ITEM =
  /\b(rx|prescription|pharmacy\s*(item|rx)|ibuprofen|acetaminophen|tylenol|advil|motrin|aleve|naproxen|aspirin|allergy|antihistamine|zyrtec|claritin|allegra|benadryl|cough|cold\s*(&|and)?\s*flu|decongestant|sudafed|mucinex|nyquil|dayquil|antacid|tums|pepcid|prilosec|nexium|laxative|antibiotic\s*ointment|neosporin|hydrocortisone|bandage|band-?aid|gauze|first\s*aid|thermometer|blood\s*pressure|glucose|test\s*strips?|lancets?|insulin|contact\s*lens|lens\s*solution|saline|reading\s*glasses|eye\s*drops|sunscreen|spf\s*\d+|tampons?|pads?\b|menstrual|pregnancy\s*test|ovulation|condoms?|nicotine\s*(gum|patch|lozenge)|hearing\s*aid|knee\s*brace|wrist\s*brace|heating\s*pad|ice\s*pack|covid\s*test|flu\s*shot|vaccine|melatonin)\b/i;

const PHARMACY = /cvs|walgreens|rite\s*aid|duane\s*reade|pharmacy|drug\s*store|\bhealth\b/i;

/**
 * True when a receipt line looks HSA/FSA-eligible: a known OTC/medical item
 * name, or any non-food line in the `health` category at a pharmacy.
 */
export function suggestHsaFsa(item: { name: string; category: string }, merchant: string | null): boolean {
  if (HSA_ITEM.test(item.name)) return true;
  return item.category === "health" && PHARMACY.test(merchant ?? "");
}
