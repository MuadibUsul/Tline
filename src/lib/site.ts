/** Canonical public origin. Falls back to the auth origin, then localhost for dev. */
export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Routes that must never be indexed: authenticated surfaces and machine endpoints. */
export const PRIVATE_ROUTES = ["/admin", "/alerts", "/watchlist", "/signin", "/api"];
