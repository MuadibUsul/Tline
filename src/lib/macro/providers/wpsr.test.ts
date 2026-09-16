import assert from "node:assert/strict";
import test from "node:test";
import { getMacroSources } from "../registry";
import { createWpsrProvider } from "./wpsr";
import type { FetchLike } from "./types";

const NOW = new Date("2026-09-16T14:31:00.000Z");
const CSV = [
  '"STUB_1","9/11/26","9/4/26","Difference","Percent Change","9/12/25","Difference","Percent Change"',
  '"Crude Oil","708.386","709.429","-1.043","-0.100","821.089","-112.703","-13.700"',
  '"Commercial (Excluding SPR)","423.429","424.069","-0.640","-0.200","415.361","8.068","1.900"',
  '"Strategic Petroleum Reserve (SPR)","284.957","285.360","-0.403","-0.100","405.728","-120.771","-29.800"',
].join("\r\n");

const csvFetch = (body: string, status = 200): FetchLike => (async () => new Response(body, {
  status,
  headers: { "content-type": "text/csv" },
})) as FetchLike;

const provider = (fetchImpl: FetchLike) => createWpsrProvider({ fetch: fetchImpl, now: () => NOW, retries: 0, minIntervalMs: 0 });

test("wpsr provider reads the print-time crude stocks row from the official CSV", async () => {
  const rows = await provider(csvFetch(CSV)).fetchSeries({ externalSeriesId: "wpsr.table1.crude-stocks" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.period.toISOString(), "2026-09-11T00:00:00.000Z");
  assert.equal(row.value, "423429"); // 423.429 million barrels, scaled to the thousand-barrel unit
  assert.equal(row.status, "PUBLISHED");
  assert.equal(row.unit, "THOUSANDS_OF_BARRELS");
  assert.equal(row.canonicalKey, "US_EIA_CRUDE_INVENTORIES");
  assert.ok(row.sourcePublishedAt);
});

test("wpsr provider ignores requests for other series and unrelated rows", async () => {
  const rows = await provider(csvFetch(CSV)).fetchSeries({ externalSeriesId: "WCESTUS1" });
  assert.deepEqual(rows, []);
});

test("the gated window before publication returns nothing, not an error", async () => {
  for (const status of [403, 404]) {
    const rows = await provider(csvFetch("", status)).fetchSeries({ externalSeriesId: "wpsr.table1.crude-stocks" });
    assert.deepEqual(rows, []);
  }
});

test("a changed or damaged CSV shape fails soft, leaving the API source to capture", async () => {
  const noDate = '"STUB_1","not a date","9/4/26"\n"Commercial (Excluding SPR)","423.429","424.069"';
  assert.deepEqual(await provider(csvFetch(noDate)).fetchSeries({ externalSeriesId: "wpsr.table1.crude-stocks" }), []);
  const notNumeric = '"STUB_1","9/11/26","9/4/26"\n"Commercial (Excluding SPR)","N/A","424.069"';
  assert.deepEqual(await provider(csvFetch(notNumeric)).fetchSeries({ externalSeriesId: "wpsr.table1.crude-stocks" }), []);
  const empty = await provider(csvFetch("")).fetchSeries({ externalSeriesId: "wpsr.table1.crude-stocks" });
  assert.deepEqual(empty, []);
});

test("the hourly provider sync does not churn the release file", async () => {
  const rows = await provider(csvFetch(CSV)).fetchLatest!({ externalSeriesId: "wpsr.table1.crude-stocks" });
  assert.deepEqual(rows, []);
});

test("the print-time CSV source is tried before the EIA API source", () => {
  const sources = getMacroSources("US_EIA_CRUDE_INVENTORIES");
  assert.deepEqual(sources.map((source) => `${source.provider}:${source.priority}`), ["eia-wpsr:5", "eia:10"]);
});
