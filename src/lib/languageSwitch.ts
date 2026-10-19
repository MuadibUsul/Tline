import type { Locale } from "./i18n";

/**
 * The opposite-language address for the page the reader is actually on.
 *
 * The root layout survives client-side navigation, so a href computed from the server's
 * first request keeps pointing at the page the reader landed on. This helper is pure so
 * that behaviour is testable without a browser.
 */
export function languageSwitchTarget(
  pathname: string | null | undefined,
  locale: Locale,
): { href: string; hrefLang: "en" | "zh-CN" } | null {
  const path = pathname || "/";
  if (path === "/admin" || path.startsWith("/admin/")) return null;
  if (path === "/zh" || path.startsWith("/zh/")) return { href: `/en${path.slice(3)}`, hrefLang: "en" };
  if (path === "/en" || path.startsWith("/en/")) return { href: `/zh${path.slice(3)}`, hrefLang: "zh-CN" };
  // A path without a locale prefix (for example a request that middleware has not
  // rewritten) still gets a sensible opposite-language root.
  return { href: locale === "en" ? "/zh" : "/en", hrefLang: locale === "en" ? "zh-CN" : "en" };
}
