import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeterministically } from "./classifier";
import { discoverArticleClassification } from "./discovery";

const classify = (title: string, text: string, assetTickers: string[] = []) =>
  classifyDeterministically(discoverArticleClassification({ title, text, assetTickers }));

test("currency-pair research is discoverable from both related economies", () => {
  const euro = classify("FX Daily", "The common currency remains rangebound.", ["EURUSD"]);
  assert.equal(euro.jurisdictionState, "MULTIPLE");
  assert.deepEqual(new Set(euro.relatedJurisdictions), new Set(["eurozone", "us"]));

  const yen = classify("FX Daily", "Rate differentials continue to drive the pair.", ["USDJPY"]);
  assert.equal(yen.jurisdictionState, "MULTIPLE");
  assert.deepEqual(new Set(yen.relatedJurisdictions), new Set(["japan", "us"]));

  const sterling = classify("FX Daily", "The pair remains sensitive to rate expectations.", ["GBPUSD"]);
  assert.equal(sterling.jurisdictionState, "MULTIPLE");
  assert.deepEqual(new Set(sterling.relatedJurisdictions), new Set(["uk", "us"]));
});

test("a named economy in the title outranks the pair relationship", () => {
  const result = classify("Japan outlook: yen normalization", "The yen remains sensitive to rates.", ["USDJPY"]);
  assert.equal(result.primaryJurisdiction, "japan");
  assert.deepEqual(result.relatedJurisdictions, ["us"]);
});

test("United Kingdom and sterling research resolves to the UK", () => {
  const result = classify("United Kingdom outlook: sterling disinflation", "The pound remains sensitive to rates.", ["GBPUSD"]);
  assert.equal(result.primaryJurisdiction, "uk");
  assert.deepEqual(result.relatedJurisdictions, ["us"]);
});

test("a cross-country title retains every named economy", () => {
  const result = classify("Japan and United Kingdom outlook", "A comparison of two economies.");
  assert.equal(result.jurisdictionState, "MULTIPLE");
  assert.deepEqual(new Set(result.relatedJurisdictions), new Set(["japan", "uk"]));
});

test("central-bank mentions resolve the institution and jurisdiction", () => {
  const result = classify("Policy review", "The ECB kept its deposit rate unchanged.");
  assert.equal(result.primaryJurisdiction, "eurozone");
  assert.equal(result.institutions[0]?.key, "ecb");
});

test("one incidental currency mention in body text does not assign an economy", () => {
  const result = classify("Global allocation", "A euro-denominated bond appears in one example.");
  assert.equal(result.jurisdictionState, "UNKNOWN");
});

test("one incidental economy mention in body text does not assign an economy", () => {
  const result = classify("Global allocation", "The Euro Area appears once in a regional comparison.");
  assert.equal(result.jurisdictionState, "UNKNOWN");
});

test("lowercase fed as a verb is not the Federal Reserve", () => {
  const result = classify("Agriculture", "Livestock were fed grain throughout the winter.");
  assert.equal(result.jurisdictionState, "UNKNOWN");
  assert.deepEqual(result.institutions, []);
});
