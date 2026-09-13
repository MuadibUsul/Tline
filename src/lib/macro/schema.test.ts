import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");
const sqlite = read("prisma/schema.prisma");

function model(name: string) {
  const match = sqlite.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing Prisma model ${name}`);
  return match[1];
}

test("defines the independent Macro Intelligence schema", () => {
  for (const name of [
    "MacroIndicator",
    "MacroSeriesSource",
    "MacroObservation",
    "MacroRelease",
    "MacroReleaseValue",
    "MacroPolicyDocument",
    "MacroSyncState",
    "MarketInstrument",
    "MarketObservation",
    "MacroSignalSnapshot",
    "MacroExpectation",
    "MarketInstrumentSource",
    "DataLicensePolicy",
    "ProviderUsage",
    "TradingThemeSnapshot",
  ]) model(name);

  assert.match(model("PriceObservation"), /value\s+Float/);
  assert.doesNotMatch(model("PriceObservation"), /Macro/);
  assert.doesNotMatch(model("PriceObservation"), /provider|interval|quoteCurrency/);
});

test("keeps macro values decimal-safe and vintages unique", () => {
  const observation = model("MacroObservation");
  const releaseValue = model("MacroReleaseValue");
  const policyDocument = model("MacroPolicyDocument");
  assert.match(observation, /value\s+Decimal/);
  assert.match(observation, /@@unique\(\[seriesSourceId, period, vintageAt\]\)/);
  assert.match(observation, /@@unique\(\[seriesSourceId, period, revisionNo\]\)/);
  for (const field of ["actualInitial", "previousAtRelease", "revisedPreviousAtRelease", "consensusAtRelease", "surpriseRaw", "surprisePct"]) {
    assert.match(releaseValue, new RegExp(`${field}\\s+Decimal\\?`));
  }
  assert.match(policyDocument, /@@unique\(\[sourceUrl, contentHash\]\)/);
  assert.doesNotMatch(sqlite, /^\s+\w+\s+Json\??(?:\s|$)|^enum\s/m);
});

test("generated PostgreSQL schema and migration match the canonical schema", () => {
  const postgres = read("prisma/postgresql/schema.prisma").trimEnd();
  const generated = sqlite
    .replace("// Institutional Intelligence — Phase 1 schema (SQLite dev).", "// Generated from ../schema.prisma. Do not edit directly.")
    .replace('provider = "sqlite"', 'provider = "postgresql"')
    .trimEnd();
  assert.equal(postgres, generated);

  const migration = read("prisma/postgresql/migrations/20260829000000_macro_intelligence/migration.sql");
  assert.match(migration, /CREATE TABLE "MacroObservation"/);
  assert.match(migration, /"value" DECIMAL\(65,30\) NOT NULL/);
  assert.doesNotMatch(migration, /"(?:value|actualInitial|consensusAtRelease)" DOUBLE PRECISION/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /ON DELETE SET NULL/);
  const dataLoop = read("prisma/postgresql/migrations/20260913180000_market_macro_data_loop/migration.sql");
  for (const table of ["MacroExpectation", "MarketInstrumentSource", "DataLicensePolicy", "ProviderUsage", "TradingThemeSnapshot"]) assert.match(dataLoop, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(dataLoop, /"licenseKey" TEXT/);
  assert.match(dataLoop, /"value" DECIMAL\(65,30\) NOT NULL/);
});
