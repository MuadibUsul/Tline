import { createHash } from "node:crypto";
import { ANALYTICS_CONSENT_COOKIE, ANALYTICS_VISITOR_COOKIE } from "./cookieNames";

/**
 * Who a visitor is, for counting purposes only.
 *
 * `visitorHash` is the cookieless fallback: a digest of a server-side secret, the UTC day,
 * the caller's address and their user agent. Within one day the same reader hashes to the
 * same value; across days the value changes and cannot be joined back. It is used when a
 * reader declines the analytics cookie.
 *
 * After opt-in, `readAnalyticsIdentity` returns a random first-party cookie id instead.
 * That id is stable across days and is what makes returning anonymous readers countable;
 * the address and raw UA are still never stored.
 */

function secret(): string {
  // The same secret that signs sessions. If it is absent the digest is still stable for
  // the process, which keeps development working; the value never leaves the server.
  return process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
}

/** UTC calendar day as YYYY-MM-DD. Every aggregate in this pipeline is keyed by it. */
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC day `offset` days before `from`. */
export function shiftDay(from: Date, offset: number): string {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + offset);
  return dayKey(date);
}

/** Every UTC day from `days` ago through today, oldest first. */
export function dayRange(days: number, now: Date = new Date()): string[] {
  return Array.from({ length: days }, (_, index) => shiftDay(now, index - days + 1));
}

/** Midnight UTC at the start of the given day key. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function visitorHash(ip: string, userAgent: string, day: string = dayKey()): string {
  return createHash("sha256").update(`${secret()}|${day}|${ip}|${userAgent}`).digest("base64url").slice(0, 32);
}

/**
 * The caller's address, as far as it can be known.
 *
 * `x-forwarded-for` is only meaningful behind a proxy that sets it. Without one every
 * caller collapses to the same bucket, which under-counts visitors rather than inventing
 * them — the safe direction for a number an operator will quote.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "unknown";
}

/** Country from whatever the edge in front of this app attached, or null. */
export function clientCountry(headers: Headers): string | null {
  const country = headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") || headers.get("x-country-code");
  return country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== "XX" ? country.toUpperCase() : null;
}

export type AnalyticsConsent = "granted" | "denied" | "unknown";

export interface AnalyticsIdentity {
  /** Stable first-party cookie id; null when consent was not granted. */
  visitorKey: string | null;
  consent: AnalyticsConsent;
}

function cookieValue(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The opt-in identity. A cookie id is accepted only when the consent cookie says granted;
 * a stray id left behind after a decline is ignored. Ids are random and bounded, never
 * derived from the address.
 */
export function readAnalyticsIdentity(headers: Headers): AnalyticsIdentity {
  const consent = cookieValue(headers, ANALYTICS_CONSENT_COOKIE);
  const visitorKey = cookieValue(headers, ANALYTICS_VISITOR_COOKIE);
  const granted = consent === "granted"
    && Boolean(visitorKey)
    && /^[A-Za-z0-9_-]{20,64}$/.test(visitorKey!);
  return {
    visitorKey: granted ? visitorKey : null,
    consent: consent === "granted" || consent === "denied" ? consent : "unknown",
  };
}
