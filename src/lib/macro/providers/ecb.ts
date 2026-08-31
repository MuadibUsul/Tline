import { normalizeObservation } from "../normalize";
import { getMacroSource } from "../registry";
import type { MacroSeriesRequest } from "../types";
import { createSdmxCsvClient, parseSdmxCsv } from "./sdmx";
import { MacroProviderError, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://data-api.ecb.europa.eu/service/data";

export function createEcbProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestCsv = createSdmxCsvClient("ecb", options);
  const now = options.now ?? (() => new Date());
  const fetchSeries = async (request: MacroSeriesRequest) => {
    const source = getMacroSource("ecb", request.externalSeriesId);
    const dataflow = String(source?.metadata?.dataflow ?? "");
    const key = String(source?.metadata?.key ?? "");
    if (!source || !dataflow || !key) throw new MacroProviderError("ecb", "CONFIG", `ECB mapping is incomplete for ${request.externalSeriesId}.`);
    const fetchedAt = now();
    const url = new URL(`${ENDPOINT}/${dataflow}/${key}`);
    url.searchParams.set("format", "csvdata");
    if (request.from) url.searchParams.set("startPeriod", request.from.toISOString().slice(0, 10));
    if (request.to) url.searchParams.set("endPeriod", request.to.toISOString().slice(0, 10));
    return parseSdmxCsv(await requestCsv(url.href), dataflow).flatMap((row) => {
      const normalized = normalizeObservation({ provider: "ecb", externalSeriesId: request.externalSeriesId, period: row.timePeriod, value: row.value, vintageAt: fetchedAt, fetchedAt, status: row.status === "P" ? "PRELIMINARY" : "PUBLISHED", metadata: { dataflow, dimensions: row.dimensions, sdmxUnit: row.unit, sdmxFrequency: row.frequency, sdmxStatus: row.status, ...row.metadata }, raw: row.metadata });
      return normalized ? [normalized] : [];
    });
  };
  return { id: "ecb", fetchSeries, fetchLatest: (request) => fetchSeries({ ...request, from: new Date(Date.UTC(now().getUTCFullYear() - 2, 0, 1)) }), healthCheck: async () => { await fetchSeries({ externalSeriesId: "ECB_DEPOSIT_RATE", from: new Date(Date.UTC(now().getUTCFullYear(), 0, 1)) }); } };
}
