import { ASSETS, type AssetDef } from "../assets";
import {
  getLegacyNonAssetAlias,
  isLegacyNonAssetAlias,
  normalizeTaxonomyLookup,
  resolveCanonicalKey,
  resolveEventDefaultTopic,
  resolveInstitutionJurisdiction,
  resolveMacroIndicatorCategory,
  resolveMacroReleaseFamily,
  taxonomy,
} from "./taxonomy";
import type {
  AssetClass,
  ClassificationResult,
  ClassifiedInstitution,
  Confidence,
  ContentType,
  DecisionState,
  EventKey,
  InstitutionKey,
  InstitutionRole,
  JurisdictionKey,
  ScoredKey,
  TopicKey,
} from "./types";

export interface DeterministicStructuredMetadata {
  countryCode?: string | null;
  category?: string | null;
  releaseFamily?: string | null;
  agency?: string | null;
  assetTicker?: string | null;
  assetClass?: string | null;
  contentType?: string | null;
}

export interface DeterministicInstitutionInput {
  key: string;
  role?: InstitutionRole;
  confidence?: number;
}

export interface DeterministicClassificationInput {
  jurisdictionState?: DecisionState;
  primaryJurisdiction?: string | null;
  relatedJurisdictions?: readonly string[];
  institutions?: readonly (string | DeterministicInstitutionInput)[];
  topics?: readonly string[];
  assets?: readonly string[];
  assetClasses?: readonly string[];
  events?: readonly string[];
  contentType?: string | null;
  structuredMetadata?: DeterministicStructuredMetadata;
}

export const DETERMINISTIC_CLASSIFIER_VERSION = "1.0.0";

