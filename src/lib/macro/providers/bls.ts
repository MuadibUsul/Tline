import { normalizeObservation } from "../normalize";
import type { MacroSeriesRequest } from "../types";
import { createJsonClient, MacroProviderError, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const HEALTH_SERIES = "CUSR0000SA0";

interface BlsResponse {
  status?: string;
  message?: string[];
  Results?: { series?: Array<{ seriesID?: string; data?: Array<{ year?: string; period?: string; value?: string; footnotes?: Array<{ code?: string; text?: string }> }> }> };
}

export function createBlsProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestJson = createJsonClient("bls", { minIntervalMs: 200, ...options });
  const apiKey = options.apiKey ?? process.env.BLS_API_KEY;
  const now = options.now ?? (() => new Date());

  const fetchSeries = async (request: MacroSeriesRequest) => {
    const fetchedAt = now();
    const payload: Record<string, unknown> = { seriesid: [request.externalSeriesId] };
    if (request.from || request.to) {
      payload.startyear = String(request.from?.getUTCFullYear() ?? request.to!.getUTCFullYear());
      payload.endyear = String(request.to?.getUTCFullYear() ?? fetchedAt.getUTCFullYear());
    }
    if (apiKey) payload.registrationkey = apiKey;
    const body = await requestJson<BlsResponse>(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (body.status !== "REQUEST_SUCCEEDED") {
      throw new MacroProviderError("bls", "RESPONSE", "BLS rejected the data request.");
    }
    const series = body.Results?.series?.find((item) => item.seriesID === request.externalSeriesId);
    if (!series) throw new MacroProviderError("bls", "RESPONSE", "BLS response did not contain the requested series.");
    return (series.data ?? []).flatMap((row) => {
      if (!row.year || !/^M(?:0[1-9]|1[0-2])$/.test(row.period ?? "")) return [];
      const preliminary = row.footnotes?.some((footnote) => footnote.code === "P") ?? false;
      const normalized = normalizeObservation({
        provider: "bls",
        externalSeriesId: request.externalSeriesId,
        period: `${row.year}-${row.period!.slice(1)}`,
        value: row.value,
        vintageAt: fetchedAt,
        fetchedAt,
        status: preliminary ? "PRELIMINARY" : "PUBLISHED",
        metadata: { footnotes: row.footnotes ?? [] },
        raw: row as unknown as Record<string, unknown>,
      });
      return normalized ? [normalized] : [];
    });
  };

  return {
    id: "bls",
    fetchSeries,
    fetchLatest: (request) => fetchSeries(request),
    healthCheck: async () => { await fetchSeries({ externalSeriesId: HEALTH_SERIES }); },
  };
}
