import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");
const schema = read("prisma/schema.prisma");

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing Prisma model ${name}`);
  return match[1];
}

test("defines normalized faceted content classification tables", () => {
  for (const name of [
    "ContentClassification",
    "ClassificationJurisdiction",
    "ClassificationInstitution",
    "ClassificationTopic",
    "ClassificationAsset",
    "ClassificationAssetClass",
    "ClassificationEvent",
  ]) model(name);

  const classification = model("ContentClassification");
  assert.match(classification, /articleId\s+String\?\s+@unique/);
  assert.match(classification, /macroIndicatorId\s+String\?\s+@unique/);
  assert.match(classification, /macroReleaseId\s+String\?\s+@unique/);
  assert.match(classification, /policyDocumentId\s+String\?\s+@unique/);
  assert.match(classification, /taxonomyVersion\s+String/);
  assert.match(classification, /status\s+String\s+@default\("PENDING"\)/);
  assert.match(classification, /classifier\s+String\?/);
  assert.match(classification, /classifierVersion\s+String\?/);
  assert.match(classification, /fingerprint\s+String\?/);
  assert.match(classification, /classifiedAt\s+DateTime\?/);
  assert.match(classification, /decisionCalls\s+DecisionCall\[\]/);
  assert.match(model("ClassificationJurisdiction"), /role\s+String/);
  assert.match(model("ClassificationInstitution"), /role\s+String/);
});

test("keeps typed decision telemetry separate from generative LLM telemetry", () => {
  const decisionCall = model("DecisionCall");
  assert.match(decisionCall, /decisionType\s+String/);
  assert.match(decisionCall, /requestFingerprint\s+String\?/);
  assert.match(decisionCall, /inputBytes\s+Int/);
  assert.match(decisionCall, /confidence\s+Float\?/);
  assert.match(decisionCall, /baselineValue\s+String\?/);
  assert.match(decisionCall, /shadowMode\s+Boolean\s+@default\(true\)/);
  assert.doesNotMatch(decisionCall, /prompt|state\s+String|apiKey/i);

  const migration = read("prisma/postgresql/migrations/20260920110000_classification_provenance_and_jev_calls/migration.sql");
  assert.match(migration, /CREATE TABLE "DecisionCall"/);
  assert.match(migration, /ALTER TABLE "ContentClassification"/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /ALTER TABLE "LlmCall"/);
});

test("keeps publisher, subject institution, and directional asset relations separate", () => {
  const article = model("Article");
  assert.match(article, /institutionId\s+String/);
  assert.match(article, /institution\s+Institution\s+@relation/);
  assert.match(article, /classification\s+ContentClassification\?/);
  assert.doesNotMatch(model("ContentClassification"), /institutionId/);
  assert.match(model("ClassificationAsset"), /asset\s+Asset\s+@relation/);
  assert.match(model("ArticleAsset"), /direction\s+Int/);
  assert.doesNotMatch(model("ClassificationAsset"), /direction/);
});

test("ships a PostgreSQL migration with unified targets and cascading facet rows", () => {
  const migration = read("prisma/postgresql/migrations/20260920090000_faceted_classification/migration.sql");
  for (const name of [
    "ContentClassification",
    "ClassificationJurisdiction",
    "ClassificationInstitution",
    "ClassificationTopic",
    "ClassificationAsset",
    "ClassificationAssetClass",
    "ClassificationEvent",
  ]) assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
  assert.match(migration, /REFERENCES "Article"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "MacroIndicator"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "MacroRelease"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "MacroPolicyDocument"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "Asset"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /ContentClassification_target_check/);
});
