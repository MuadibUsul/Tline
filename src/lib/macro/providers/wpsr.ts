import { normalizeObservation } from "../normalize";
import type { MacroSeriesRequest, NormalizedObservation } from "../types";
import { MacroProviderError, type OfficialMacroProvider, type ProviderOptions } from "./types";

const CSV_URL = "https://ir.eia.gov/wpsr/table1.csv";
const SERIES_ID = "wpsr.table1.crude-stocks";
const CRUDE_ROW = "Commercial (Excluding SPR)";

/**
 * The Weekly Petroleum Status Report's print-time numbers.
 *
 * At exactly 10:30 a.m. ET on release day EIA opens a time-gated, keyless CSV at
 * ir.eia.gov/wpsr/table1.csv (CloudFront-signed, unreachable before the window). The same
 * numbers land in the EIA data API (series WCESTUS1) only later — hours later, in
 * practice. Reading the CSV lets the release watcher capture the print at publication
 * time instead of trailing the API.
 *
 * The CSV's "Commercial (Excluding SPR)" row is the exact WCESTUS1 measure in million
 * barrels; sources.json scales it by 1000 so observations match the API's thousand-barrel
 * unit. Every failure here is soft (empty rows), because the API source behind it in
 * priority order is the fallback that must keep working when the CSV is unavailable or
 * changes shape.
 */

function parseUsDate(value: string | undefined): Date | null {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const shortYear = Number(match[3]);
  const year = shortYear < 100 ? 2000 + shortYear : shortYear;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') { current += '"'; index++; }
        else inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current); current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

export function createWpsrProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const fetchSeries = async (request: MacroSeriesRequest): Promise<NormalizedObservation[]> => {
    if (request.externalSeriesId !== SERIES_ID) return [];
    const response = await fetchImpl(CSV_URL, {
      headers: { accept: "text/csv", "user-agent": "TlineMacroIntelligence/0.1 (+official economic data client)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Outside the release window the file is gated (403) or not present (404); before
    // the 10:30 a.m. print there is simply nothing to capture yet.
    if (response.status === 403 || response.status === 404) return [];
    if (!response.ok) throw new MacroProviderError("eia-wpsr", "HTTP", `WPSR CSV request failed with ${response.status}.`, response.status, true);
    const csv = await response.text();
    const lines = csv.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    const weekEnding = parseUsDate(header[1]);
    if (!weekEnding) return [];
    const fetchedAt = now();
    for (const line of lines.slice(1)) {
      const fields = parseCsvLine(line);
      if (fields[0] !== CRUDE_ROW) continue;
      if (!NUMERIC.test(fields[1])) return [];
      const observation = normalizeObservation({
        provider: "eia-wpsr",
        externalSeriesId: SERIES_ID,
        period: weekEnding,
        value: fields[1],
        vintageAt: fetchedAt,
        fetchedAt,
        // Stamped so the watcher accepts the print even on a zero-change week, when
        // the value alone would be indistinguishable from the previous observation.
        sourcePublishedAt: fetchedAt,
        status: "PUBLISHED",
        raw: csv,
      });
      return observation ? [observation] : [];
    }
    return [];
  };

  return {
    id: "eia-wpsr",
    fetchSeries,
    // The hourly provider sync stores this file's row for no one: the watcher is the
    // only consumer that matters, and it polls the CSV directly at release time.
    fetchLatest: async () => [],
    healthCheck: async () => { await fetchSeries({ externalSeriesId: SERIES_ID }); },
  };
}
