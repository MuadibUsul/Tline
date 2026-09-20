import { getLegacyNonAssetAlias, taxonomy } from "./classification/taxonomy";

const ASSET_SLUGS: Record<string, string> = {
  XAUUSD: "gold", WTI: "crude-oil-wti", BTC: "bitcoin", ETH: "ethereum",
  SPX: "sp-500", NDX: "nasdaq-100", DXY: "us-dollar-index",
  EURUSD: "eur-usd", USDJPY: "usd-jpy", US10Y: "us-10-year-treasury",
  US2Y: "us-2-year-treasury", COPPER: "copper",
};

const TICKERS = new Map(Object.entries(ASSET_SLUGS).map(([ticker, slug]) => [slug, ticker]));

const LEGACY_TOPIC_ASSETS: Record<string, string> = {
  "gbp-usd": "GBPUSD",
  "natural-gas": "NATGAS",
  "s-p-500": "SPX",
  semiconductors: "SOX",
  silver: "XAGUSD",
  "us-10y-treasury": "US10Y",
  "us-2y-treasury": "US2Y",
  "us-dollar-dxy": "DXY",
};

export function assetPath(ticker: string) {
  const key = ticker.toUpperCase();
  return `/markets/${ASSET_SLUGS[key] ?? key.toLowerCase()}`;
}

export function tickerFromAssetSlug(value: string) {
  const clean = value.toLowerCase();
  return TICKERS.get(clean) ?? value.toUpperCase();
}

/** Old model-generated topics that are actually one concrete covered asset. */
export function legacyTopicRedirectPath(value: string) {
  const key = value.toLowerCase();
  const ticker = TICKERS.get(key) ?? LEGACY_TOPIC_ASSETS[key];
  if (ticker) return assetPath(ticker);
  if (key === "fed-policy" || key === "federal-reserve") return "/institution/federal-reserve";
  return null;
}

/** FED/CPI remain valid ingestion aliases, but no longer own public asset pages. */
export function legacyNonAssetRedirectPath(value: string) {
  const alias = getLegacyNonAssetAlias(value);
  if (!alias) return null;
  if (alias.replacementFacet === "institution") return `/institution/${alias.replacementKey}`;
  if (alias.replacementFacet === "jurisdiction") return `/economies/${alias.replacementKey}`;
  if (alias.replacementFacet === "topic") return `/topics/${alias.replacementKey}`;
  const topic = taxonomy.events.find((event) => event.key === alias.replacementKey)?.defaultTopicKey;
  return topic ? `/topics/${topic}` : null;
}
