import assert from "node:assert/strict";
import test from "node:test";
import { getMacroSources } from "../registry";
import { createFomcStatementProvider, parseFedRate, parseTargetRange, LOWER_SERIES, UPPER_SERIES } from "./fomc";
import type { FetchLike } from "./types";

const NOW = new Date("2026-09-16T18:02:00.000Z");
const STATEMENT = `<html><body><div>Release Date: September 16, 2026</div><p>Recent indicators suggest that economic
activity has been expanding at a moderate pace. The Committee decided to raise the target range for the federal funds
rate by 1/4 percentage point to 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate.</p>
<script>var x = "target range at 9 to 9 percent";</script></body></html>`;
const NOTE = `<html><body><p>The Board of Governors of the Federal Reserve System voted unanimously to raise the
target range of 3-3/4 to 4 percent.</p></body></html>`;

const htmlFetch = (routes: Record<string, string>): FetchLike => (async (input) => {
  const url = String(input);
  const body = routes[url];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 });
}) as FetchLike;

const provider = (fetchImpl: FetchLike) => createFomcStatementProvider({ fetch: fetchImpl, now: () => NOW, retries: 0, minIntervalMs: 0 });
const STATEMENT_URL = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm";
const NOTE_URL = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a1.htm";

test("the Fed's fraction notation reads as the rate it denotes", () => {
  assert.equal(parseFedRate("4"), 4);
  assert.equal(parseFedRate("3-3/4"), 3.75);
  assert.equal(parseFedRate("4-1/4"), 4.25);
  assert.equal(parseFedRate("4-1/2"), 4.5);
  assert.equal(parseFedRate("1/4"), 0.25);
  assert.equal(parseFedRate("3.25"), 3.25);
  assert.equal(parseFedRate("nonsense"), null);
});

test("a range is read whether the Committee moved or held", () => {
  assert.deepEqual(parseTargetRange("decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent, in support"), { lower: 3.75, upper: 4 });
  assert.deepEqual(parseTargetRange("decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent."), { lower: 3.75, upper: 4 });
  assert.deepEqual(parseTargetRange("target range for the federal funds rate at 0 to 1/4 percent."), { lower: 0, upper: 0.25 });
  assert.equal(parseTargetRange("no range stated here"), null);
});

test("both bounds are captured at the announcement, in the indicator's unit", async () => {
  const upper = await provider(htmlFetch({ [STATEMENT_URL]: STATEMENT })).fetchSeries({ externalSeriesId: UPPER_SERIES, to: new Date("2026-09-16T00:00:00.000Z") });
  const lower = await provider(htmlFetch({ [STATEMENT_URL]: STATEMENT })).fetchSeries({ externalSeriesId: LOWER_SERIES, to: new Date("2026-09-16T00:00:00.000Z") });
  assert.deepEqual(upper.map((row) => [row.period.toISOString().slice(0, 10), row.value, row.unit, row.status]), [["2026-09-16", "4", "PERCENT", "PUBLISHED"]]);
  assert.equal(lower[0].value, "3.75");
  assert.equal(upper[0].canonicalKey, "US_FED_FUNDS_TARGET_UPPER");
  assert.equal(lower[0].canonicalKey, "US_FED_FUNDS_TARGET_LOWER");
  // Dated with the announcement, so the watcher accepts it inside the release window.
  assert.equal(upper[0].sourcePublishedAt?.toISOString(), NOW.toISOString());
});

test("the implementation note carries the range when the statement phrasing changes", async () => {
  const rows = await provider(htmlFetch({ [NOTE_URL]: NOTE })).fetchSeries({ externalSeriesId: UPPER_SERIES, to: new Date("2026-09-16T00:00:00.000Z") });
  assert.equal(rows[0].value, "4");
});

test("an absent or unreadable statement captures nothing and leaves FRED to it", async () => {
  const rows = await provider(htmlFetch({})).fetchSeries({ externalSeriesId: UPPER_SERIES, to: new Date("2026-09-16T00:00:00.000Z") });
  assert.deepEqual(rows, []);
  const garbled = await provider(htmlFetch({ [STATEMENT_URL]: "<html><body><p>no numbers at all</p></body></html>" })).fetchSeries({ externalSeriesId: UPPER_SERIES, to: new Date("2026-09-16T00:00:00.000Z") });
  assert.deepEqual(garbled, []);
});

test("the statement source is tried before the FRED series for both bounds", () => {
  for (const key of ["US_FED_FUNDS_TARGET_UPPER", "US_FED_FUNDS_TARGET_LOWER"]) {
    const sources = getMacroSources(key);
    assert.equal(sources[0].provider, "fomc-statement", `${key} should read the statement first`);
    assert.ok(sources.some((source) => source.provider === "fred"), `${key} keeps FRED as the fallback`);
  }
});
