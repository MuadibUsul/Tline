export interface MarketEvent {
  id: string;
  titleEn: string;
  titleZh: string;
  activeFrom: string;
  activeUntil: string;
  keywords: string[];
  tickers: string[];
  sourceUrl: string;
}

export interface RankableView {
  id: string;
  articleId: string;
  asset: string;
  assetTicker: string | null;
  topic: string;
  viewEn: string;
  viewZh: string;
  importance: number;
  article: {
    publishedAt: Date;
    institutionId: string;
    institution: { rating: number; authorityScore: number };
  };
}

export type RankedView<T extends RankableView> = T & {
  rankScore: number;
  heatScore: number;
  authorityScore: number;
  freshnessScore: number;
  crossInstitutionCount: number;
  matchedEvent: MarketEvent | null;
};

const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function keysFor(view: RankableView) {
  return [...new Set([
    view.assetTicker ? `ticker:${view.assetTicker.toUpperCase()}` : "",
    `asset:${normalized(view.asset)}`,
    `topic:${normalized(view.topic)}`,
  ].filter((key) => key && !key.endsWith(":")))];
}

function matchingEvent(view: RankableView, now: Date, events: MarketEvent[]) {
  const text = normalized(`${view.asset} ${view.topic} ${view.viewEn} ${view.viewZh}`);
  return events.find((event) => {
    if (now < new Date(event.activeFrom) || now > new Date(event.activeUntil)) return false;
    if (view.assetTicker && event.tickers.includes(view.assetTicker.toUpperCase())) return true;
    return event.keywords.some((keyword) => text.includes(normalized(keyword)));
  }) ?? null;
}

/** Strict priority: heat first, institution authority second, freshness third. */
export function rankAtomicViews<T extends RankableView>(views: T[], now = new Date(), events: MarketEvent[] = []): RankedView<T>[] {
  const since = now.getTime() - 7 * 864e5;
  const stats = new Map<string, { institutions: Set<string>; articles: Set<string> }>();
  for (const view of views) {
    if (view.article.publishedAt.getTime() < since || view.article.publishedAt > now) continue;
    for (const key of keysFor(view)) {
      const stat = stats.get(key) ?? { institutions: new Set<string>(), articles: new Set<string>() };
      stat.institutions.add(view.article.institutionId);
      stat.articles.add(view.articleId);
      stats.set(key, stat);
    }
  }

  const ranked = views.map((view) => {
    const strongest = keysFor(view).map((key) => stats.get(key)).filter(Boolean)
      .sort((a, b) => (b!.institutions.size - a!.institutions.size) || (b!.articles.size - a!.articles.size))[0];
    const institutions = strongest?.institutions.size ?? 0;
    const articles = strongest?.articles.size ?? 0;
    const matchedEvent = matchingEvent(view, now, events);
    const heatScore = Math.min(100, (matchedEvent ? 50 : 0) + Math.min(40, Math.max(0, institutions - 1) * 15) + Math.min(10, Math.max(0, articles - 1) * 2));
    const authorityScore = Math.round((view.article.institution.authorityScore * 0.7 + view.article.institution.rating / 5 * 0.3) * 100);
    const ageHours = Math.max(0, (now.getTime() - view.article.publishedAt.getTime()) / 36e5);
    const freshnessScore = Math.round(100 * Math.exp(-ageHours / (24 * 7)));
    return { ...view, heatScore, authorityScore, freshnessScore, crossInstitutionCount: institutions, matchedEvent, rankScore: heatScore * 1_000_000 + authorityScore * 1000 + freshnessScore };
  });

  return ranked.sort((a, b) => b.rankScore - a.rankScore || b.importance - a.importance || a.id.localeCompare(b.id));
}
