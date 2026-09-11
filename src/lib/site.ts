export const SITE_NAME = "Tlines Institutional Intelligence";
export const SITE_NAME_ZH = "Tlines 全球机构情报";
export const ORGANIZATION_ID_PATH = "/#organization";

/** Canonical public origin. Production can never silently emit localhost URLs. */
export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.NEXTAUTH_URL || (process.env.NODE_ENV === "production" ? "https://tlines.tech" : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

/**
 * Paths a crawler is asked not to fetch.
 *
 * Authenticated surfaces are deliberately absent. They already carry `noindex`, and a
 * page a crawler is forbidden to *fetch* is a page whose `noindex` is never *read* —
 * which is exactly how a sign-in page ends up indexed from an external link. Letting the
 * crawler in is what keeps it out of the index.
 *
 * Machine endpoints are listed, but not the whole `/api` tree: `/api/og` renders every
 * social card and `/api/figures` serves the images inside a report, so blocking `/api`
 * wholesale hid both from search along with the JSON.
 */
export const CRAWLER_DISALLOW = ["/api/auth", "/api/documents", "/api/feed", "/api/health", "/api/search", "/api/social", "/api/v1"];
