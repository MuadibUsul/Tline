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
