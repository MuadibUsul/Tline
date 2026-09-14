import indicatorsJson from "../../../data/macro/indicators.json";
import releaseFamiliesJson from "../../../data/macro/release-families.json";
import sourcesJson from "../../../data/macro/sources.json";
import type { MacroIndicatorDefinition, MacroReleaseFamilyDefinition, MacroSourceDefinition } from "./types";

export const macroIndicators = indicatorsJson as MacroIndicatorDefinition[];
export const macroSources = sourcesJson as MacroSourceDefinition[];
export const macroReleaseFamilies = releaseFamiliesJson as MacroReleaseFamilyDefinition[];

const indicators = new Map(macroIndicators.map((indicator) => [indicator.canonicalKey, indicator]));
const sources = new Map(macroSources.map((source) => [`${source.provider}:${source.externalSeriesId}`, source]));
const releaseFamilies = new Map(macroReleaseFamilies.map((family) => [family.key, family]));

if (indicators.size !== macroIndicators.length) throw new Error("Duplicate macro canonicalKey.");
if (sources.size !== macroSources.length) throw new Error("Duplicate macro provider/externalSeriesId mapping.");
if (releaseFamilies.size !== macroReleaseFamilies.length) throw new Error("Duplicate macro release family key.");
for (const source of macroSources) {
  if (!indicators.has(source.canonicalKey)) throw new Error(`Unknown macro indicator ${source.canonicalKey}.`);
}
for (const family of macroReleaseFamilies) {
  for (const key of family.indicators) {
    if (!indicators.has(key)) throw new Error(`Unknown macro indicator ${key} in ${family.key}.`);
  }
  // A Chinese title is mandatory: the macro pages render titleZh on /zh, so a family
  // without one would surface the English title there. Enforce it at startup so a new
  // release family can never ship untranslated.
  if (!family.titleZh?.trim()) throw new Error(`Macro release family ${family.key} is missing a Chinese title (titleZh).`);
}
// The same for every indicator name, rendered as nameZh on the Chinese macro pages.
for (const indicator of macroIndicators) {
  if (!indicator.nameZh?.trim()) throw new Error(`Macro indicator ${indicator.canonicalKey} is missing a Chinese name (nameZh).`);
}

export function getMacroIndicator(canonicalKey: string): MacroIndicatorDefinition | null {
  return indicators.get(canonicalKey) ?? null;
}

export function getMacroSource(provider: string, externalSeriesId: string): MacroSourceDefinition | null {
  return sources.get(`${provider.toLowerCase()}:${externalSeriesId}`) ?? null;
}

export function getMacroSources(canonicalKey: string): MacroSourceDefinition[] {
  return macroSources
    .filter((source) => source.canonicalKey === canonicalKey && source.enabled)
    .sort((left, right) => left.priority - right.priority);
}

export function getMacroReleaseFamily(key: string): MacroReleaseFamilyDefinition | null {
  return releaseFamilies.get(key) ?? null;
}
