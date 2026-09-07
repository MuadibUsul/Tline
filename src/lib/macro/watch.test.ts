import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isFreshReleaseObservation, releaseTargetPeriod, watchSchedule } from "./watch";
import type { MacroReleaseFamilyDefinition, NormalizedObservation } from "./types";

const family = (pollingStrategy: MacroReleaseFamilyDefinition["pollingStrategy"]): MacroReleaseFamilyDefinition => ({
  key: "TEST",
  titleEn: "Test",
  titleZh: "测试",
  agency: "TEST",
  countryCode: "US",
  normalTimezone: "America/New_York",
  indicators: [],
  importance: 1,
  pollingStrategy,
  calendar: { source: "BLS_ICS", sourceUrl: "https://example.com", aliases: [], defaultLocalTime: "08:30" },
});

const observation = (overrides: Partial<NormalizedObservation> = {}): NormalizedObservation => ({
  canonicalKey: "US_CPI_HEADLINE",
  provider: "bls",
  externalSeriesId: "CUSR0000SA0",
  period: new Date("2026-08-01T00:00:00Z"),
  value: "310.1",
  unit: "index",
  frequency: "MONTHLY",
  seasonalAdjustment: "SA",
  vintageAt: new Date("2026-09-11T12:31:00Z"),
  sourcePublishedAt: null,
  fetchedAt: new Date("2026-09-11T12:31:00Z"),
  sourceUrl: null,
  rawHash: null,
  status: "PUBLISHED",
  metadata: null,
  ...overrides,
});

test("watch cadence moves from idle through warmup, hot and bounded late retry", () => {
  const release = new Date("2026-09-11T12:30:00Z");
  const configured = family({ startMinutesBefore: 10, intervalSeconds: 60, stopMinutesAfter: 120 });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T11:59:00Z"), configured), { phase: "outside", intervalSeconds: null });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T12:05:00Z"), configured), { phase: "warmup", intervalSeconds: 300 });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T12:25:00Z"), configured), { phase: "hot", intervalSeconds: 60 });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T12:31:00Z"), configured), { phase: "late", intervalSeconds: 60 });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T14:31:00Z"), configured), { phase: "expired", intervalSeconds: null });
  assert.deepEqual(watchSchedule(release, new Date("2026-09-11T12:25:00Z"), family({})), { phase: "hot", intervalSeconds: 60 });
});

test("release families resolve exact target periods across calendar boundaries", () => {
  assert.equal(releaseTargetPeriod("BLS_CPI", new Date("2026-01-14T13:30:00Z"), "America/New_York", "bls:cpi").toISOString(), "2025-12-01T00:00:00.000Z");
  assert.equal(releaseTargetPeriod("BLS_JOLTS", new Date("2026-09-01T14:00:00Z"), "America/New_York", "bls:jolts").toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(releaseTargetPeriod("BEA_GDP", new Date("2026-01-29T13:30:00Z"), "America/New_York", "bea:gdp").toISOString(), "2025-10-01T00:00:00.000Z");
  assert.equal(releaseTargetPeriod("EIA_PETROLEUM_STATUS", new Date("2026-09-10T16:00:00Z"), "America/New_York", "eia:wpsr:2026-09-04").toISOString(), "2026-09-04T00:00:00.000Z");
});

test("freshness requires the target period and rejects an unchanged pre-release observation", () => {
  const target = new Date("2026-08-01T00:00:00Z");
  const release = new Date("2026-09-11T12:30:00Z");
  const old = { value: "310.1", fetchedAt: new Date("2026-09-11T12:00:00Z") };
  assert.equal(isFreshReleaseObservation(observation(), target, release, old), false);
  assert.equal(isFreshReleaseObservation(observation({ value: "310.2" }), target, release, old), true);
  assert.equal(isFreshReleaseObservation(observation({ period: new Date("2026-07-01T00:00:00Z") }), target, release, null), false);
  assert.equal(isFreshReleaseObservation(observation({ sourcePublishedAt: new Date("2026-09-10T00:00:00Z") }), target, release, null), false);
  assert.equal(isFreshReleaseObservation(observation({ sourcePublishedAt: new Date("2026-09-11T00:00:00Z") }), target, release, old), true);
});

test("the ten-second watcher makes no model call; analysis is its own slower task", () => {
  const watcher = readFileSync(new URL("./watch.ts", import.meta.url), "utf8");
  const scheduler = readFileSync(new URL("../../../scripts/macro-scheduler.mjs", import.meta.url), "utf8");
  // Generating a read-out from the polling path bills once per poll for as long as a
  // release stays unanalysed — a standing cost with no upper bound.
  assert.doesNotMatch(watcher, /generatePendingReleaseAnalyses/);
  assert.match(scheduler, /MACRO_RELEASE_WATCH_INTERVAL_MS", 10_000/);
  assert.match(scheduler, /MACRO_RELEASE_ANALYSIS_INTERVAL_MS/);
});

test("read-out generation backs off and gives up instead of retrying every pass", () => {
  const analysis = readFileSync(new URL("./releaseAnalysis.ts", import.meta.url), "utf8");
  assert.match(analysis, /MACRO_RELEASE_ANALYSIS_MAX_ATTEMPTS/);
  assert.match(analysis, /MACRO_RELEASE_ANALYSIS_BACKOFF_MS/);
  // The pending query matches on "analysis is missing", which is exactly the state a
  // failing release stays in, so the attempt record is what stops the loop.
  assert.match(analysis, /lastStatus === "exhausted"/);
});
