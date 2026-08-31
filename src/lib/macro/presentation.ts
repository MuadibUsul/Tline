import type { Locale } from "../i18n";

export function macroNumber(value: { toString(): string } | string | number | null | undefined, locale: Locale) {
  if (value === null || value === undefined) return locale === "zh-CN" ? "不适用" : "N/A";
  return value.toString();
}

export function actualText(value: { toString(): string } | null | undefined, released: boolean, locale: Locale) {
  if (value !== null && value !== undefined) return value.toString();
  return released ? (locale === "zh-CN" ? "不适用" : "N/A") : (locale === "zh-CN" ? "尚未发布" : "Not released");
}

export function consensusText(value: { toString(): string } | null | undefined, locale: Locale) {
  return value !== null && value !== undefined ? value.toString() : locale === "zh-CN" ? "无共识数据" : "No consensus data";
}

export function macroDateTime(value: Date, locale: Locale, timeZone = "UTC") {
  return new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(value);
}
