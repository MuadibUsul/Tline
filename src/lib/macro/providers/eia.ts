import { normalizeObservation } from "../normalize";
import { getMacroSource } from "../registry";
import type { MacroSeriesRequest } from "../types";
import { createJsonClient, isoDate, MacroProviderError, requireApiKey, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://api.eia.gov/v2";
const HEALTH_SERIES = "WCESTUS1";

interface EiaResponse {
  response?: { data?: Array<{ period?: string; series?: string; value?: string | number; units?: string; [key: string]: unknown }> };
}

export function createEiaProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestJson = createJsonClient("eia", { minIntervalMs: 500, ...options });
  const now = options.now ?? (() => new Date());

  const fetchSeries = async (request: MacroSeriesRequest) => {
    const apiKey = requireApiKey("eia", options.apiKey ?? process.env.EIA_API_KEY);
    const source = getMacroSource("eia", request.externalSeriesId);
    if (!source?.dataset) throw new MacroProviderError("eia", "CONFIG", `EIA registry mapping is incomplete for ${request.externalSeriesId}.`);
    const fetchedAt = now();
    const url = new URL(`${ENDPOINT}/${source.dataset}/data/`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("frequency", String(source.metadata?.frequency ?? "weekly"));
    url.searchParams.set("data[0]", "value");
    url.searchParams.set("facets[series][]", request.externalSeriesId);
    url.searchParams.set("sort[0][column]", "period");
    url.searchParams.set("sort[0][direction]", "asc");
    url.searchParams.set("length", "5000");
    if (request.from) url.searchParams.set("start", isoDate(request.from));
    if (request.to) url.searchParams.set("end", isoDate(request.to));
    const body = await requestJson<EiaResponse>(url.href);
    if (!Array.isArray(body.response?.data)) throw new MacroProviderError("eia", "RESPONSE", "EIA response did not contain observations.");
    return body.response.data.flatMap((row) => {
      if (!row.period || row.series !== request.externalSeriesId) return [];
      const normalized = normalizeObservation({
        provider: "eia",
        externalSeriesId: request.externalSeriesId,
        period: row.period,
        value: row.value,
        vintageAt: fetchedAt,
        fetchedAt,
        metadata: { units: row.units ?? null },
        raw: row,
      });
      return normalized ? [normalized] : [];
    }).sort((left, right) => left.period.getTime() - right.period.getTime());
  };

  return {
    id: "eia",
    fetchSeries,
    fetchLatest: (request) => fetchSeries({ ...request, from: new Date(Date.UTC(now().getUTCFullYear() - 2, 0, 1)) }),
    healthCheck: async () => { await fetchSeries({ externalSeriesId: HEALTH_SERIES, from: new Date(Date.UTC(now().getUTCFullYear(), 0, 1)) }); },
  };
}
