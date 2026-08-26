// Asset dictionary — seeds the `assets` table and drives keyword tagging.
// aliases are lowercase match terms used by the mock parser.

export type AssetClass = "equity" | "rate" | "fx" | "commodity" | "crypto" | "macro";

export interface AssetDef {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  aliases: string[];
  featured?: boolean; // shown on the home Market Consensus grid
}

export const ASSETS: AssetDef[] = [
  { ticker: "XAUUSD", name: "Gold", assetClass: "commodity", featured: true, aliases: ["gold", "xau", "bullion", "gold price", "黄金", "金价"] },
  { ticker: "XAGUSD", name: "Silver", assetClass: "commodity", aliases: ["silver", "xag", "白银"] },
  { ticker: "WTI", name: "Crude Oil (WTI)", assetClass: "commodity", featured: true, aliases: ["oil", "crude", "wti", "brent", "petroleum", "opec", "原油", "石油", "布伦特", "油价"] },
  { ticker: "NATGAS", name: "Natural Gas", assetClass: "commodity", aliases: ["natural gas", "natgas", "lng", "天然气"] },
  { ticker: "COPPER", name: "Copper", assetClass: "commodity", aliases: ["copper", "铜"] },
  { ticker: "BTC", name: "Bitcoin", assetClass: "crypto", featured: true, aliases: ["bitcoin", "btc", "比特币"] },
  { ticker: "ETH", name: "Ethereum", assetClass: "crypto", aliases: ["ethereum", "ether", "eth", "以太坊", "以太"] },
  { ticker: "SPX", name: "S&P 500", assetClass: "equity", featured: true, aliases: ["s&p 500", "s&p", "spx", "us equities", "sp500", "标普", "美股"] },
  { ticker: "NDX", name: "Nasdaq 100", assetClass: "equity", aliases: ["nasdaq", "ndx", "tech stocks", "纳斯达克", "纳指"] },
  { ticker: "NVDA", name: "NVIDIA", assetClass: "equity", aliases: ["nvidia", "nvda", "英伟达"] },
  { ticker: "AAPL", name: "Apple", assetClass: "equity", aliases: ["apple", "aapl", "苹果"] },
  { ticker: "SOX", name: "Semiconductors", assetClass: "equity", aliases: ["semiconductor", "semiconductors", "chips", "soxx", "semis", "半导体", "芯片"] },
  { ticker: "DXY", name: "US Dollar (DXY)", assetClass: "fx", featured: true, aliases: ["dollar", "usd", "dxy", "greenback", "美元", "美指"] },
  { ticker: "EURUSD", name: "EUR/USD", assetClass: "fx", aliases: ["euro", "eur/usd", "eurusd", "欧元"] },
  { ticker: "USDJPY", name: "USD/JPY", assetClass: "fx", aliases: ["yen", "usd/jpy", "usdjpy", "jpy", "日元"] },
  { ticker: "GBPUSD", name: "GBP/USD", assetClass: "fx", aliases: ["sterling", "pound", "gbp/usd", "gbpusd", "英镑"] },
  { ticker: "US10Y", name: "US 10Y Treasury", assetClass: "rate", featured: true, aliases: ["10-year", "10y", "treasury", "treasuries", "us10y", "bond yields", "美债", "十年期", "国债", "美国国债"] },
  { ticker: "US2Y", name: "US 2Y Treasury", assetClass: "rate", aliases: ["2-year", "2y", "us2y", "两年期"] },
  { ticker: "FED", name: "Fed Policy", assetClass: "macro", aliases: ["fed", "fomc", "federal reserve", "rate cut", "rate hike", "powell", "美联储", "加息", "降息", "议息"] },
  { ticker: "CPI", name: "Inflation", assetClass: "macro", aliases: ["inflation", "cpi", "pce", "disinflation", "通胀", "通货膨胀"] },
];

export const DIRECTION = {
  strong_bull: 2,
  bull: 1,
  neutral: 0,
  bear: -1,
  strong_bear: -2,
} as const;

export type DirectionKey = keyof typeof DIRECTION;

export function directionLabel(score: number): { key: DirectionKey; label: string; tone: "bull" | "bear" | "neu" } {
  if (score >= 1.5) return { key: "strong_bull", label: "Strong Bullish", tone: "bull" };
  if (score >= 0.5) return { key: "bull", label: "Bullish", tone: "bull" };
  if (score > -0.5) return { key: "neutral", label: "Neutral", tone: "neu" };
  if (score > -1.5) return { key: "bear", label: "Bearish", tone: "bear" };
  return { key: "strong_bear", label: "Strong Bearish", tone: "bear" };
}
