import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";

// Generic expectations engine: turn any institution's research preview into normalized
// numeric forecasts for tracked releases, and aggregate them into a consensus + distribution.
// Adding a new bank needs no code (it flows through ingest); adding an indicator is one
// alias row below. Nothing here is publisher-specific.

export interface ExtractedForecast {
  indicatorKey: string; // canonical indicator key, e.g. US_NFP
  referencePeriod: Date; // first day of the reference month/quarter
  value: number;
  unit: string;
  quote: string;
}

// Free-text indicator → canonical key. Order matters (more specific first). Extend as needed.
const INDICATOR_ALIASES: Array<[RegExp, string]> = [
  [/core\s+cpi|cpi[^.]*\bcore\b|核心\s*cpi|核心消费者物价/i, "US_CPI_CORE"],
  [/\bcpi\b|consumer price|消费者物价|居民消费价格/i, "US_CPI_HEADLINE"],
  [/core\s+pce|核心\s*pce/i, "US_CORE_PCE_PRICE"],
  [/\bpce\b(?!.*labou?r)|personal consumption/i, "US_PCE_PRICE"],
  [/\bppi\b|producer price|生产者物价/i, "US_PPI"],
  [/non-?farm|payroll|非农/i, "US_NFP"],
  [/unemployment rate|失业率|jobless rate/i, "US_UNEMPLOYMENT_RATE"],
  [/jolts|job openings|职位空缺/i, "US_JOLTS_OPENINGS"],
  [/\bgdp\b|gross domestic|国内生产总值/i, "US_GDP"],
];

export function normalizeIndicator(text: string): string | null {
  for (const [pattern, key] of INDICATOR_ALIASES) if (pattern.test(text)) return key;
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Parse "August 2026" / "Aug 2026" / "Q2 2026" / "2026-08" → first day of that month/quarter (UTC). */
export function parseReferencePeriod(text: string, fallbackYear = new Date().getUTCFullYear()): Date | null {
  const iso = text.match(/(20\d{2})[-/](0[1-9]|1[0-2])/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, 1));
  const quarter = text.match(/q([1-4])\s*[- ]?\s*(20\d{2})|(20\d{2})\s*q([1-4])/i);
  if (quarter) { const q = Number(quarter[1] ?? quarter[4]); const y = Number(quarter[2] ?? quarter[3]); return new Date(Date.UTC(y, (q - 1) * 3, 1)); }
  const month = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(20\d{2})?/i);
  if (month) { const m = MONTHS[month[1].toLowerCase()]; const y = month[2] ? Number(month[2]) : fallbackYear; return new Date(Date.UTC(y, m - 1, 1)); }
  return null;
}

const SYSTEM = `You extract explicit numeric forecasts an institution makes for UPCOMING official economic data releases (nonfarm payrolls, unemployment rate, CPI, core CPI, PPI, PCE, JOLTS, GDP, etc.).
For every forecast the author is predicting for a scheduled release, output the indicator name, the reference period (e.g. "August 2026" or "Q2 2026"), the numeric value, its unit, and a short verbatim quote.
Only include forecasts the author themselves states, with an explicit number, for a data release. Ignore past actual values, market pricing, and vague qualitative statements.
Return ONLY JSON: {"forecasts":[{"indicator":string,"referencePeriod":string,"value":string,"unit":string,"quote":string}]}.`;

interface RawForecast { indicator?: string; referencePeriod?: string; value?: string; unit?: string; quote?: string }

/** Extract normalized forecasts from one research article. Institution-agnostic. */
export async function extractForecasts(
  title: string,
  text: string,
  provider = getLLMProvider(process.env.FORECAST_PROVIDER ?? process.env.TRANSLATION_PROVIDER),
): Promise<ExtractedForecast[]> {
  if (!provider) throw new Error("No LLM provider is configured for forecast extraction.");
  const { value } = await completeJSON<{ forecasts?: RawForecast[] }>(provider, {
    system: SYSTEM,
    user: JSON.stringify({ title, body: text.slice(0, 12_000) }),
    maxTokens: 1500,
  });
  const rows = Array.isArray(value.forecasts) ? value.forecasts : [];
  const out: ExtractedForecast[] = [];
  for (const row of rows) {
    const indicatorKey = normalizeIndicator(`${row.indicator ?? ""} ${row.quote ?? ""}`);
    const referencePeriod = row.referencePeriod ? parseReferencePeriod(row.referencePeriod) : null;
    const numeric = row.value != null ? Number(String(row.value).replace(/[^0-9.\-]/g, "")) : NaN;
    if (!indicatorKey || !referencePeriod || !Number.isFinite(numeric)) continue;
    out.push({ indicatorKey, referencePeriod, value: numeric, unit: (row.unit ?? "").trim(), quote: (row.quote ?? "").slice(0, 300) });
  }
  return out;
}

export interface ForecastConsensus {
  count: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  contributors: Array<{ institution: string; value: number }>;
}

/** Aggregate a set of institution forecasts into consensus (median) + distribution. */
export function aggregateForecasts(items: Array<{ institution: string; value: number; unit?: string }>): ForecastConsensus {
  // Keep the latest/one value per institution (caller passes de-duplicated rows).
  const contributors = items.map((item) => ({ institution: item.institution, value: item.value }));
  const values = contributors.map((c) => c.value).sort((a, b) => a - b);
  const count = values.length;
  const median = count === 0 ? null : count % 2 ? values[(count - 1) / 2] : (values[count / 2 - 1] + values[count / 2]) / 2;
  const mean = count === 0 ? null : Number((values.reduce((s, v) => s + v, 0) / count).toFixed(4));
  return {
    count,
    median: median === null ? null : Number(median.toFixed(4)),
    mean,
    min: count ? values[0] : null,
    max: count ? values[count - 1] : null,
    unit: items.find((item) => item.unit)?.unit ?? "",
    contributors: contributors.sort((a, b) => b.value - a.value),
  };
}