function clampConfidence(value: number | undefined): Confidence {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function setScore<Key extends string>(scores: Map<Key, Confidence>, key: Key, confidence = 1): void {
  scores.set(key, Math.max(scores.get(key) ?? 0, clampConfidence(confidence)));
}

function scoredEntries<Key extends string>(scores: Map<Key, Confidence>): Array<ScoredKey<Key>> {
  return [...scores].map(([key, confidence]) => ({ key, confidence }));
}

const assetIndex = new Map<string, AssetDef>();
for (const asset of ASSETS) {
  if (isLegacyNonAssetAlias(asset.ticker)) continue;
  for (const value of [asset.ticker, asset.name, ...asset.aliases]) {
    const normalized = normalizeTaxonomyLookup(value);
    if (!assetIndex.has(normalized)) assetIndex.set(normalized, asset);
  }
}

/**
 * Classifies already-structured, exact values without text inference, I/O, or AI.
 * Unknown values are ignored and reduce the aggregate confidence.
 */
export function classifyDeterministically(input: DeterministicClassificationInput): ClassificationResult {
  const institutions = new Map<InstitutionKey, ClassifiedInstitution>();
  const topics = new Map<TopicKey, Confidence>();
  const assets = new Map<string, Confidence>();
  const assetClasses = new Map<AssetClass, Confidence>();
  const events = new Map<EventKey, Confidence>();
  const primaryJurisdictions = new Set<JurisdictionKey>();
  const relatedJurisdictions = new Set<JurisdictionKey>();
  let attempted = 0;
  let resolved = 0;

  const recordAttempt = (matched: boolean): void => {
    attempted += 1;
    if (matched) resolved += 1;
  };

  const addInstitution = (
    key: InstitutionKey,
    role: InstitutionRole = "PRIMARY",
    confidence = 1,
  ): void => {
    const existing = institutions.get(key);
    institutions.set(key, {
      key,
      role: existing?.role === "PRIMARY" || role === "PRIMARY" ? "PRIMARY" : "RELATED",
      confidence: Math.max(existing?.confidence ?? 0, clampConfidence(confidence)),
    });
  };

  const addTopic = (key: TopicKey, confidence = 1): void => setScore(topics, key, confidence);

  const addEvent = (key: EventKey, confidence = 1): void => {
    setScore(events, key, confidence);
    const defaultTopic = resolveEventDefaultTopic(key);
    if (defaultTopic) addTopic(defaultTopic, confidence);
    const definition = taxonomy.events.find((event) => event.key === key);
    if (definition?.optionalInstitutionKey) {
      const hasPrimary = [...institutions.values()].some((institution) => institution.role === "PRIMARY");
      addInstitution(definition.optionalInstitutionKey, hasPrimary ? "RELATED" : "PRIMARY", confidence);
    }
  };

  const addLegacyReplacement = (value: string): boolean => {
    const legacy = getLegacyNonAssetAlias(value);
    if (!legacy) return false;
    switch (legacy.replacementFacet) {
      case "jurisdiction": {
        const key = resolveCanonicalKey("jurisdiction", legacy.replacementKey);
        if (key) primaryJurisdictions.add(key);
        return key !== null;
      }
      case "institution": {
        const key = resolveCanonicalKey("institution", legacy.replacementKey);
        if (key) addInstitution(key);
        return key !== null;
      }
      case "topic": {
        const key = resolveCanonicalKey("topic", legacy.replacementKey);
        if (key) addTopic(key);
        return key !== null;
      }
      case "event": {
        const key = resolveCanonicalKey("event", legacy.replacementKey);
        if (key) addEvent(key);
        return key !== null;
      }
    }
  };

  const addAsset = (value: string): boolean => {
    if (addLegacyReplacement(value)) return true;
    const asset = assetIndex.get(normalizeTaxonomyLookup(value));
    if (!asset) return false;
    setScore(assets, asset.ticker);
    const assetClass = resolveCanonicalKey("assetClass", asset.assetClass);
    if (assetClass) setScore(assetClasses, assetClass);
    return true;
  };

  if (input.jurisdictionState) recordAttempt(true);

  if (input.primaryJurisdiction) {
    const key = resolveCanonicalKey("jurisdiction", input.primaryJurisdiction);
    recordAttempt(key !== null);
    if (key) primaryJurisdictions.add(key);
  }
  for (const value of input.relatedJurisdictions ?? []) {
    const key = resolveCanonicalKey("jurisdiction", value);
    recordAttempt(key !== null);
    if (key) relatedJurisdictions.add(key);
  }

  const metadata = input.structuredMetadata;
  if (metadata?.countryCode) {
    const key = resolveCanonicalKey("jurisdiction", metadata.countryCode);
    recordAttempt(key !== null);
    if (key) primaryJurisdictions.add(key);
  }

  for (const value of input.institutions ?? []) {
    const item = typeof value === "string" ? { key: value } : value;
    const key = resolveCanonicalKey("institution", item.key);
    recordAttempt(key !== null);
    if (key) addInstitution(key, item.role, item.confidence);
  }
  if (metadata?.agency) {
    const key = resolveCanonicalKey("institution", metadata.agency);
    recordAttempt(key !== null);
    if (key) addInstitution(key);
  }

  for (const value of input.topics ?? []) {
    const key = resolveCanonicalKey("topic", value);
    recordAttempt(key !== null);
    if (key) addTopic(key);
  }
  if (metadata?.category) {
    const keys = resolveMacroIndicatorCategory(metadata.category);
    recordAttempt(keys.length > 0);
    for (const key of keys) addTopic(key);
  }

  for (const value of input.events ?? []) {
    const key = resolveCanonicalKey("event", value);
    recordAttempt(key !== null);
    if (key) addEvent(key);
  }
  if (metadata?.releaseFamily) {
    const keys = resolveMacroReleaseFamily(metadata.releaseFamily);
    recordAttempt(keys.length > 0);
    for (const key of keys) addEvent(key);
  }

  for (const value of input.assets ?? []) {
    const matched = addAsset(value);
    recordAttempt(matched);
  }
  if (metadata?.assetTicker) {
    const matched = addAsset(metadata.assetTicker);
    recordAttempt(matched);
  }

  for (const value of input.assetClasses ?? []) {
    const key = resolveCanonicalKey("assetClass", value);
    recordAttempt(key !== null);
    if (key) setScore(assetClasses, key);
  }
  if (metadata?.assetClass) {
    const key = resolveCanonicalKey("assetClass", metadata.assetClass);
    recordAttempt(key !== null);
    if (key) setScore(assetClasses, key);
  }

  const contentTypeValue = input.contentType ?? metadata?.contentType;
  let contentType: ContentType = "UNKNOWN";
  if (contentTypeValue) {
    const key = resolveCanonicalKey("contentType", contentTypeValue);
    recordAttempt(key !== null);
    if (key) contentType = key;
  }

  for (const institution of institutions.values()) {
    const jurisdiction = resolveInstitutionJurisdiction(institution.key);
    if (!jurisdiction) continue;
    if (institution.role === "PRIMARY") primaryJurisdictions.add(jurisdiction);
    else relatedJurisdictions.add(jurisdiction);
  }

  let jurisdictionState: DecisionState;
  let primaryJurisdiction: JurisdictionKey | null = null;
  let finalRelatedJurisdictions: JurisdictionKey[] = [];
  const explicitState = input.jurisdictionState;
  const terminalStates: DecisionState[] = ["GLOBAL", "UNKNOWN", "NONE", "NOT_APPLICABLE"];

  if (explicitState && terminalStates.includes(explicitState)) {
    jurisdictionState = explicitState;
  } else {
    const allJurisdictions = new Set([...primaryJurisdictions, ...relatedJurisdictions]);
    if (explicitState === "MULTIPLE" || primaryJurisdictions.size > 1 || (primaryJurisdictions.size === 0 && allJurisdictions.size > 1)) {
      jurisdictionState = "MULTIPLE";
      finalRelatedJurisdictions = [...allJurisdictions];
    } else if (primaryJurisdictions.size === 1) {
      jurisdictionState = "KNOWN";
      primaryJurisdiction = [...primaryJurisdictions][0];
      finalRelatedJurisdictions = [...relatedJurisdictions].filter((key) => key !== primaryJurisdiction);
    } else if (allJurisdictions.size === 1) {
      jurisdictionState = "KNOWN";
      primaryJurisdiction = [...allJurisdictions][0];
    } else {
      jurisdictionState = "UNKNOWN";
    }
  }

  return {
    jurisdictionState,
    primaryJurisdiction,
    relatedJurisdictions: finalRelatedJurisdictions,
    institutions: [...institutions.values()],
    topics: scoredEntries(topics),
    assets: scoredEntries(assets),
    assetClasses: scoredEntries(assetClasses),
    events: scoredEntries(events),
    contentType,
    confidence: attempted === 0 ? 0 : resolved / attempted,
    source: "DETERMINISTIC",
  };
}
