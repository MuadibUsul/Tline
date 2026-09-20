import { taxonomy } from "./taxonomy";
import type { DeterministicClassificationInput, DeterministicInstitutionInput } from "./classifier";
import type { JurisdictionKey } from "./types";

const ASSET_JURISDICTIONS: Record<string, JurisdictionKey[]> = {
  EURUSD: ["eurozone", "us"],
  GBPUSD: ["uk", "us"],
  USDJPY: ["japan", "us"],
};

const CURRENCY_TERMS: Partial<Record<JurisdictionKey, string[]>> = {
  eurozone: ["euro", "EUR"],
  japan: ["Japanese", "yen", "JPY"],
  uk: ["British", "sterling", "pound", "GBP"],
};

function mentionCount(text: string, term: string): number {
  if (!term || /^[a-z]{1,2}$/i.test(term)) return 0;
  if (/[^\x00-\x7f]/.test(term)) return text.split(term).length - 1;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = term.length <= 4 && /[A-Z]/.test(term) ? "g" : "gi";
  return [...text.matchAll(new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, flags))].length;
}

/**
 * Finds explicit article facets before AI enrichment. Currency pairs are related to both
 * economies; named economies and institutions remain the stronger primary signal.
 */
export function discoverArticleClassification(input: {
  title: string;
  text: string;
  assetTickers?: readonly string[];
}): DeterministicClassificationInput {
  const primary = new Set<JurisdictionKey>();
  const related = new Set<JurisdictionKey>();
  const institutions: DeterministicInstitutionInput[] = [];

  for (const item of taxonomy.jurisdictions) {
    const terms = [item.nameEn, item.nameZh, ...item.aliases];
    if (terms.some((term) => mentionCount(input.title, term) > 0)) primary.add(item.key);
    else if (terms.some((term) => mentionCount(input.text, term) >= 2)) related.add(item.key);
  }

  for (const [key, terms] of Object.entries(CURRENCY_TERMS) as Array<[JurisdictionKey, string[]]>) {
    if (terms.some((term) => mentionCount(input.title, term) > 0 || mentionCount(input.text, term) >= 2)) related.add(key);
  }

  for (const item of taxonomy.institutions) {
    const terms = [item.nameEn, item.nameZh, ...item.aliases];
    const inTitle = terms.some((term) => mentionCount(input.title, term) > 0);
    if (inTitle || terms.some((term) => mentionCount(input.text, term) > 0)) {
      institutions.push({ key: item.key, role: inTitle ? "PRIMARY" : "RELATED" });
    }
  }

  for (const ticker of input.assetTickers ?? []) {
    for (const key of ASSET_JURISDICTIONS[ticker.toUpperCase()] ?? []) related.add(key);
  }

  for (const key of primary) related.delete(key);
  const primaryJurisdictions = [...primary];
  const relatedJurisdictions = primaryJurisdictions.length > 1
    ? [...new Set([...primaryJurisdictions, ...related])]
    : [...related];
  return {
    ...(primaryJurisdictions.length === 1 ? { primaryJurisdiction: primaryJurisdictions[0] } : {}),
    ...(primaryJurisdictions.length > 1 ? { jurisdictionState: "MULTIPLE" as const } : {}),
    relatedJurisdictions,
    institutions,
    assets: input.assetTickers,
    contentType: "RESEARCH_ARTICLE",
  };
}
