import { normalizeObservation } from "../normalize";
import { getMacroSource } from "../registry";
import type { MacroSeriesRequest } from "../types";
import { createSdmxCsvClient, parseSdmxCsv } from "./sdmx";
import { MacroProviderError, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://ec.europa.eu/eurostat/api/dissemination/sdmx/3.0/data/dataflow/ESTAT";

export function createEurostatProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestCsv = createSdmxCsvClient("eurostat", options);
  const now = options.now ?? (() => new Date());
  const fetchSeries = async (request: MacroSeriesRequest) => {
    const source = getMacroSource("eurostat", request.externalSeriesId);
    const dataflow = String(source?.metadata?.dataflow ?? "");
    const dimensions = source?.metadata?.dimensions as Record<string, string> | undefined;
    if (!source || !dataflow || !dimensions) throw new MacroProviderError("eurostat", "CONFIG", `Eurostat mapping is incomplete for ${request.externalSeriesId}.`);
    const fetchedAt = now();
    const url = new URL(`${ENDPOINT}/${dataflow}/1.0`);
    url.searchParams.set("format", "csvdata");
    url.searchParams.set("formatVersion", "2.0");
    url.searchParams.set("compress", "false");
    for (const [key, value] of Object.entries(dimensions)) url.searchParams.set(`c[${key}]`, value);
    return parseSdmxCsv(await requestCsv(url.href), dataflow).flatMap((row) => {
      const normalized = normalizeObservation({ provider: "eurostat", externalSeriesId: request.externalSeriesId, period: row.timePeriod, value: row.value, vintageAt: fetchedAt, fetchedAt, status: /p/i.test(row.status ?? "") ? "PRELIMINARY" : "PUBLISHED", metadata: { dataflow, dimensions: row.dimensions, sdmxUnit: row.unit, sdmxFrequency: row.frequency, sdmxStatus: row.status, ...row.metadata }, raw: row.metadata });
      return normalized && (!request.from || normalized.period >= request.from) && (!request.to || normalized.period <= request.to) ? [normalized] : [];
    });
  };
  return { id: "eurostat", fetchSeries, fetchLatest: (request) => fetchSeries({ ...request, from: new Date(Date.UTC(now().getUTCFullYear() - 2, 0, 1)) }), healthCheck: async () => { await fetchSeries({ externalSeriesId: "EA_HICP_HEADLINE", from: new Date(Date.UTC(now().getUTCFullYear(), 0, 1)) }); } };
}
