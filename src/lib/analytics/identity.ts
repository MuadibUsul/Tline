import { createHash } from "node:crypto";

/**
 * Who a visitor is, for counting purposes only.
 *
 * There is no analytics cookie and no stored address. A visitor is the digest of a
 * server-side secret, the UTC day, the caller's address and their user agent. Within one
 * day the same reader hashes to the same value, so "visitors" is a real count rather than
 * a count of page views; across days the value changes and cannot be joined back, so the
 * history here does not accumulate into a profile of anyone.
 *
 * Rotating on the day is what makes the address unrecoverable in practice as well as in
 * principle: an attacker holding the table and the secret could still only test addresses
 * against the day they were seen, and the table itself is pruned.
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
