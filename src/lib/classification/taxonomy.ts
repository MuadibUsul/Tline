import taxonomyJson from "../../../data/classification/taxonomy-v1.json";
import type {
  AssetClass,
  ContentType,
  EventKey,
  InstitutionKey,
  JurisdictionKey,
  TopicKey,
} from "./types";

export type JurisdictionKind = "COUNTRY" | "ECONOMY" | "CURRENCY_AREA" | "REGION";
export type InstitutionKind = "CENTRAL_BANK" | "STATISTICAL_AGENCY" | "TREASURY" | "GOVERNMENT_AGENCY";

export interface JurisdictionDefinition {
  key: JurisdictionKey;
  slug: string;
  code: string;
  isoAlpha2: string | null;
  nameEn: string;
  nameZh: string;
  kind: JurisdictionKind;
  aliases: string[];
}

export interface InstitutionDefinition {
  key: InstitutionKey;
  nameEn: string;
  nameZh: string;
  kind: InstitutionKind;
  jurisdictionKey: JurisdictionKey;
  aliases: string[];
}

export interface TopicDefinition {
  key: TopicKey;
  nameEn: string;
  nameZh: string;
  aliases: string[];
}

export interface EventDefinition {
  key: EventKey;
  nameEn: string;
  nameZh: string;
  aliases: string[];
  defaultTopicKey: TopicKey;
  optionalInstitutionKey?: InstitutionKey;
}

export interface AssetClassDefinition {
  key: AssetClass;
  nameEn: string;
  nameZh: string;
  aliases: string[];
}

export interface ContentTypeDefinition {
  key: ContentType;
  nameEn: string;
  nameZh: string;
}

export interface InstitutionMapping {
  institutionKey: InstitutionKey;
  jurisdictionKey: JurisdictionKey;
}

export interface MacroIndicatorCategoryMapping {
  value: string;
  topicKeys: TopicKey[];
}

export interface MacroReleaseFamilyMapping {
  value: string;
  eventKeys: EventKey[];
}

export type LegacyReplacementFacet = "jurisdiction" | "institution" | "topic" | "event";

export interface LegacyNonAssetAlias {
  alias: string;
  replacementFacet: LegacyReplacementFacet;
  replacementKey: string;
  deprecated: true;
}

export interface CanonicalTaxonomy {
  version: string;
  jurisdictions: JurisdictionDefinition[];
  institutions: InstitutionDefinition[];
  topics: TopicDefinition[];
  events: EventDefinition[];
  assetClasses: AssetClassDefinition[];
  contentTypes: ContentTypeDefinition[];
  structuredMappings: {
    macroIndicatorCategories: MacroIndicatorCategoryMapping[];
    macroReleaseFamilies: MacroReleaseFamilyMapping[];
  };
  institutionMappings: InstitutionMapping[];
  aliases: {
    legacyNonAssets: LegacyNonAssetAlias[];
  };
}

export type TaxonomyFacet = "jurisdiction" | "institution" | "topic" | "event" | "assetClass" | "contentType";

interface FacetKeyMap {
  jurisdiction: JurisdictionKey;
  institution: InstitutionKey;
  topic: TopicKey;
  event: EventKey;
  assetClass: AssetClass;
  contentType: ContentType;
}

export class TaxonomyValidationError extends Error {
  constructor(message: string) {
    super(`Invalid classification taxonomy: ${message}`);
    this.name = "TaxonomyValidationError";
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaxonomyValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TaxonomyValidationError(`${path} must be an array`);
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TaxonomyValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((item, index) => asString(item, `${path}[${index}]`));
}

function asEnum<const Value extends string>(value: unknown, values: readonly Value[], path: string): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    throw new TaxonomyValidationError(`${path} must be one of ${values.join(", ")}`);
  }
  return value as Value;
}

function assertCanonicalKey(key: string, path: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new TaxonomyValidationError(`${path} must use lowercase kebab-case`);
  }
}

function assertUnique(values: string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TaxonomyValidationError(`${path} contains duplicate value "${value}"`);
    seen.add(value);
  }
}

export function normalizeTaxonomyLookup(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s_]+/gu, " ")
    .trim();
}

