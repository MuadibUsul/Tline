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

const UNIT_LABELS: Record<string, { en: string; zh: string }> = {
  PERCENT: { en: "%", zh: "%" },
  PERCENT_YOY: { en: "% YoY", zh: "% 同比" },
  PERCENT_QOQ: { en: "% QoQ", zh: "% 环比" },
  PERCENT_MOM: { en: "% MoM", zh: "% 环比" },
  INDEX: { en: "points", zh: "指数点" },
  THOUSANDS_OF_PERSONS: { en: "K persons", zh: "千人" },
  THOUSANDS_OF_BARRELS: { en: "K barrels", zh: "千桶" },
  MILLIONS_OF_BARRELS: { en: "M barrels", zh: "百万桶" },
  BASIS_POINTS: { en: "bps", zh: "基点" },
  USD_PER_BARREL: { en: "USD/bbl", zh: "美元/桶" },
};

/** Human-readable unit label, e.g. "THOUSANDS_OF_PERSONS" → "千人" / "K persons". */
export function unitLabel(unit: string, locale: Locale) {
  const mapped = UNIT_LABELS[unit.toUpperCase()];
  if (mapped) return locale === "zh-CN" ? mapped.zh : mapped.en;
  return unit.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Weekday + date + time in Beijing wall-clock (fixed UTC+8), e.g. "周三 09/03 20:30". */
export function beijingDateTime(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai", weekday: "short", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(value);
}
