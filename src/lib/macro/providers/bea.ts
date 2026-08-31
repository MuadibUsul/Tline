import { normalizeObservation } from "../normalize";
import { getMacroSource } from "../registry";
import type { MacroSeriesRequest } from "../types";
import { createJsonClient, MacroProviderError, requireApiKey, type OfficialMacroProvider, type ProviderOptions } from "./types";

const ENDPOINT = "https://apps.bea.gov/api/data/";
const HEALTH_SERIES = "NIPA:T20804:1";

interface BeaResponse {
  BEAAPI?: {
    Results?: { Data?: BeaRow[]; Error?: unknown } | Array<{ Data?: BeaRow[]; Error?: unknown }>;
    Error?: unknown;
  };
}

interface BeaRow {
  LineNumber?: string;
  TimePeriod?: string;
  DataValue?: string;
  CL_UNIT?: string;
  UNIT_MULT?: string;
  NoteRef?: string;
}

function years(request: MacroSeriesRequest, now: Date): string {
  const start = request.from?.getUTCFullYear() ?? now.getUTCFullYear() - 1;
  const end = request.to?.getUTCFullYear() ?? now.getUTCFullYear();
  return Array.from({ length: end - start + 1 }, (_, index) => start + index).join(",");
}

function period(value: string): string {
  const monthly = value.match(/^(\d{4})M(\d{1,2})$/);
  if (monthly) return `${monthly[1]}-${monthly[2].padStart(2, "0")}`;
  const quarterly = value.match(/^(\d{4})Q([1-4])$/);
  if (quarterly) return `${quarterly[1]}-Q${quarterly[2]}`;
  return value;
}

export function createBeaProvider(options: ProviderOptions = {}): OfficialMacroProvider {
  const requestJson = createJsonClient("bea", options);
  const now = options.now ?? (() => new Date());

  const fetchSeries = async (request: MacroSeriesRequest) => {
    const apiKey = requireApiKey("bea", options.apiKey ?? process.env.BEA_API_KEY);
    const source = getMacroSource("bea", request.externalSeriesId);
    if (!source?.dataset || !source.tableCode || !source.lineCode) {
      throw new MacroProviderError("bea", "CONFIG", `BEA registry mapping is incomplete for ${request.externalSeriesId}.`);
    }
    const fetchedAt = now();
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries({
      UserID: apiKey,
      method: "GetData",
      datasetname: source.dataset,
      TableName: source.tableCode,
      Frequency: String(source.metadata?.frequency ?? "M"),
      Year: years(request, fetchedAt),
      ResultFormat: "JSON",
    })) url.searchParams.set(key, value);
    const body = await requestJson<BeaResponse>(url.href);
    if (body.BEAAPI?.Error) throw new MacroProviderError("bea", "RESPONSE", "BEA rejected the data request.");
    const results = Array.isArray(body.BEAAPI?.Results) ? body.BEAAPI.Results : [body.BEAAPI?.Results];
    if (results.some((result) => result?.Error)) throw new MacroProviderError("bea", "RESPONSE", "BEA rejected the data request.");
    const rows = results.flatMap((result) => result?.Data ?? []).filter((row) => row.LineNumber === source.lineCode);
    if (rows.length === 0) throw new MacroProviderError("bea", "RESPONSE", "BEA response did not contain the configured table line.");
    return rows.flatMap((row) => {
      if (!row.TimePeriod) return [];
      const normalized = normalizeObservation({
        provider: "bea",
        externalSeriesId: request.externalSeriesId,
        period: period(row.TimePeriod),
        value: row.DataValue,
        vintageAt: fetchedAt,
        fetchedAt,
        metadata: { unit: row.CL_UNIT ?? null, unitMultiplier: row.UNIT_MULT ?? null, noteRef: row.NoteRef ?? null },
        raw: row as unknown as Record<string, unknown>,
      });
      return normalized ? [normalized] : [];
    }).sort((left, right) => left.period.getTime() - right.period.getTime());
  };

  return {
    id: "bea",
    fetchSeries,
    fetchLatest: (request) => fetchSeries(request),
    healthCheck: async () => { await fetchSeries({ externalSeriesId: HEALTH_SERIES }); },
  };
}
