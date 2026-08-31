import { normalizeObservation } from "../normalize";
import type { MacroSeriesRequest } from "../types";
import { createJsonClient, isoDate, MacroProviderError, requireApiKey, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const HEALTH_SERIES = "CPIAUCSL";

interface FredResponse {
  observations?: Array<{ realtime_start?: string; realtime_end?: string; date?: string; value?: string }>;
}

export function createFredProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestJson = createJsonClient("fred", options);
  const now = options.now ?? (() => new Date());

  const fetchSeries = async (request: MacroSeriesRequest) => {
    const apiKey = requireApiKey("fred", options.apiKey ?? process.env.FRED_API_KEY);
    const fetchedAt = now();
    const url = new URL(ENDPOINT);
    url.searchParams.set("series_id", request.externalSeriesId);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "asc");
    if (request.from) url.searchParams.set("observation_start", isoDate(request.from));
    if (request.to) url.searchParams.set("observation_end", isoDate(request.to));
    if (request.realtimeStart) url.searchParams.set("realtime_start", isoDate(request.realtimeStart));
    if (request.realtimeEnd) url.searchParams.set("realtime_end", isoDate(request.realtimeEnd));
    if (request.realtimeStart || request.realtimeEnd) url.searchParams.set("output_type", "4");
    const body = await requestJson<FredResponse>(url.href);
    if (!Array.isArray(body.observations)) throw new MacroProviderError("fred", "RESPONSE", "FRED response did not contain observations.");
    return body.observations.flatMap((row) => {
      if (!row.date || !row.realtime_start) return [];
      const normalized = normalizeObservation({
        provider: "fred",
        externalSeriesId: request.externalSeriesId,
        period: row.date,
        value: row.value,
        vintageAt: row.realtime_start,
        sourcePublishedAt: row.realtime_start,
        fetchedAt,
        metadata: { realtimeEnd: row.realtime_end ?? null },
        raw: row as unknown as Record<string, unknown>,
      });
      return normalized ? [normalized] : [];
    }).sort((left, right) => left.period.getTime() - right.period.getTime() || left.vintageAt.getTime() - right.vintageAt.getTime());
  };

  return {
    id: "fred",
    fetchSeries,
    fetchLatest: (request) => fetchSeries({ ...request, from: new Date(Date.UTC(now().getUTCFullYear() - 2, 0, 1)) }),
    healthCheck: async () => { await fetchSeries({ externalSeriesId: HEALTH_SERIES, from: new Date(Date.UTC(now().getUTCFullYear(), 0, 1)) }); },
  };
}
