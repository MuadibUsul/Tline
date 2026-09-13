export type MarketDataUse = "internal_analysis" | "public_display" | "api" | "social" | "derived_display";
export type MarketUnavailableReason =
  | "not_configured" | "unsupported" | "permission_denied" | "quota_exhausted"
  | "stale" | "no_matching_data" | "quality_failed" | "authorization_pending";

export interface MarketLicenseEvidence {
  status: string;
  allowedUses: string;
  confirmedAt: Date | null;
  expiresAt: Date | null;
}

export interface MarketObservationQualityInput {
  observedAt: Date;
  fetchedAt: Date;
  interval: string;
  status: string;
  marketState: string;
  providerDelaySeconds: number | null;
  samplingIntervalSeconds: number;
  license: MarketLicenseEvidence | null;
}

export interface MarketUseDecision {
  usable: boolean;
  reason: MarketUnavailableReason | null;
  stale: boolean;
  ageSeconds: number;
  providerDelaySeconds: number | null;
  samplingIntervalSeconds: number;
}

function uses(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

export function licensePermits(license: MarketLicenseEvidence | null, use: MarketDataUse, now = new Date()) {
  return Boolean(license
    && license.status === "CONFIRMED"
    && license.confirmedAt
    && (!license.expiresAt || license.expiresAt > now)
    && uses(license.allowedUses).includes(use));
}

export function marketFreshnessSeconds(interval: string, samplingSeconds: number, providerDelaySeconds: number | null, marketState: string) {
  const normalized = interval.toLowerCase();
  const daily = normalized.includes("day") || normalized === "eod";
  if (daily) return marketState === "CLOSED" ? 4 * 86400 : 2 * 86400;
  const activeWindow = Math.max(900, samplingSeconds * 3, (providerDelaySeconds ?? 0) + samplingSeconds * 2);
  return marketState === "CLOSED" ? Math.max(activeWindow, 3 * 86400) : activeWindow;
}

export function evaluateMarketUse(input: MarketObservationQualityInput, use: MarketDataUse, now = new Date()): MarketUseDecision {
  const ageSeconds = Math.max(0, (now.getTime() - input.observedAt.getTime()) / 1000);
  const maxAge = marketFreshnessSeconds(input.interval, input.samplingIntervalSeconds, input.providerDelaySeconds, input.marketState);
  const stale = ageSeconds > maxAge;
  const base = { stale, ageSeconds, providerDelaySeconds: input.providerDelaySeconds, samplingIntervalSeconds: input.samplingIntervalSeconds };
  if (input.status !== "PUBLISHED") return { ...base, usable: false, reason: "quality_failed" };
  if (!input.license || input.license.status !== "CONFIRMED" || !input.license.confirmedAt) return { ...base, usable: false, reason: "authorization_pending" };
  if (input.license.expiresAt && input.license.expiresAt <= now) return { ...base, usable: false, reason: "authorization_pending" };
  if (!uses(input.license.allowedUses).includes(use)) return { ...base, usable: false, reason: "permission_denied" };
  if (stale) return { ...base, usable: false, reason: "stale" };
  return { ...base, usable: true, reason: null };
}

export function providerFailureReason(error: unknown): MarketUnavailableReason {
  const value = error as { status?: number | null; code?: string };
  if (value.status === 401 || value.status === 403) return "permission_denied";
  if (value.status === 429) return "quota_exhausted";
  if (value.code === "CONFIG") return "not_configured";
  return "quality_failed";
}
