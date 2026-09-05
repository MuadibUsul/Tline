export const SITE_NAME = "Tlines Institutional Intelligence";
export const SITE_NAME_ZH = "Tlines 全球机构情报";
export const ORGANIZATION_ID_PATH = "/#organization";

/** Canonical public origin. Production can never silently emit localhost URLs. */
export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.NEXTAUTH_URL || (process.env.NODE_ENV === "production" ? "https://tlines.tech" : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

/** Routes that must never be indexed: authenticated surfaces and machine endpoints. */
export const PRIVATE_ROUTES = ["/admin", "/alerts", "/watchlist", "/signin", "/api"];
