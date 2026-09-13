export type ThemeDirection = "bullish" | "bearish" | "neutral" | "conditional";
export type ThemeStatus = "strengthening" | "active" | "diverging" | "cooling";

export interface ThemeView {
  id: string;
  articleId: string;
  topic: string;
  asset: string;
  assetTicker: string | null;
  direction: string;
  importance: number;
  viewEn: string;
  viewZh: string;
  rationaleEn: string | null;
  rationaleZh: string | null;
  conditionEn: string | null;
  conditionZh: string | null;
  article: {
    slug: string;
    title: string;
    publishedAt: Date;
    institutionId: string;
    institution: { slug: string; name: string; rating: number; authorityScore: number };
  };
}

export interface ThemeMarketMove {
  symbol: string;
  changePct: number;
}

const NAMED_THEMES = [
  ["ai-capex", /\b(?:ai|artificial intelligence|data cent(?:er|re)|semiconductor|compute)\b/i, "AI Capex", "AI 资本开支"],
  ["inflation", /\b(?:inflation|disinflation|cpi|ppi|prices?)\b/i, "Inflation", "通胀"],
  ["rates", /\b(?:interest rates?|monetary|central bank|fed|fomc|ecb|boj|boe|yields?)\b/i, "Rates & Central Banks", "利率与央行"],
  ["growth", /\b(?:gdp|growth|recession|activity|business cycle)\b/i, "Growth Cycle", "增长周期"],
  ["fiscal", /\b(?:fiscal|deficit|government spending|public spending)\b/i, "Fiscal Policy", "财政政策"],
  ["energy", /\b(?:energy|oil|gas|opec|brent|wti)\b/i, "Energy", "能源"],
  ["fx", /\b(?:fx|foreign exchange|exchange rate|currenc|dollar|euro|yen)\b/i, "Foreign Exchange", "外汇"],
  ["credit", /\b(?:credit|spread|default|high yield|investment grade)\b/i, "Credit Cycle", "信用周期"],
  ["trade", /\b(?:tariff|trade war|geopolit|sanction)\b/i, "Trade & Geopolitics", "贸易与地缘政治"],
  ["property", /\b(?:housing|property|real estate|construction|renovation)\b/i, "Property & Construction", "地产与建筑"],
  ["macro-regime", /\b(?:macro|macroeconomic|global economy)\b/i, "Macro Regime", "宏观环境"],
] as const;

const clean = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const GENERIC_KEYS = new Set(["general", "market", "other", "unspecified"]);

function identity(topic: string, text: string) {
  const sample = `${topic} ${text}`;
  const named = NAMED_THEMES.find(([, pattern]) => pattern.test(sample));
  if (named) return { key: named[0], titleEn: named[2], titleZh: named[3] };
  const key = clean(topic).replace(/\b(?:risk|risks|driver|drivers|outlook|macro)\b/g, "").trim() || clean(topic);
  return { key: key || "other", titleEn: topic || "Other market logic", titleZh: topic || "其他市场逻辑" };
}

const tone = (direction: string): ThemeDirection =>
  direction === "bullish" || direction === "bearish" || direction === "conditional" ? direction : "neutral";

export function buildTradingThemes(views: ThemeView[], now = new Date(), marketMoves: ThemeMarketMove[] = []) {
  const currentSince = now.getTime() - 7 * 864e5;
  const previousSince = now.getTime() - 14 * 864e5;
  const groups = new Map<string, { identity: ReturnType<typeof identity>; current: ThemeView[]; previous: ThemeView[] }>();

  for (const view of views) {
    const published = view.article.publishedAt.getTime();
    if (published < previousSince || published > now.getTime()) continue;
    const theme = identity(view.topic, `${view.viewEn} ${view.viewZh}`);
    if (GENERIC_KEYS.has(theme.key)) continue;
    const group = groups.get(theme.key) ?? { identity: theme, current: [], previous: [] };
    (published >= currentSince ? group.current : group.previous).push(view);
    groups.set(theme.key, group);
  }

  const moves = new Map(marketMoves.map((move) => [move.symbol.toUpperCase(), move.changePct]));
  return [...groups.values()].filter((group) => group.current.length > 0).map((group) => {
    const current = group.current.sort((a, b) =>
      b.importance - a.importance || b.article.publishedAt.getTime() - a.article.publishedAt.getTime());
    const institutions = new Set(current.map((view) => view.article.institutionId));
    const bullish = current.filter((view) => view.direction === "bullish").length;
    const bearish = current.filter((view) => view.direction === "bearish").length;
    const direction: ThemeDirection = bullish && bearish ? "conditional" : bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : tone(current[0].direction);
    const assets = new Map<string, { ticker: string | null; name: string; bullish: number; bearish: number; views: number; movePct: number | null }>();
    for (const view of current) {
      const key = view.assetTicker?.toUpperCase() || clean(view.asset);
      if (!key || GENERIC_KEYS.has(clean(view.asset))) continue;
      const asset = assets.get(key) ?? { ticker: view.assetTicker?.toUpperCase() ?? null, name: view.asset, bullish: 0, bearish: 0, views: 0, movePct: view.assetTicker ? moves.get(view.assetTicker.toUpperCase()) ?? null : null };
      asset.views++;
      if (view.direction === "bullish") asset.bullish++;
      if (view.direction === "bearish") asset.bearish++;
      assets.set(key, asset);
    }
    const assetList = [...assets.values()].sort((a, b) => b.views - a.views).slice(0, 5).map((asset) => ({
      ...asset,
      direction: asset.bullish > asset.bearish ? "bullish" as const : asset.bearish > asset.bullish ? "bearish" as const : "neutral" as const,
      marketConfirmed: asset.movePct === null || asset.bullish === asset.bearish ? null : (asset.movePct > 0) === (asset.bullish > asset.bearish),
    }));
    const confirmations = assetList.filter((asset) => asset.marketConfirmed !== null);
    const confirmation = confirmations.length ? confirmations.filter((asset) => asset.marketConfirmed).length / confirmations.length : null;
    const latestAt = current.reduce((latest, view) => view.article.publishedAt > latest ? view.article.publishedAt : latest, current[0].article.publishedAt);
    const freshness = Math.exp(-Math.max(0, now.getTime() - latestAt.getTime()) / (3 * 864e5));
    const averageImportance = current.reduce((sum, view) => sum + view.importance, 0) / current.length;
    const breadthScore = Math.min(30, institutions.size * 6);
    const densityScore = Math.min(20, Math.log2(current.length + 1) * 3);
    const importanceScore = Math.min(25, averageImportance * 5);
    const freshnessScore = freshness * 15;
    const marketScore = (confirmation ?? 0.5) * 10;
    const score = Math.round(breadthScore + densityScore + importanceScore + freshnessScore + marketScore);
    const status: ThemeStatus = bullish > 0 && bearish > 0 ? "diverging"
      : current.length > group.previous.length || institutions.size >= 2 ? "strengthening"
      : group.previous.length > current.length ? "cooling" : "active";
    return {
      key: group.identity.key,
      titleEn: group.identity.titleEn,
      titleZh: group.identity.titleZh,
      score,
      status,
      direction,
      latestAt,
      viewCount: current.length,
      previousViewCount: group.previous.length,
      institutionCount: institutions.size,
      assets: assetList,
      marketConfirmation: confirmation,
      lead: current[0],
      evidence: current.filter((view, index, list) => list.findIndex((candidate) => candidate.articleId === view.articleId) === index).slice(0, 3),
    };
  }).sort((a, b) => b.score - a.score || b.latestAt.getTime() - a.latestAt.getTime()).slice(0, 8);
}
