import assert from "node:assert/strict";
import test from "node:test";
import beaFixture from "./fixtures/bea.json";
import blsFixture from "./fixtures/bls.json";
import eiaFixture from "./fixtures/eia.json";
import fredFixture from "./fixtures/fred.json";
import { createBeaProvider } from "./bea";
import { createBlsProvider } from "./bls";
import { createEiaProvider } from "./eia";
import { createFredProvider } from "./fred";
import { MacroProviderError, type FetchLike } from "./types";

const NOW = new Date("2026-08-29T12:00:00.000Z");
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});
const fixtureFetch = (fixture: unknown, inspect?: (url: string, init?: RequestInit) => void): FetchLike =>
  (async (input, init) => {
    inspect?.(String(input), init);
    return jsonResponse(fixture);
  }) as FetchLike;

test("BLS parses monthly fixture data without requiring an API key", async () => {
  let payload: Record<string, unknown> = {};
  const provider = createBlsProvider({
    apiKey: "",
    fetch: fixtureFetch(blsFixture, (_url, init) => { payload = JSON.parse(String(init?.body)); }),
    now: () => NOW,
    retries: 0,
    minIntervalMs: 0,
  });
  const rows = await provider.fetchSeries({ externalSeriesId: "CUSR0000SA0" });
  assert.equal(payload.registrationkey, undefined);
  assert.deepEqual(rows.map((row) => [row.period.toISOString().slice(0, 10), row.value, row.status]), [
    ["2026-02-01", "318.376", "PRELIMINARY"],
    ["2026-01-01", "317.671", "PUBLISHED"],
  ]);
});

test("BEA takes dataset, table, line and frequency from the registry", async () => {
  let requested = new URL("https://example.invalid");
  const provider = createBeaProvider({
    apiKey: "fixture-key",
    fetch: fixtureFetch(beaFixture, (url) => { requested = new URL(url); }),
    now: () => NOW,
    retries: 0,
    minIntervalMs: 0,
  });
  const rows = await provider.fetchSeries({ externalSeriesId: "NIPA:T20804:1" });
  assert.equal(requested.searchParams.get("datasetname"), "NIPA");
  assert.equal(requested.searchParams.get("TableName"), "T20804");
  assert.equal(requested.searchParams.get("Frequency"), "M");
  assert.deepEqual(rows.map((row) => [row.period.toISOString().slice(0, 10), row.value]), [
    ["2026-05-01", "126.742"],
    ["2026-06-01", "127.011"],
  ]);
});

test("FRED supports realtime bounds and drops official missing values", async () => {
  let requested = new URL("https://example.invalid");
  const provider = createFredProvider({
    apiKey: "fixture-key",
    fetch: fixtureFetch(fredFixture, (url) => { requested = new URL(url); }),
    now: () => NOW,
    retries: 0,
    minIntervalMs: 0,
  });
  const rows = await provider.fetchSeries({
    externalSeriesId: "PCEPI",
    realtimeStart: new Date("2026-07-01T00:00:00Z"),
    realtimeEnd: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(requested.searchParams.get("realtime_start"), "2026-07-01");
  assert.equal(requested.searchParams.get("realtime_end"), "2026-08-01");
  assert.deepEqual(rows.map((row) => [row.value, row.vintageAt.toISOString().slice(0, 10)]), [
    ["126.742", "2026-07-01"],
    ["127.011", "2026-08-01"],
  ]);
});

test("EIA v2 parses the configured weekly crude inventory series", async () => {
  let requested = new URL("https://example.invalid");
  const provider = createEiaProvider({
    apiKey: "fixture-key",
    fetch: fixtureFetch(eiaFixture, (url) => { requested = new URL(url); }),
    now: () => NOW,
    retries: 0,
    minIntervalMs: 0,
  });
  const rows = await provider.fetchSeries({ externalSeriesId: "WCESTUS1" });
  assert.match(requested.pathname, /\/v2\/petroleum\/stoc\/wstk\/data\/$/);
  assert.equal(requested.searchParams.get("facets[series][]"), "WCESTUS1");
  assert.deepEqual(rows.map((row) => row.value), ["421156", "419802"]);
});

test("provider HTTP errors retry without leaking API keys", async () => {
  let calls = 0;
  const provider = createFredProvider({
    apiKey: "super-secret-fixture-key",
    fetch: (async () => { calls++; return jsonResponse({}, 503); }) as FetchLike,
    retries: 1,
    minIntervalMs: 0,
    sleep: async () => undefined,
  });
  await assert.rejects(
    () => provider.fetchSeries({ externalSeriesId: "PCEPI" }),
    (error: unknown) => error instanceof MacroProviderError && error.code === "HTTP" && !error.message.includes("super-secret"),
  );
  assert.equal(calls, 2);
});
