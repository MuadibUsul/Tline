import type taxonomyJson from "../../../data/classification/taxonomy-v1.json";

type TaxonomyJson = typeof taxonomyJson;

export type JurisdictionKey = TaxonomyJson["jurisdictions"][number]["key"];
export type InstitutionKey = TaxonomyJson["institutions"][number]["key"];
export type TopicKey = TaxonomyJson["topics"][number]["key"];
export type EventKey = TaxonomyJson["events"][number]["key"];
export type AssetClass = TaxonomyJson["assetClasses"][number]["key"];
export type ContentType = TaxonomyJson["contentTypes"][number]["key"];

export type DecisionState =
  | "KNOWN"
  | "GLOBAL"
  | "MULTIPLE"
  | "UNKNOWN"
  | "NONE"
  | "NOT_APPLICABLE";

export type ClassificationSource = "DETERMINISTIC" | "JEV" | "LLM" | "MIXED" | "MANUAL";
export type InstitutionRole = "PRIMARY" | "RELATED";
export type ClassifiableContentKind = "ARTICLE" | "MACRO_INDICATOR" | "MACRO_RELEASE" | "POLICY_DOCUMENT";

/** A normalized score in the inclusive range 0..1. */
export type Confidence = number;

export interface ScoredKey<Key extends string = string> {
  key: Key;
  confidence: Confidence;
}

/**
 * A subject institution discussed by the content. This is deliberately distinct
 * from Article.institutionId, which continues to identify the publisher.
 */
export interface ClassifiedInstitution {
  key: InstitutionKey;
  role: InstitutionRole;
  confidence?: Confidence;
}

export interface ClassificationResult {
  jurisdictionState: DecisionState;
  primaryJurisdiction: JurisdictionKey | null;
  relatedJurisdictions: JurisdictionKey[];
  institutions: ClassifiedInstitution[];
  topics: Array<ScoredKey<TopicKey>>;
  /** Existing Asset tickers; the canonical asset dictionary remains src/lib/assets.ts. */
  assets: Array<ScoredKey<string>>;
  assetClasses: Array<ScoredKey<AssetClass>>;
  events: Array<ScoredKey<EventKey>>;
  contentType: ContentType;
  confidence: Confidence;
  source: ClassificationSource;
}

/**
 * Values within one facet are ORed; populated facets are ANDed together.
 * Example: jurisdictions=["us"] and topics=["inflation"] means US AND
 * Inflation, while topics=["inflation", "employment"] means Inflation OR
 * Employment. primaryJurisdictionOnly limits jurisdiction matching to the
 * primary jurisdiction instead of also considering related jurisdictions.
 */
export interface ContentFilter {
  jurisdictions?: JurisdictionKey[];
  institutions?: InstitutionKey[];
  topics?: TopicKey[];
  /** Existing Asset tickers, not event or institution aliases. */
  assets?: string[];
  assetClasses?: AssetClass[];
  events?: EventKey[];
  contentTypes?: ContentType[];
  primaryJurisdictionOnly?: boolean;
  dateRange?: {
    from?: Date;
    to?: Date;
  };
}
