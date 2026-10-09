import type { Locale } from "./i18n";

const USD_ASSETS = new Set(["AAPL", "BTC", "ETH", "NVDA"]);
const RATE_ASSETS = new Set(["US10Y", "US2Y"]);
const POINT_ASSETS = new Set(["DXY", "NDX", "SOX", "SPX"]);

function number(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: Math.abs(value) < 10 ? 4 : 2,
  }).format(value);
}

/** Display only units implied by the canonical instrument; unknown instruments stay unitless. */
export function formatAssetTarget(ticker: string, value: number, locale: Locale) {
  const formatted = number(value, locale);
  const key = ticker.toUpperCase();
  if (key === "XAUUSD") return locale === "zh-CN" ? `$${formatted}/盎司` : `$${formatted}/oz`;
  if (key === "WTI") return locale === "zh-CN" ? `$${formatted}/桶` : `$${formatted}/bbl`;
  if (RATE_ASSETS.has(key)) return `${formatted}%`;
  if (USD_ASSETS.has(key)) return `$${formatted}`;
  if (POINT_ASSETS.has(key)) return locale === "zh-CN" ? `${formatted}点` : `${formatted} points`;
  return formatted;
}
