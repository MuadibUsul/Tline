import assert from "node:assert/strict";
import test from "node:test";
import { getMacroReleaseFamily, getMacroSources } from "./registry";
import { localTimeToUtc, normalizeDecimal, normalizeObservation, normalizePeriod, rawHash } from "./normalize";
import { persistNormalizedObservation, type ObservationRepository } from "./store";
import { decideRevision, type StoredObservationRevision } from "./revisions";
import type { NormalizedObservation } from "./types";

type Insert = Parameters<ObservationRepository["createObservation"]>[0];
type Row = StoredObservationRevision & { seriesSourceId: string; period: Date };

class MemoryRepository implements ObservationRepository {
  rows: Row[] = [];
  private sequence = 0;
  private sources = new Map([
    ["bls:CUSR0000SA0", { id: "bls-cpi", canonicalKey: "US_CPI_HEADLINE" }],
    ["fred:CPIAUCSL", { id: "fred-cpi", canonicalKey: "US_CPI_HEADLINE" }],
  ]);

  async findSource(provider: string, externalSeriesId: string) {
    return this.sources.get(`${provider}:${externalSeriesId}`) ?? null;
  }

  async listHistory(seriesSourceId: string, period: Date) {
    return this.rows.filter((row) => row.seriesSourceId === seriesSourceId && row.period.getTime() === period.getTime());
  }

  async createObservation(data: Insert) {
    const id = `observation-${++this.sequence}`;
    this.rows.push({
      id,
      seriesSourceId: data.seriesSourceId,
      period: data.period,
      value: data.value.toString(),
      status: data.status,
      vintageAt: data.vintageAt,
      revisionNo: data.revisionNo,
      isInitial: data.isInitial,
    });
    return { id };
  }
}

function observation(provider: "bls" | "fred", value: string, vintageAt: string): NormalizedObservation {
  const externalSeriesId = provider === "bls" ? "CUSR0000SA0" : "CPIAUCSL";
  const normalized = normalizeObservation({
    provider,
    externalSeriesId,
    period: "2026-07",
    value,
    vintageAt,
    fetchedAt: `${vintageAt}T14:00:00Z`,
    raw: { value, vintageAt },
  });
  assert.ok(normalized);
  return normalized;
}

test("registry maps multiple providers to one canonical indicator", () => {
  assert.deepEqual(getMacroSources("US_CPI_HEADLINE").map((source) => source.provider), ["bls", "fred"]);
  assert.deepEqual(getMacroReleaseFamily("BLS_CPI")?.indicators, ["US_CPI_HEADLINE", "US_CPI_CORE"]);
});

test("normalization preserves decimal precision and rejects lossy numbers", () => {
  assert.equal(normalizeDecimal("-"), null);
  assert.equal(normalizeDecimal("12,345,678,901,234,567,890.1234500"), "12345678901234567890.12345");
  assert.equal(normalizeDecimal("0.000000000000000000000000000001"), "1e-30");
  assert.equal(normalizeDecimal("."), null);
  assert.equal(normalizeDecimal(null), null);
  assert.throws(() => normalizeDecimal(1.25), /source string/);

  const normalized = observation("bls", "314.1234500", "2026-08-12");
  assert.equal(normalized.value, "314.12345");
  assert.equal(normalized.period.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(normalized.unit, "INDEX");
  assert.equal(normalizeObservation({
    provider: "bea",
    externalSeriesId: "NIPA:T20600:1",
    period: "2026-07",
    value: "27,114,792",
    vintageAt: "2026-08-29",
    fetchedAt: "2026-08-29",
  })?.value, "27114.792");
  assert.equal(normalizeObservation({
    provider: "bls",
    externalSeriesId: "CUSR0000SA0",
    period: "2026-07",
    value: "N/A",
    vintageAt: "2026-08-12",
    fetchedAt: "2026-08-12T14:00:00Z",
  }), null);
  assert.equal(rawHash({ b: 2, a: 1 }), rawHash({ a: 1, b: 2 }));
});

test("UTC helpers handle frequency periods and daylight saving time", () => {
  assert.equal(normalizePeriod("2026-Q3", "QUARTERLY").toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(localTimeToUtc("2026-01-15T08:30", "America/New_York").toISOString(), "2026-01-15T13:30:00.000Z");
  assert.equal(localTimeToUtc("2026-07-15T08:30", "America/New_York").toISOString(), "2026-07-15T12:30:00.000Z");
  assert.throws(() => localTimeToUtc("2026-03-08T02:30", "America/New_York"), /does not exist/);
});

test("observation storage is idempotent and appends real revisions", async () => {
  const repository = new MemoryRepository();
  const initial = await persistNormalizedObservation(repository, observation("bls", "314.1", "2026-08-12"));
  const repeated = await persistNormalizedObservation(repository, observation("bls", "314.100", "2026-08-13"));
  const revised = await persistNormalizedObservation(repository, observation("bls", "314.2", "2026-09-10"));
  const third = await persistNormalizedObservation(repository, observation("bls", "314.25", "2026-10-10"));

  assert.deepEqual(initial, { status: "inserted", id: "observation-1", revisionNo: 0, isInitial: true });
  assert.deepEqual(repeated, { status: "unchanged", id: "observation-1", revisionNo: 0, isInitial: true });
  assert.equal(revised.revisionNo, 1);
  assert.equal(revised.isInitial, false);
  assert.equal(third.revisionNo, 2);
  assert.deepEqual(repository.rows.map((row) => row.value), ["314.1", "314.2", "314.25"]);
});

test("an older provider snapshot with the same value is idempotent", () => {
  const latest = { id: "latest", value: "4.1", status: "PUBLISHED", vintageAt: new Date("2026-08-15"), revisionNo: 0, isInitial: true };
  assert.deepEqual(decideRevision([latest], { value: "4.10", status: "PUBLISHED", vintageAt: new Date("2026-08-08") }), { action: "unchanged", existing: latest });
  assert.throws(() => decideRevision([latest], { value: "4.2", status: "PUBLISHED", vintageAt: new Date("2026-08-08") }), /vintage regressed/);
});

test("different providers retain independent vintages for one indicator", async () => {
  const repository = new MemoryRepository();
  const primary = await persistNormalizedObservation(repository, observation("bls", "314.1", "2026-08-12"));
  const fallback = await persistNormalizedObservation(repository, observation("fred", "314.1", "2026-08-12"));
  assert.equal(primary.revisionNo, 0);
  assert.equal(fallback.revisionNo, 0);
  assert.equal(repository.rows.length, 2);
  assert.deepEqual(new Set(repository.rows.map((row) => row.seriesSourceId)), new Set(["bls-cpi", "fred-cpi"]));
});