function assertUnambiguousAliases(
  facet: string,
  entries: Array<{ key: string; values: string[] }>,
): void {
  const owners = new Map<string, string>();
  for (const entry of entries) {
    for (const value of [entry.key, ...entry.values]) {
      const normalized = normalizeTaxonomyLookup(value);
      if (!normalized) throw new TaxonomyValidationError(`${facet} alias cannot normalize to an empty value`);
      const owner = owners.get(normalized);
      if (owner && owner !== entry.key) {
        throw new TaxonomyValidationError(`${facet} alias "${value}" conflicts between "${owner}" and "${entry.key}"`);
      }
      owners.set(normalized, entry.key);
    }
  }
}

export function validateTaxonomy(input: unknown): CanonicalTaxonomy {
  const root = asRecord(input, "root");
  const version = asString(root.version, "version");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new TaxonomyValidationError("version must use semantic version format");

  const jurisdictions = asArray(root.jurisdictions, "jurisdictions").map((value, index): JurisdictionDefinition => {
    const path = `jurisdictions[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    const slug = asString(item.slug, `${path}.slug`);
    const code = asString(item.code, `${path}.code`);
    const isoAlpha2 = item.isoAlpha2 === null ? null : asString(item.isoAlpha2, `${path}.isoAlpha2`);
    assertCanonicalKey(key, `${path}.key`);
    assertCanonicalKey(slug, `${path}.slug`);
    if (!/^[A-Z]{2,3}$/.test(code)) throw new TaxonomyValidationError(`${path}.code must contain 2-3 uppercase letters`);
    if (isoAlpha2 !== null && !/^[A-Z]{2}$/.test(isoAlpha2)) {
      throw new TaxonomyValidationError(`${path}.isoAlpha2 must be null or two uppercase letters`);
    }
    return {
      key: key as JurisdictionKey,
      slug,
      code,
      isoAlpha2,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
      kind: asEnum(item.kind, ["COUNTRY", "ECONOMY", "CURRENCY_AREA", "REGION"] as const, `${path}.kind`),
      aliases: asStringArray(item.aliases, `${path}.aliases`),
    };
  });

  const institutions = asArray(root.institutions, "institutions").map((value, index): InstitutionDefinition => {
    const path = `institutions[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    assertCanonicalKey(key, `${path}.key`);
    return {
      key: key as InstitutionKey,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
      kind: asEnum(item.kind, ["CENTRAL_BANK", "STATISTICAL_AGENCY", "TREASURY", "GOVERNMENT_AGENCY"] as const, `${path}.kind`),
      jurisdictionKey: asString(item.jurisdictionKey, `${path}.jurisdictionKey`) as JurisdictionKey,
      aliases: asStringArray(item.aliases, `${path}.aliases`),
    };
  });

  const topics = asArray(root.topics, "topics").map((value, index): TopicDefinition => {
    const path = `topics[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    assertCanonicalKey(key, `${path}.key`);
    return {
      key: key as TopicKey,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
      aliases: asStringArray(item.aliases, `${path}.aliases`),
    };
  });

  const events = asArray(root.events, "events").map((value, index): EventDefinition => {
    const path = `events[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    assertCanonicalKey(key, `${path}.key`);
    const optionalInstitutionKey = item.optionalInstitutionKey === undefined
      ? undefined
      : asString(item.optionalInstitutionKey, `${path}.optionalInstitutionKey`) as InstitutionKey;
    return {
      key: key as EventKey,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
      aliases: asStringArray(item.aliases, `${path}.aliases`),
      defaultTopicKey: asString(item.defaultTopicKey, `${path}.defaultTopicKey`) as TopicKey,
      ...(optionalInstitutionKey ? { optionalInstitutionKey } : {}),
    };
  });

  const assetClasses = asArray(root.assetClasses, "assetClasses").map((value, index): AssetClassDefinition => {
    const path = `assetClasses[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    assertCanonicalKey(key, `${path}.key`);
    return {
      key: key as AssetClass,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
      aliases: asStringArray(item.aliases, `${path}.aliases`),
    };
  });

  const contentTypes = asArray(root.contentTypes, "contentTypes").map((value, index): ContentTypeDefinition => {
    const path = `contentTypes[${index}]`;
    const item = asRecord(value, path);
    const key = asString(item.key, `${path}.key`);
    if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(key)) {
      throw new TaxonomyValidationError(`${path}.key must use UPPER_SNAKE_CASE`);
    }
    return {
      key: key as ContentType,
      nameEn: asString(item.nameEn, `${path}.nameEn`),
      nameZh: asString(item.nameZh, `${path}.nameZh`),
    };
  });

  const structuredMappings = asRecord(root.structuredMappings, "structuredMappings");
  const macroIndicatorCategories = asArray(
    structuredMappings.macroIndicatorCategories,
    "structuredMappings.macroIndicatorCategories",
  ).map((value, index): MacroIndicatorCategoryMapping => {
    const path = `structuredMappings.macroIndicatorCategories[${index}]`;
    const item = asRecord(value, path);
    return {
      value: asString(item.value, `${path}.value`),
      topicKeys: asStringArray(item.topicKeys, `${path}.topicKeys`) as TopicKey[],
    };
  });
  const macroReleaseFamilies = asArray(
    structuredMappings.macroReleaseFamilies,
    "structuredMappings.macroReleaseFamilies",
  ).map((value, index): MacroReleaseFamilyMapping => {
    const path = `structuredMappings.macroReleaseFamilies[${index}]`;
    const item = asRecord(value, path);
    return {
      value: asString(item.value, `${path}.value`),
      eventKeys: asStringArray(item.eventKeys, `${path}.eventKeys`) as EventKey[],
    };
  });

  const institutionMappings = asArray(root.institutionMappings, "institutionMappings").map((value, index): InstitutionMapping => {
    const path = `institutionMappings[${index}]`;
    const item = asRecord(value, path);
    return {
      institutionKey: asString(item.institutionKey, `${path}.institutionKey`) as InstitutionKey,
      jurisdictionKey: asString(item.jurisdictionKey, `${path}.jurisdictionKey`) as JurisdictionKey,
    };
  });

  const aliases = asRecord(root.aliases, "aliases");
  const legacyNonAssets = asArray(aliases.legacyNonAssets, "aliases.legacyNonAssets").map((value, index): LegacyNonAssetAlias => {
    const path = `aliases.legacyNonAssets[${index}]`;
    const item = asRecord(value, path);
    if (item.deprecated !== true) throw new TaxonomyValidationError(`${path}.deprecated must be true`);
    return {
      alias: asString(item.alias, `${path}.alias`),
      replacementFacet: asEnum(item.replacementFacet, ["jurisdiction", "institution", "topic", "event"] as const, `${path}.replacementFacet`),
      replacementKey: asString(item.replacementKey, `${path}.replacementKey`),
      deprecated: true,
    };
  });

  assertUnique(jurisdictions.map((item) => item.key), "jurisdiction keys");
  assertUnique(jurisdictions.map((item) => item.slug), "jurisdiction slugs");
  assertUnique(institutions.map((item) => item.key), "institution keys");
  assertUnique(topics.map((item) => item.key), "topic keys");
  assertUnique(events.map((item) => item.key), "event keys");
  assertUnique(assetClasses.map((item) => item.key), "asset class keys");
  assertUnique(contentTypes.map((item) => item.key), "content type keys");
  assertUnique(macroIndicatorCategories.map((item) => normalizeTaxonomyLookup(item.value)), "macro indicator category mappings");
  assertUnique(macroReleaseFamilies.map((item) => normalizeTaxonomyLookup(item.value)), "macro release family mappings");
  assertUnique(institutionMappings.map((item) => item.institutionKey), "institution mapping keys");
  assertUnique(legacyNonAssets.map((item) => normalizeTaxonomyLookup(item.alias)), "legacy non-asset aliases");

  const jurisdictionKeys = new Set<string>(jurisdictions.map((item) => item.key));
  const institutionKeys = new Set<string>(institutions.map((item) => item.key));
  const topicKeys = new Set<string>(topics.map((item) => item.key));
  const eventKeys = new Set<string>(events.map((item) => item.key));

  for (const institution of institutions) {
    if (!jurisdictionKeys.has(institution.jurisdictionKey)) {
      throw new TaxonomyValidationError(`institution "${institution.key}" references missing jurisdiction "${institution.jurisdictionKey}"`);
    }
    const mapping = institutionMappings.find((item) => item.institutionKey === institution.key);
    if (!mapping) throw new TaxonomyValidationError(`institution "${institution.key}" has no deterministic jurisdiction mapping`);
    if (mapping.jurisdictionKey !== institution.jurisdictionKey) {
      throw new TaxonomyValidationError(`institution mapping for "${institution.key}" disagrees with its jurisdictionKey`);
    }
  }
  for (const mapping of institutionMappings) {
    if (!institutionKeys.has(mapping.institutionKey)) {
      throw new TaxonomyValidationError(`institution mapping references missing institution "${mapping.institutionKey}"`);
    }
    if (!jurisdictionKeys.has(mapping.jurisdictionKey)) {
      throw new TaxonomyValidationError(`institution mapping references missing jurisdiction "${mapping.jurisdictionKey}"`);
    }
  }
  for (const event of events) {
    if (!topicKeys.has(event.defaultTopicKey)) {
      throw new TaxonomyValidationError(`event "${event.key}" references missing topic "${event.defaultTopicKey}"`);
    }
    if (event.optionalInstitutionKey && !institutionKeys.has(event.optionalInstitutionKey)) {
      throw new TaxonomyValidationError(`event "${event.key}" references missing institution "${event.optionalInstitutionKey}"`);
    }
  }
  for (const mapping of macroIndicatorCategories) {
    for (const topicKey of mapping.topicKeys) {
      if (!topicKeys.has(topicKey)) {
        throw new TaxonomyValidationError(`macro category "${mapping.value}" references missing topic "${topicKey}"`);
      }
    }
  }
  for (const mapping of macroReleaseFamilies) {
    for (const eventKey of mapping.eventKeys) {
      if (!eventKeys.has(eventKey)) {
        throw new TaxonomyValidationError(`macro release family "${mapping.value}" references missing event "${eventKey}"`);
      }
    }
  }

  const validLegacyTargets: Record<LegacyReplacementFacet, Set<string>> = {
    jurisdiction: jurisdictionKeys,
    institution: institutionKeys,
    topic: topicKeys,
    event: eventKeys,
  };
  for (const alias of legacyNonAssets) {
    if (!validLegacyTargets[alias.replacementFacet].has(alias.replacementKey)) {
      throw new TaxonomyValidationError(`legacy alias "${alias.alias}" references missing ${alias.replacementFacet} "${alias.replacementKey}"`);
    }
  }

  assertUnambiguousAliases("jurisdiction", jurisdictions.map((item) => ({
    key: item.key,
    values: [item.slug, item.code, ...(item.isoAlpha2 ? [item.isoAlpha2] : []), item.nameEn, item.nameZh, ...item.aliases],
  })));
  assertUnambiguousAliases("institution", institutions.map((item) => ({ key: item.key, values: [item.nameEn, item.nameZh, ...item.aliases] })));
  assertUnambiguousAliases("topic", topics.map((item) => ({ key: item.key, values: [item.nameEn, item.nameZh, ...item.aliases] })));
  assertUnambiguousAliases("event", events.map((item) => ({ key: item.key, values: [item.nameEn, item.nameZh, ...item.aliases] })));
  assertUnambiguousAliases("asset class", assetClasses.map((item) => ({ key: item.key, values: [item.nameEn, item.nameZh, ...item.aliases] })));
  assertUnambiguousAliases("content type", contentTypes.map((item) => ({ key: item.key, values: [item.nameEn, item.nameZh] })));

  return {
    version,
    jurisdictions,
    institutions,
    topics,
    events,
    assetClasses,
    contentTypes,
    structuredMappings: { macroIndicatorCategories, macroReleaseFamilies },
    institutionMappings,
    aliases: { legacyNonAssets },
  };
}

export function loadTaxonomy(input: unknown = taxonomyJson): CanonicalTaxonomy {
  return validateTaxonomy(input);
}

export const taxonomy = loadTaxonomy();

function facetEntries(facet: TaxonomyFacet): Array<{ key: string; aliases: string[] }> {
  switch (facet) {
    case "jurisdiction":
      return taxonomy.jurisdictions.map((item) => ({
        key: item.key,
        aliases: [item.slug, item.code, ...(item.isoAlpha2 ? [item.isoAlpha2] : []), item.nameEn, item.nameZh, ...item.aliases],
      }));
    case "institution":
      return taxonomy.institutions.map((item) => ({ key: item.key, aliases: [item.nameEn, item.nameZh, ...item.aliases] }));
    case "topic":
      return taxonomy.topics.map((item) => ({ key: item.key, aliases: [item.nameEn, item.nameZh, ...item.aliases] }));
    case "event":
      return taxonomy.events.map((item) => ({ key: item.key, aliases: [item.nameEn, item.nameZh, ...item.aliases] }));
    case "assetClass":
      return taxonomy.assetClasses.map((item) => ({ key: item.key, aliases: [item.nameEn, item.nameZh, ...item.aliases] }));
    case "contentType":
      return taxonomy.contentTypes.map((item) => ({ key: item.key, aliases: [item.nameEn, item.nameZh] }));
  }
}

const canonicalIndexes = {} as Record<TaxonomyFacet, Map<string, string>>;
const aliasIndexes = {} as Record<TaxonomyFacet, Map<string, string>>;

for (const facet of ["jurisdiction", "institution", "topic", "event", "assetClass", "contentType"] as const) {
  const canonical = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const entry of facetEntries(facet)) {
    canonical.set(normalizeTaxonomyLookup(entry.key), entry.key);
    for (const alias of entry.aliases) aliases.set(normalizeTaxonomyLookup(alias), entry.key);
  }
  canonicalIndexes[facet] = canonical;
  aliasIndexes[facet] = aliases;
}

export function resolveAlias<Facet extends TaxonomyFacet>(facet: Facet, value: string): FacetKeyMap[Facet] | null {
  return (aliasIndexes[facet].get(normalizeTaxonomyLookup(value)) as FacetKeyMap[Facet] | undefined) ?? null;
}

export function resolveCanonicalKey<Facet extends TaxonomyFacet>(facet: Facet, value: string): FacetKeyMap[Facet] | null {
  const normalized = normalizeTaxonomyLookup(value);
  return ((canonicalIndexes[facet].get(normalized) ?? aliasIndexes[facet].get(normalized)) as FacetKeyMap[Facet] | undefined) ?? null;
}

export function resolveInstitutionJurisdiction(institutionKey: InstitutionKey): JurisdictionKey | null {
  return taxonomy.institutionMappings.find((item) => item.institutionKey === institutionKey)?.jurisdictionKey ?? null;
}

export function resolveEventDefaultTopic(eventKey: EventKey): TopicKey | null {
  return taxonomy.events.find((item) => item.key === eventKey)?.defaultTopicKey ?? null;
}

export function resolveMacroIndicatorCategory(value: string): TopicKey[] {
  const normalized = normalizeTaxonomyLookup(value);
  const mapping = taxonomy.structuredMappings.macroIndicatorCategories.find(
    (item) => normalizeTaxonomyLookup(item.value) === normalized,
  );
  return mapping ? [...mapping.topicKeys] : [];
}

export function resolveMacroReleaseFamily(value: string): EventKey[] {
  const normalized = normalizeTaxonomyLookup(value);
  const mapping = taxonomy.structuredMappings.macroReleaseFamilies.find(
    (item) => normalizeTaxonomyLookup(item.value) === normalized,
  );
  return mapping ? [...mapping.eventKeys] : [];
}

export function getLegacyNonAssetAlias(value: string): LegacyNonAssetAlias | null {
  const normalized = normalizeTaxonomyLookup(value);
  return taxonomy.aliases.legacyNonAssets.find((item) => normalizeTaxonomyLookup(item.alias) === normalized) ?? null;
}

export function isLegacyNonAssetAlias(value: string): boolean {
  return getLegacyNonAssetAlias(value) !== null;
}
