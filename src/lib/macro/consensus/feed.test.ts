import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarEvents, parseCalendarNumber } from "./feed";
import { convertToLevel, mappingFor, roundForUnit } from "./mapping";

const event = (over: Partial<{ title: string; forecast: number | null; percent: boolean; forecastRaw: string }> = {}) => ({
  title: over.title ?? "Crude Oil Inventories",
  country: "USD",
  at: new Date("2026-09-16T14:30:00.000Z"),
  forecast: over.forecast === undefined ? -1_600_000 : over.forecast,
  percent: over.percent ?? false,
  forecastRaw: over.forecastRaw ?? "-1.6M",
  previousRaw: "-0.4M",
});

test("forecast strings keep their magnitude and never read as zero", () => {
  assert.deepEqual(parseCalendarNumber("-1.6M"), { value: -1_600_000, percent: false });
  assert.deepEqual(parseCalendarNumber("75K"), { value: 75_000, percent: false });
  assert.deepEqual(parseCalendarNumber("4.00%"), { value: 4, percent: true });
  assert.deepEqual(parseCalendarNumber("0.0%"), { value: 0, percent: true });
  // "no forecast published" and "the market expects no change" are different statements.
  assert.equal(parseCalendarNumber(""), null);
  assert.equal(parseCalendarNumber(undefined), null);
  assert.equal(parseCalendarNumber("n/a"), null);
});

test("feed entries without an offset or a country are dropped, not guessed", () => {
  const events = parseCalendarEvents([
    { title: "Crude Oil Inventories", country: "USD", date: "2026-09-16T10:30:00-04:00", forecast: "-1.6M", previous: "-0.4M" },
    { title: "Crude Oil Inventories", country: "USD", date: "2026-09-16T10:30:00", forecast: "-1.6M" },
    { title: "GDP q/q", country: "NZD", date: "2026-09-16T22:45:00+12:00", forecast: "0.1%" },
    { title: "", country: "USD", date: "2026-09-16T10:30:00-04:00" },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].at.toISOString(), "2026-09-16T14:30:00.000Z");
  assert.equal(events[1].country, "NZD");
});

test("a barrel change becomes the level the market is positioned against", () => {
  const mapping = mappingFor("Crude Oil Inventories")!;
  const converted = convertToLevel(mapping, event(), 424069);
  assert.ok(!("error" in converted));
  assert.equal(converted.value, 422469);
  assert.equal(roundForUnit(converted.value, "THOUSANDS_OF_BARRELS"), 422469);
});

test("a percent change is applied to the previous index level", () => {
  const mapping = mappingFor("CPI m/m")!;
  const converted = convertToLevel(mapping, event({ title: "CPI m/m", forecast: 0.3, percent: true, forecastRaw: "0.3%" }), 320.123);
  assert.ok(!("error" in converted));
  assert.equal(roundForUnit(converted.value, "INDEX"), 321.083);
});

test("a rate is taken as published, and only when it carries a percent sign", () => {
  const mapping = mappingFor("Federal Funds Rate")!;
  const asPercent = convertToLevel(mapping, event({ title: "Federal Funds Rate", forecast: 4, percent: true, forecastRaw: "4.00%" }), 3.75);
  assert.ok(!("error" in asPercent));
  assert.equal(asPercent.value, 4);
  const bare = convertToLevel(mapping, event({ title: "Federal Funds Rate", forecast: 4, percent: false, forecastRaw: "4.00" }), 3.75);
  assert.ok("error" in bare);
});

test("a magnitude the feed states in millions is scaled, not trusted", () => {
  const jolts = mappingFor("JOLTS Job Openings")!;
  const converted = convertToLevel(jolts, event({ title: "JOLTS Job Openings", forecast: 7_100_000, forecastRaw: "7.10M" }), 7100);
  assert.ok(!("error" in converted));
  assert.equal(converted.value, 7100);
  // The same mapping against a level stated in thousands would be off by three orders of
  // magnitude, which is exactly what the plausibility guard is for.
  const wrong = convertToLevel(jolts, event({ title: "JOLTS Job Openings", forecast: 7100, forecastRaw: "7,100" }), 7100);
  assert.ok("error" in wrong);
});

test("a forecast with no previous level is refused rather than stored as a bare change", () => {
  const mapping = mappingFor("Crude Oil Inventories")!;
  assert.ok("error" in convertToLevel(mapping, event(), null));
});

test("unmapped calendar events are ignored", () => {
  assert.equal(mappingFor("Unemployment Claims"), null);
  assert.equal(mappingFor("Federal Funds Rate")?.canonicalKey, "US_FED_FUNDS_TARGET_UPPER");
  assert.deepEqual(mappingFor("Federal Funds Rate")?.companion, { canonicalKey: "US_FED_FUNDS_TARGET_LOWER", kind: "range_width" });
});
