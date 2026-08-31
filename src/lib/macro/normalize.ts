import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getMacroIndicator, getMacroSource } from "./registry";
import type { NormalizedObservation } from "./types";

const MISSING = new Set(["", ".", "..", "-", "--", "---", "na", "n/a", "(na)", "null", "none", "nan"]);

export function normalizeDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Fractional or unsafe numeric input must be supplied as a source string.");
    return value.toString();
  }
  if (typeof value !== "string") throw new Error("Macro value must be a decimal string.");

  let text = value.trim().replace(/,/g, "").replace(/−/g, "-");
  if (MISSING.has(text.toLowerCase())) return null;
  if (/^\(.+\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new Error(`Invalid macro decimal: ${value}`);
  return new Prisma.Decimal(text).toString();
}

export function toUtcDate(value: Date | string, field = "date"): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${field}.`);
    return new Date(value.getTime());
  }
  const text = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) throw new Error(`${field} must include a timezone or be a date-only value.`);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}.`);
  return date;
}

export function normalizePeriod(value: Date | string, frequency: string): Date {
  if (value instanceof Date) return toUtcDate(value, "period");
  const text = value.trim();
  const year = text.match(/^(\d{4})$/);
  if (year && frequency === "ANNUAL") return new Date(Date.UTC(Number(year[1]), 0, 1));
  const quarter = text.match(/^(\d{4})-?Q([1-4])$/i);
  if (quarter && frequency === "QUARTERLY") return new Date(Date.UTC(Number(quarter[1]), (Number(quarter[2]) - 1) * 3, 1));
  const month = text.match(/^(\d{4})-(?:M)?(0[1-9]|1[0-2])$/i);
  if (month && frequency === "MONTHLY") return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
  return toUtcDate(text, "period");
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [values.year, values.month, values.day, values.hour, values.minute, values.second].map(Number);
}

/** Convert an official calendar's wall-clock time to UTC and reject DST gaps. */
export function localTimeToUtc(localIso: string, timeZone: string): Date {
  const match = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Local time must use YYYY-MM-DDTHH:mm[:ss].");
  const target = match.slice(1).map((part) => Number(part ?? 0));
  if (target.length === 5) target.push(0);
  const targetMs = Date.UTC(target[0], target[1] - 1, target[2], target[3], target[4], target[5]);
  let guess = targetMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shown = zonedParts(new Date(guess), timeZone);
    guess += targetMs - Date.UTC(shown[0], shown[1] - 1, shown[2], shown[3], shown[4], shown[5]);
  }
  const result = new Date(guess);
  if (zonedParts(result, timeZone).some((part, index) => part !== target[index])) {
    throw new Error(`Local time does not exist in ${timeZone}.`);
  }
  return result;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function rawHash(value: string | Uint8Array | Record<string, unknown>): string {
  const payload = typeof value === "string" || value instanceof Uint8Array ? value : stableStringify(value);
  return createHash("sha256").update(payload).digest("hex");
}

export interface NormalizeObservationInput {
  provider: string;
  externalSeriesId: string;
  period: Date | string;
  value: unknown;
  vintageAt: Date | string;
  fetchedAt: Date | string;
  sourcePublishedAt?: Date | string | null;
  status?: string;
  metadata?: Record<string, unknown> | null;
  raw?: string | Uint8Array | Record<string, unknown>;
}

export function normalizeObservation(input: NormalizeObservationInput): NormalizedObservation | null {
  const provider = input.provider.toLowerCase();
  const source = getMacroSource(provider, input.externalSeriesId);
  if (!source || !source.enabled) throw new Error(`Unknown macro source ${provider}:${input.externalSeriesId}.`);
  const indicator = getMacroIndicator(source.canonicalKey);
  if (!indicator || !indicator.enabled) throw new Error(`Disabled or unknown macro indicator ${source.canonicalKey}.`);
  const normalizedValue = normalizeDecimal(input.value);
  const scale = source.metadata?.valueScale;
  const value = normalizedValue === null ? null : scale === undefined ? normalizedValue : new Prisma.Decimal(normalizedValue).mul(String(scale)).toString();
  if (value === null) return null;
  const status = input.status?.trim().toUpperCase() || "PUBLISHED";
  return {
    canonicalKey: indicator.canonicalKey,
    provider,
    externalSeriesId: source.externalSeriesId,
    period: normalizePeriod(input.period, indicator.frequency),
    value,
    unit: indicator.unit,
    frequency: indicator.frequency,
    seasonalAdjustment: indicator.seasonalAdjustment,
    vintageAt: toUtcDate(input.vintageAt, "vintageAt"),
    sourcePublishedAt: input.sourcePublishedAt ? toUtcDate(input.sourcePublishedAt, "sourcePublishedAt") : null,
    fetchedAt: toUtcDate(input.fetchedAt, "fetchedAt"),
    sourceUrl: source.sourceUrl ?? null,
    rawHash: input.raw === undefined ? null : rawHash(input.raw),
    status,
    metadata: input.metadata ?? null,
  };
}
