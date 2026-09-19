import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeterministically } from "./classifier";

function keys(items: ReadonlyArray<{ key: string }>): string[] {
  return items.map((item) => item.key);
}

test("classifies structured US CPI metadata from canonical mappings", () => {
  const result = classifyDeterministically({
    structuredMetadata: {
      countryCode: "US",
      category: "INFLATION",
      releaseFamily: "BLS_CPI",
      agency: "BLS",
      contentType: "MACRO_RELEASE",
    },
  });

  assert.equal(result.jurisdictionState, "KNOWN");
  assert.equal(result.primaryJurisdiction, "us");
  assert.deepEqual(result.relatedJurisdictions, []);
  assert.deepEqual(keys(result.institutions), ["bls"]);
  assert.deepEqual(keys(result.topics), ["inflation"]);
  assert.deepEqual(keys(result.events), ["cpi", "core-cpi"]);
  assert.equal(result.contentType, "MACRO_RELEASE");
  assert.equal(result.confidence, 1);
  assert.equal(result.source, "DETERMINISTIC");
});

test("keeps Indonesia CPI separate from US CPI", () => {
  const result = classifyDeterministically({
    primaryJurisdiction: "Indonesia",
    events: ["CPI"],
  });

  assert.equal(result.jurisdictionState, "KNOWN");
  assert.equal(result.primaryJurisdiction, "indonesia");
  assert.deepEqual(keys(result.events), ["cpi"]);
  assert.deepEqual(keys(result.topics), ["inflation"]);
});

test("maps subject central banks to their jurisdictions", () => {
  const cases = [
    ["Federal Reserve", "federal-reserve", "us"],
    ["Bank Indonesia", "bank-indonesia", "indonesia"],
    ["ECB", "ecb", "eurozone"],
    ["BOJ", "bank-of-japan", "japan"],
  ] as const;

  for (const [value, institution, jurisdiction] of cases) {
    const result = classifyDeterministically({ institutions: [value] });
    assert.deepEqual(keys(result.institutions), [institution]);
    assert.equal(result.primaryJurisdiction, jurisdiction);
  }
});

test("represents two primary institutions as MULTIPLE", () => {
  const result = classifyDeterministically({ institutions: ["Fed", "ECB"] });

  assert.equal(result.jurisdictionState, "MULTIPLE");
  assert.equal(result.primaryJurisdiction, null);
  assert.deepEqual(result.relatedJurisdictions, ["us", "eurozone"]);
});

test("preserves one primary jurisdiction with a related institution", () => {
  const result = classifyDeterministically({
    institutions: [
      { key: "Fed", role: "PRIMARY" },
      { key: "ECB", role: "RELATED" },
    ],
  });

  assert.equal(result.jurisdictionState, "KNOWN");
  assert.equal(result.primaryJurisdiction, "us");
  assert.deepEqual(result.relatedJurisdictions, ["eurozone"]);
});

test("GLOBAL and empty inputs never synthesize a jurisdiction", () => {
  const global = classifyDeterministically({ jurisdictionState: "GLOBAL", topics: ["Inflation"] });
  assert.equal(global.jurisdictionState, "GLOBAL");
  assert.equal(global.primaryJurisdiction, null);
  assert.deepEqual(global.relatedJurisdictions, []);

  const unknown = classifyDeterministically({});
  assert.equal(unknown.jurisdictionState, "UNKNOWN");
  assert.equal(unknown.primaryJurisdiction, null);
  assert.equal(unknown.confidence, 0);
  assert.equal(unknown.contentType, "UNKNOWN");
});

test("does not convert a subject institution into a topic", () => {
  const result = classifyDeterministically({ institutions: ["Federal Reserve"] });
  assert.deepEqual(keys(result.institutions), ["federal-reserve"]);
  assert.deepEqual(result.topics, []);
});

test("routes legacy FED and CPI pseudo-assets to their replacement facets", () => {
  const result = classifyDeterministically({ assets: ["FED", "CPI"] });

  assert.deepEqual(result.assets, []);
  assert.deepEqual(keys(result.institutions), ["federal-reserve"]);
  assert.deepEqual(keys(result.events), ["cpi"]);
  assert.deepEqual(keys(result.topics), ["inflation"]);
});

test("keeps real assets and derives their asset class", () => {
  const result = classifyDeterministically({ assets: ["S&P 500"] });
  assert.deepEqual(keys(result.assets), ["SPX"]);
  assert.deepEqual(keys(result.assetClasses), ["equity"]);
});

test("derives FOMC topic, institution, and jurisdiction", () => {
  const result = classifyDeterministically({ events: ["FOMC"] });
  assert.deepEqual(keys(result.events), ["fomc"]);
  assert.deepEqual(keys(result.topics), ["monetary-policy"]);
  assert.deepEqual(keys(result.institutions), ["federal-reserve"]);
  assert.equal(result.primaryJurisdiction, "us");
});

test("ignores unknown exact values and reflects them in aggregate confidence", () => {
  const result = classifyDeterministically({ topics: ["Inflation", "not-a-topic"] });
  assert.deepEqual(keys(result.topics), ["inflation"]);
  assert.equal(result.confidence, 0.5);
});
