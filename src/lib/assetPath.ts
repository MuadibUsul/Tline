const ASSET_SLUGS: Record<string, string> = {
  XAUUSD: "gold", WTI: "crude-oil-wti", BTC: "bitcoin", ETH: "ethereum",
  SPX: "sp-500", NDX: "nasdaq-100", DXY: "us-dollar-index",
  EURUSD: "eur-usd", USDJPY: "usd-jpy", US10Y: "us-10-year-treasury",
  US2Y: "us-2-year-treasury", COPPER: "copper",
};

const TICKERS = new Map(Object.entries(ASSET_SLUGS).map(([ticker, slug]) => [slug, ticker]));

export function assetPath(ticker: string) {
  const key = ticker.toUpperCase();
  return `/markets/${ASSET_SLUGS[key] ?? key.toLowerCase()}`;
}

export function tickerFromAssetSlug(value: string) {
  const clean = value.toLowerCase();
  return TICKERS.get(clean) ?? value.toUpperCase();
}
