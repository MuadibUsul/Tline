export interface MacroIndicatorDefinition {
  canonicalKey: string;
  nameEn: string;
  nameZh: string | null;
  countryCode: string;
  currency: string | null;
  category: string;
  frequency: string;
  unit: string;
  seasonalAdjustment: string | null;
  importance: number;
  enabled: boolean;
}

export interface MacroSourceDefinition {
  canonicalKey: string;
  provider: string;
  externalSeriesId: string;
  dataset?: string | null;
  tableCode?: string | null;
  lineCode?: string | null;
  priority: number;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  enabled: boolean;
}

export interface MacroReleaseFamilyDefinition {
  key: string;
  titleEn: string;
  titleZh: string;
  agency: string;
  countryCode: string;
  normalTimezone: string;
  indicators: string[];
  importance: number;
  pollingStrategy: {
    startMinutesBefore?: number;
    intervalSeconds?: number;
    stopMinutesAfter?: number;
    warmupMinutesBefore?: number;
    warmupIntervalSeconds?: number;
    lateIntervalSeconds?: number;
  };
  calendar: {
    source: "BLS_ICS" | "BEA_SCHEDULE" | "FOMC_CALENDAR" | "EIA_SCHEDULE";
    sourceUrl: string;
    aliases: string[];
    defaultLocalTime: string;
    fredReleaseId?: number;
  };
}

export interface NormalizedObservation {
  canonicalKey: string;
  provider: string;
  externalSeriesId: string;
  period: Date;
  value: string;
  unit: string;
  frequency: string;
  seasonalAdjustment: string | null;
  vintageAt: Date;
  sourcePublishedAt: Date | null;
  fetchedAt: Date;
  sourceUrl: string | null;
  rawHash: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
}

export interface MacroSeriesRequest {
  externalSeriesId: string;
  from?: Date;
  to?: Date;
  realtimeStart?: Date;
  realtimeEnd?: Date;
}

export interface MacroProvider {
  id: string;
  fetchSeries(request: MacroSeriesRequest): Promise<NormalizedObservation[]>;
  fetchLatest?(request: Omit<MacroSeriesRequest, "from" | "to">): Promise<NormalizedObservation[]>;
  healthCheck(): Promise<void>;
}
