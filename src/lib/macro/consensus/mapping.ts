import type { CalendarEvent } from "./feed";

/**
 * Which calendar event is the market consensus for which indicator, and how to read it.
 *
 * The calendar states most releases the way the market talks about them — a change in
 * barrels, a percent change on the month — while our indicators are levels in a fixed
 * unit. The conversion is therefore part of the mapping, and it is written down here
 * rather than inferred, because a wrong scale is a plausible-looking number:
 *
 *   delta    the forecast is a change, in units of `toIndicatorUnits` of the indicator's unit
 *   scaled   the forecast is a level in a different magnitude (millions where we store thousands)
 *   relative the forecast is a percent change to apply to the previous level
 *   level    the forecast is already the indicator's value (rates, annualised growth)
 *
 * `headline` is false for the second series of the same event (core CPI beside CPI) so the
 * mapping stays readable when both point at one release.
 */
export type Conversion =
  | { kind: "delta"; toIndicatorUnits: number }
  | { kind: "scaled"; toIndicatorUnits: number }
  | { kind: "relative" }
  | { kind: "level" };

export interface IndicatorMapping {
  title: string;
  canonicalKey: string;
  conversion: Conversion;
  /** A second indicator this event also settles, derived from the same print. */
  companion?: { canonicalKey: string; kind: "range_width" };
  /** Shown in the stored provenance, so a derived figure is never mistaken for a quoted one. */
  note: string;
}

export const FOREXFACTORY_INDICATORS: IndicatorMapping[] = [
  {
    title: "Crude Oil Inventories",
    canonicalKey: "US_EIA_CRUDE_INVENTORIES",
    conversion: { kind: "delta", toIndicatorUnits: 1 / 1_000 },
    note: "weekly change in million barrels applied to the previous week's level",
  },
  {
    title: "Non-Farm Employment Change",
    canonicalKey: "US_NFP",
    conversion: { kind: "delta", toIndicatorUnits: 1 / 1_000 },
    note: "monthly change in thousands applied to the previous level",
  },
  {
    title: "Unemployment Rate",
    canonicalKey: "US_UNEMPLOYMENT_RATE",
    conversion: { kind: "level" },
    note: "rate as published",
  },
  {
    title: "JOLTS Job Openings",
    canonicalKey: "US_JOLTS_OPENINGS",
    conversion: { kind: "scaled", toIndicatorUnits: 1 / 1_000 },
    note: "level in millions converted to thousands",
  },
  {
    title: "Federal Funds Rate",
    canonicalKey: "US_FED_FUNDS_TARGET_UPPER",
    conversion: { kind: "level" },
    companion: { canonicalKey: "US_FED_FUNDS_TARGET_LOWER", kind: "range_width" },
    note: "target range upper bound as published; the lower bound keeps the pre-release range width",
  },
  {
    title: "Advance GDP q/q",
    canonicalKey: "US_GDP",
    conversion: { kind: "level" },
    note: "annualised percent change as published",
  },
  {
    title: "Prelim GDP q/q",
    canonicalKey: "US_GDP",
    conversion: { kind: "level" },
    note: "annualised percent change as published",
  },
  {
    title: "Final GDP q/q",
    canonicalKey: "US_GDP",
    conversion: { kind: "level" },
    note: "annualised percent change as published",
  },
  {
    title: "CPI m/m",
    canonicalKey: "US_CPI_HEADLINE",
    conversion: { kind: "relative" },
    note: "month-on-month percent applied to the previous index level",
  },
  {
    title: "Core CPI m/m",
    canonicalKey: "US_CPI_CORE",
    conversion: { kind: "relative" },
    note: "month-on-month percent applied to the previous index level",
  },
  {
    title: "PPI m/m",
    canonicalKey: "US_PPI",
    conversion: { kind: "relative" },
    note: "month-on-month percent applied to the previous index level",
  },
  {
    title: "Core PCE Price Index m/m",
    canonicalKey: "US_CORE_PCE_PRICE",
    conversion: { kind: "relative" },
    note: "month-on-month percent applied to the previous index level",
  },
];

export function mappingFor(title: string): IndicatorMapping | null {
  return FOREXFACTORY_INDICATORS.find((mapping) => mapping.title === title) ?? null;
}

/**
 * A converted level is only trusted when it stands next to the previous one.
 *
 * Every failure this guards against looks like a number: a magnitude the feed states in
 * millions where the indicator is in thousands, a percent read as a level. Inventories and
 * job openings move by a few percent a month, so anything further than a quarter away from
 * the previous level is a unit error, not a forecast.
 */
const MAX_LEVEL_DISPLACEMENT = 0.25;

export type ConversionResult = { value: number; derived: string } | { error: string };

export function convertToLevel(mapping: IndicatorMapping, event: CalendarEvent, previousLevel: number | null): ConversionResult {
  if (event.forecast === null) return { error: "no forecast published" };
  const conversion = mapping.conversion;
  if (conversion.kind === "level") {
    // A rate stated in percent must carry the percent sign; without it "4.00" could be a
    // level, a change or a basis-point count.
    if (!event.percent) return { error: "expected a percentage" };
    return { value: event.forecast, derived: `as published (${event.forecastRaw})` };
  }
  if (previousLevel === null) return { error: "no previous level to derive from" };
  if (!Number.isFinite(previousLevel)) return { error: "previous level is not a number" };
  const value = conversion.kind === "delta"
    ? previousLevel + event.forecast * conversion.toIndicatorUnits
    : conversion.kind === "scaled"
      ? event.forecast * conversion.toIndicatorUnits
      : previousLevel * (1 + event.forecast / 100);
  if (conversion.kind !== "relative" && Math.abs(value - previousLevel) > Math.abs(previousLevel) * MAX_LEVEL_DISPLACEMENT) {
    return { error: `derived level ${value} is implausible against previous ${previousLevel}` };
  }
  const how = conversion.kind === "delta" ? `${previousLevel} + ${event.forecastRaw}` : conversion.kind === "scaled" ? `${event.forecastRaw}` : `${previousLevel} × (1 + ${event.forecastRaw})`;
  return { value, derived: `${mapping.note}: ${how}` };
}

/**
 * An expectation has to be representable in the indicator's own decimal form. Rates and
 * index levels are published at fixed precision, and the derivation above can leave more
 * digits than either side of the comparison carries.
 */
export function roundForUnit(value: number, unit: string): number {
  const decimals = unit === "PERCENT" ? 2 : unit === "INDEX" ? 3 : 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
