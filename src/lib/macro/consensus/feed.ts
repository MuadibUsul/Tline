import { createJsonClient, type ProviderOptions } from "../providers/types";

/**
 * The public economic calendar feed.
 *
 * Weekly JSON files that carry, for each scheduled release, the consensus forecast the
 * market is positioned against. They are the distribution files the calendar publishes
 * for automated consumption — deliberately not a scrape of the calendar page, which is
 * bot-protected and whose terms forbid automated access. Files refresh roughly hourly and
 * the publisher asks for no more than two downloads per file per five minutes, which the
 * half-hourly sync stays well inside.
 */
const WEEK_FILES = [
  // The publisher serves the current week only; a next-week file returns 404. Events for
  // the following week appear here as it rolls over, which is early enough for a release
  // nobody needs a consensus for a fortnight ahead.
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
];

export const CALENDAR_SOURCE_URL = "https://www.forexfactory.com/calendar";

export interface CalendarEvent {
  title: string;
  country: string;
  /** Absolute instant. The feed's timestamps carry an offset; a bare local time is rejected. */
  at: Date;
  /** The forecast in its own magnitude: "-1.6M" is -1_600_000, "4.00%" is 4. */
  forecast: number | null;
  percent: boolean;
  forecastRaw: string;
  /** The feed's own previous value, kept as provenance for the derivation. */
  previousRaw: string;
}

const NUMBER = /^(-?\d+(?:\.\d+)?)\s*([KMB])?%?$/;

/**
 * One forecast string to a number in its base unit.
 *
 * The feed mixes magnitudes freely — barrels come as "-1.6M", payrolls as "75K", rates as
 * "4.00%" — so the suffix decides the scale and the caller decides what the resulting
 * number means. An empty or unparseable field is null, never zero: "no forecast published"
 * and "the market expects no change" are different statements.
 */
export function parseCalendarNumber(raw: string | undefined): { value: number; percent: boolean } | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const percent = text.endsWith("%");
  const match = text.replace(/%$/, "").match(NUMBER);
  if (!match) return null;
  const magnitude = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2] as "K" | "M" | "B"] ?? 1;
  return { value: Number(match[1]) * magnitude, percent };
}

export function parseCalendarEvents(payload: unknown): CalendarEvent[] {
  if (!Array.isArray(payload)) return [];
  const events: CalendarEvent[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { title?: unknown; country?: unknown; date?: unknown; forecast?: unknown; previous?: unknown };
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const country = typeof row.country === "string" ? row.country.trim().toUpperCase() : "";
    const date = typeof row.date === "string" ? row.date.trim() : "";
    if (!title || !country || !date) continue;
    // A timestamp without an offset cannot be placed in time, and guessing the zone is how
    // a release ends up matched to the wrong hour.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date)) continue;
    const at = new Date(date);
    if (Number.isNaN(at.getTime())) continue;
    const forecastRaw = typeof row.forecast === "string" ? row.forecast.trim() : "";
    const parsed = parseCalendarNumber(forecastRaw);
    events.push({
      title, country, at,
      forecast: parsed?.value ?? null,
      percent: parsed?.percent ?? false,
      forecastRaw,
      previousRaw: typeof row.previous === "string" ? row.previous.trim() : "",
    });
  }
  return events;
}

export async function fetchCalendarEvents(options: ProviderOptions = {}): Promise<CalendarEvent[]> {
  const requestJson = createJsonClient("forexfactory", { minIntervalMs: 250, timeoutMs: 20_000, ...options });
  const events: CalendarEvent[] = [];
  for (const url of WEEK_FILES) {
    try {
      events.push(...parseCalendarEvents(await requestJson<unknown>(url)));
    } catch (error) {
      // One file failing must not lose the other: the current week carries the releases
      // that are about to print, which is the half that matters.
      console.error(JSON.stringify({ event: "macro.consensus.feed.failed", url, error: String(error).slice(0, 300) }));
    }
  }
  return events;
}
