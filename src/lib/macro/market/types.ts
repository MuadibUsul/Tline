export type MarketQuality = "OFFICIAL_REFERENCE" | "DELAYED" | "REALTIME" | "EOD";

export interface MarketQuote {
  symbol: string;
  provider: string;
  externalSymbol: string;
  observedAt: Date;
  fetchedAt: Date;
  interval: string;
  quoteCurrency: string;
  quality: MarketQuality;
  status: string;
  providerUpdatedAt: Date | null;
  providerDelaySeconds: number | null;
  marketState: "OPEN" | "CLOSED" | "UNKNOWN";
  priceType: "LAST" | "CLOSE" | "SETTLEMENT" | "MID";
  unit: string;
  licenseKey: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  sourceUrl: string;
  metadata: Record<string, unknown> | null;
}

export interface MarketDataProvider {
  readonly id: string;
  getQuote(symbol: string): Promise<MarketQuote>;
  getTimeSeries(symbol: string, interval: string, start: Date, end: Date): Promise<MarketQuote[]>;
  healthCheck(): Promise<void>;
}
