import type { ProviderOptions } from "./types";
import { MacroProviderError } from "./types";

export interface SdmxRow {
  dataflow: string;
  dimensions: Record<string, string>;
  timePeriod: string;
  value: string;
  unit: string | null;
  frequency: string | null;
  status: string | null;
  metadata: Record<string, string>;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const CONTROL = new Set(["STRUCTURE", "STRUCTURE_ID", "ACTION", "KEY", "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS", "OBS_FLAG", "CONF_STATUS"]);

export function parseSdmxCsv(text: string, dataflow: string): SdmxRow[] {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  const upper = headers.map((value) => value.toUpperCase());
  const timeIndex = upper.indexOf("TIME_PERIOD");
  const valueIndex = upper.indexOf("OBS_VALUE");
  if (timeIndex < 0 || valueIndex < 0) throw new MacroProviderError("sdmx", "RESPONSE", "SDMX-CSV is missing TIME_PERIOD or OBS_VALUE.");
  return rows.flatMap((values) => {
    const timePeriod = values[timeIndex]?.trim();
    const value = values[valueIndex]?.trim();
    if (!timePeriod || !value || value === ":") return [];
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
    const find = (name: string) => values[upper.indexOf(name)]?.trim() || null;
    const dimensions = Object.fromEntries(Object.entries(record).filter(([key, item]) => item && !CONTROL.has(key.toUpperCase()) && !key.toUpperCase().startsWith("OBS_") && !["UNIT_MULT", "DECIMALS", "TITLE", "TITLE_COMPL"].includes(key.toUpperCase())));
    const metadata = Object.fromEntries(Object.entries(record).filter(([key, item]) => item && !dimensions[key] && !["TIME_PERIOD", "OBS_VALUE"].includes(key.toUpperCase())));
    return [{ dataflow, dimensions, timePeriod, value, unit: find("UNIT"), frequency: find("FREQ"), status: find("OBS_STATUS") ?? find("OBS_FLAG"), metadata }];
  });
}

export function createSdmxCsvClient(provider: string, options: ProviderOptions = {}) {
  const request = options.fetch ?? fetch;
  const wait = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 2;
  const minIntervalMs = options.minIntervalMs ?? 500;
  let lastRequest = 0;
  return async (url: string) => {
    for (let attempt = 0; ; attempt++) {
      const pause = lastRequest + minIntervalMs - Date.now();
      if (pause > 0) await wait(pause);
      lastRequest = Date.now();
      try {
        const response = await request(url, { headers: { accept: "text/csv,application/vnd.sdmx.data+csv", "user-agent": "TlineMacroIntelligence/0.1 (+official economic data client)" }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return response.text();
        if ((response.status === 429 || response.status >= 500) && attempt < retries) { await wait(250 * 2 ** attempt); continue; }
        throw new MacroProviderError(provider, "HTTP", `${provider} request failed with HTTP ${response.status}.`, response.status, response.status === 429 || response.status >= 500);
      } catch (error) {
        if (error instanceof MacroProviderError) throw error;
        if (attempt < retries) { await wait(250 * 2 ** attempt); continue; }
        throw new MacroProviderError(provider, error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK", `${provider} SDMX request failed.`, null, true);
      }
    }
  };
}
