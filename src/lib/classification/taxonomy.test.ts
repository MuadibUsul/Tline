import assert from "node:assert/strict";
import test from "node:test";
import {
  getLegacyNonAssetAlias,
  isLegacyNonAssetAlias,
  resolveAlias,
  resolveCanonicalKey,
  resolveEventDefaultTopic,
  resolveInstitutionJurisdiction,
  resolveMacroIndicatorCategory,
  resolveMacroReleaseFamily,
  taxonomy,
  validateTaxonomy,
} from "./taxonomy";
import type { ClassificationResult, DecisionState } from "./types";

function resolveCpiContext(jurisdiction: string) {
  const jurisdictionKey = resolveCanonicalKey("jurisdiction", jurisdiction);
  const eventKey = resolveCanonicalKey("event", "CPI");
  assert.ok(jurisdictionKey);
  assert.ok(eventKey);
  return {
    jurisdiction: jurisdictionKey,
    event: eventKey,
    topic: resolveEventDefaultTopic(eventKey),
  };
}

function jurisdictionDecision(
  jurisdictionState: DecisionState,
  primaryJurisdiction: ClassificationResult["primaryJurisdiction"],
  relatedJurisdictions: ClassificationResult["relatedJurisdictions"],
): Pick<ClassificationResult, "jurisdictionState" | "primaryJurisdiction" | "relatedJurisdictions"> {
  return { jurisdictionState, primaryJurisdiction, relatedJurisdictions };
}

test("loads and validates the canonical taxonomy at module startup", () => {
  assert.equal(taxonomy.version, "1.0.0");
  assert.ok(taxonomy.jurisdictions.length >= 13);
  assert.ok(taxonomy.topics.length >= 16);
  assert.ok(taxonomy.events.length >= 22);
  assert.deepEqual(resolveMacroIndicatorCategory("INFLATION"), ["inflation"]);
  assert.deepEqual(resolveMacroReleaseFamily("BLS_CPI"), ["cpi", "core-cpi"]);
  assert.doesNotThrow(() => validateTaxonomy(structuredClone(taxonomy)));
});

test("US CPI and Indonesia CPI share event/topic but keep distinct jurisdictions", () => {
  const usCpi = resolveCpiContext("US");
  const indonesiaCpi = resolveCpiContext("Indonesia");

  assert.deepEqual(usCpi, { jurisdiction: "us", event: "cpi", topic: "inflation" });
  assert.deepEqual(indonesiaCpi, { jurisdiction: "indonesia", event: "cpi", topic: "inflation" });
  assert.notEqual(usCpi.jurisdiction, indonesiaCpi.jurisdiction);
});

test("central banks resolve as subject institutions with deterministic jurisdictions", () => {
  const cases = [
    ["Federal Reserve", "federal-reserve", "us"],
    ["Bank Indonesia", "bank-indonesia", "indonesia"],
    ["ECB", "ecb", "eurozone"],
    ["BOJ", "bank-of-japan", "japan"],
  ] as const;

  for (const [alias, institutionKey, jurisdictionKey] of cases) {
    assert.equal(resolveAlias("institution", alias), institutionKey);
    assert.equal(resolveInstitutionJurisdiction(institutionKey), jurisdictionKey);
  }

  assert.equal(resolveCanonicalKey("topic", "Federal Reserve"), null);
  assert.equal(resolveCanonicalKey("topic", "Fed"), null);
});

test("Fed plus ECB is represented by MULTIPLE without a synthetic jurisdiction", () => {
  const fed = resolveCanonicalKey("institution", "Fed");
  const ecb = resolveCanonicalKey("institution", "ECB");
  assert.ok(fed);
  assert.ok(ecb);

  const decision = jurisdictionDecision("MULTIPLE", null, [
    resolveInstitutionJurisdiction(fed)!,
    resolveInstitutionJurisdiction(ecb)!,
  ]);

  assert.deepEqual(decision, {
    jurisdictionState: "MULTIPLE",
    primaryJurisdiction: null,
    relatedJurisdictions: ["us", "eurozone"],
  });
  assert.equal(resolveCanonicalKey("jurisdiction", "multiple"), null);
});

test("GLOBAL and UNKNOWN are decision states, not jurisdiction records", () => {
  assert.deepEqual(jurisdictionDecision("GLOBAL", null, []), {
    jurisdictionState: "GLOBAL",
    primaryJurisdiction: null,
    relatedJurisdictions: [],
  });
  assert.deepEqual(jurisdictionDecision("UNKNOWN", null, []), {
    jurisdictionState: "UNKNOWN",
    primaryJurisdiction: null,
    relatedJurisdictions: [],
  });
  assert.equal(resolveCanonicalKey("jurisdiction", "global"), null);
  assert.equal(resolveCanonicalKey("jurisdiction", "unknown"), null);
});

test("legacy FED and CPI values are deprecated non-assets with facet replacements", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(taxonomy, "assets"), false);
  assert.equal(isLegacyNonAssetAlias("FED"), true);
  assert.equal(isLegacyNonAssetAlias("CPI"), true);
  assert.deepEqual(getLegacyNonAssetAlias("FED"), {
    alias: "FED",
    replacementFacet: "institution",
    replacementKey: "federal-reserve",
    deprecated: true,
  });
  assert.deepEqual(getLegacyNonAssetAlias("CPI"), {
    alias: "CPI",
    replacementFacet: "event",
    replacementKey: "cpi",
    deprecated: true,
  });
});

test("runtime validation rejects alias conflicts and broken references", () => {
  const conflictingAlias = structuredClone(taxonomy);
  conflictingAlias.topics[1].aliases.push("monetary-policy");
  assert.throws(() => validateTaxonomy(conflictingAlias), /topic alias .* conflicts/);

  const brokenReference = structuredClone(taxonomy);
  Reflect.set(brokenReference.events[0], "defaultTopicKey", "missing-topic");
  assert.throws(() => validateTaxonomy(brokenReference), /references missing topic/);

  const brokenStructuredMapping = structuredClone(taxonomy);
  Reflect.set(brokenStructuredMapping.structuredMappings.macroReleaseFamilies[0], "eventKeys", ["missing-event"]);
  assert.throws(() => validateTaxonomy(brokenStructuredMapping), /references missing event/);
});
