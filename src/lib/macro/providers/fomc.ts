import * as cheerio from "cheerio";
import { normalizeObservation } from "../normalize";
import type { MacroSeriesRequest, NormalizedObservation } from "../types";
import { MacroProviderError, type OfficialMacroProvider, type ProviderOptions } from "./types";

/**
 * The policy rate as the FOMC announces it.
 *
 * The FRED series for the target range lags the announcement by hours — on the day of a
 * decision the daily value is still yesterday's — so a release watched only through it
 * sits in WAITING while every other venue already has the number, and the read-out, the
 * alert and the review card all wait with it. The statement itself is published at the
 * announcement minute and states the range in words, which is enough to record both
 * bounds at once.
 *
 * Failures are soft: an unparseable or absent statement returns nothing and the FRED
 * source behind it in priority order still captures the release.
 */
const FED_ORIGIN = "https://www.federalreserve.gov";

export const UPPER_SERIES = "target-range.upper";
export const LOWER_SERIES = "target-range.lower";

/**
 * The Fed writes rates as fractions — "3-3/4" is 3.75, "4-1/4" is 4.25, and a range that
 * includes the zero bound reads "0 to 1/4 percent". Decimals appear too, in older
 * statements, so all three forms are accepted.
 */
export function parseFedRate(text: string): number | null {
  const value = text.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const mixed = value.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixed && Number(mixed[3]) !== 0) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  return null;
}

export function parseTargetRange(text: string): { lower: number; upper: number } | null {
  // "…the target range for the federal funds rate at 3-3/4 to 4 percent" when holding,
  // "…by 1/4 percentage point to 3-3/4 to 4 percent" when moving, and "…the target range
  // of 3-3/4 to 4 percent" in the implementation note: the range follows one of three
  // prepositions, so all three are accepted.
  const match = text.match(/target range[^.]{0,160}?\b(?:at|to|of)\s+([\d./-]+)\s+to\s+([\d./-]+)\s+percent/i);
  if (!match) return null;
  const lower = parseFedRate(match[1]);
  const upper = parseFedRate(match[2]);
  if (lower === null || upper === null || lower > upper) return null;
  return { lower, upper };
}

function statementUrls(day: Date) {
  const stamp = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  return [
    `${FED_ORIGIN}/newsevents/pressreleases/monetary${stamp}a.htm`,
    // The implementation note repeats the range in a single sentence, which survives a
    // rewording of the statement.
    `${FED_ORIGIN}/newsevents/pressreleases/monetary${stamp}a1.htm`,
  ];
}

function plainText(html: string) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body").text().replace(/\s+/g, " ");
}

export function createFomcStatementProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  const fetchSeries = async (request: MacroSeriesRequest): Promise<NormalizedObservation[]> => {
    const bound = request.externalSeriesId === UPPER_SERIES ? "upper" : request.externalSeriesId === LOWER_SERIES ? "lower" : null;
    if (!bound) return [];
    // The statement is dated with the announcement day, which is the release date the
    // watcher passes in as the target period.
    const day = request.to ?? request.from;
    if (!day) return [];
    const fetchedAt = now();
    let range: { lower: number; upper: number } | null = null;
    let sourceUrl: string | null = null;
    for (const url of statementUrls(day)) {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: "text/html", "user-agent": "TlineMacroIntelligence/0.1 (+official policy statement client)" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 404) continue;
        if (!response.ok) throw new MacroProviderError("fomc-statement", "HTTP", `FOMC statement request failed with ${response.status}.`, response.status, true);
        range = parseTargetRange(plainText(await response.text()));
        if (range) { sourceUrl = url; break; }
      } catch (error) {
        if (error instanceof MacroProviderError) throw error;
        console.error(JSON.stringify({ event: "macro.fomc.statement.failed", url, error: String(error).slice(0, 300) }));
      }
    }
    if (!range || !sourceUrl) return [];
    const observation = normalizeObservation({
      provider: "fomc-statement",
      externalSeriesId: request.externalSeriesId,
      period: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())),
      // Decimal strings, not numbers: the normalizer refuses fractional numeric input so a
      // value's precision is always explicit at the boundary.
      value: bound === "upper" ? String(range.upper) : String(range.lower),
      vintageAt: fetchedAt,
      fetchedAt,
      sourcePublishedAt: fetchedAt,
      status: "PUBLISHED",
      metadata: { statementUrl: sourceUrl, range: `${range.lower} to ${range.upper}` },
      raw: `${sourceUrl} ${range.lower}-${range.upper}`,
    });
    return observation ? [observation] : [];
  };

  return {
    id: "fomc-statement",
    fetchSeries,
    // The hourly provider sync stores nothing here: the watcher reads the statement at the
    // announcement minute, which is the only moment it carries new information.
    fetchLatest: async () => [],
    healthCheck: async () => { await fetchSeries({ externalSeriesId: UPPER_SERIES, to: new Date() }); },
  };
}
