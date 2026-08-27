import { cookies, headers } from "next/headers";

export type Locale = "en" | "zh-CN";
export const LOCALE_COOKIE = "tline_locale";

export function resolveLocale(cookie?: string, acceptLanguage?: string | null): Locale {
  if (cookie === "en" || cookie === "zh-CN") return cookie;
  return /^zh\b/i.test(acceptLanguage?.trim() ?? "") ? "zh-CN" : "en";
}

export function getLocale(): Locale {
  return resolveLocale(cookies().get(LOCALE_COOKIE)?.value, headers().get("accept-language"));
}

export function tr(locale: Locale, en: string, zh: string) {
  return locale === "zh-CN" ? zh : en;
}

export function formatDate(value: Date | string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function relativeTime(value: Date | string, locale: Locale) {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 3600) return tr(locale, `${Math.max(1, Math.round(seconds / 60))}m`, `${Math.max(1, Math.round(seconds / 60))}分钟前`);
  if (seconds < 86400) return tr(locale, `${Math.round(seconds / 3600)}h`, `${Math.round(seconds / 3600)}小时前`);
  return tr(locale, `${Math.round(seconds / 86400)}d`, `${Math.round(seconds / 86400)}天前`);
}
