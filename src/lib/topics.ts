import { cache } from "react";
import { prisma } from "./db";
import { publicationReadyWhere } from "./publication";
import { LOCALES, domainTerm, type Locale } from "./i18n";
import { legacyTopicRedirectPath } from "./assetPath";

/**
 * Topic hubs, derived from the topics the extraction already stored on each atomic view.
 *
 * The stored value is free text from a model, so it arrives inconsistently cased and
 * punctuated ("Monetary policy", "monetary_policy", "Monetary Policy"). Everything below
 * normalises to one key before counting, or the same subject would produce three hubs.
 *
 * A topic becomes a page only when the corpus really supports one — see the thresholds.
 * Topics below the line are simply not listed anywhere, which is the point: an empty or
 * one-article hub is a page that exists only to hold a keyword.
 */

/** One year of views. Bounded so the grouping query cannot grow into a full-corpus scan. */
const WINDOW_DAYS = Math.max(30, Number(process.env.TOPIC_WINDOW_DAYS || 365));

/** A hub needs several institutions saying different things, not several reports from one. */
export const TOPIC_MIN_INSTITUTIONS = 3;
export const TOPIC_MIN_ARTICLES = 5;

/** Subjects that carry no information as a page of their own. */
const GENERIC = new Set(["", "general", "market", "markets", "other", "unspecified", "macro", "macroeconomics", "economics", "n/a", "none"]);

export function topicKey(raw: string) {
  return raw
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Sentence case, because model output often arrives lower-cased. */
export function topicLabelEn(raw: string) {
  const clean = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
}

/**
 * Chinese topic names. These are terminology, not translation of page content, and only the
 * subjects the corpus actually produces in volume are listed; anything absent falls through
 * to the shared term map and then to the English label rather than guessing.
 */
const TOPIC_ZH: Record<string, string> = {
  "inflation": "通胀",
  "monetary-policy": "货币政策",
  "fed-policy": "美联储政策",
  "federal-reserve": "美联储",
  "central-bank-policy": "央行政策",
  "interest-rates": "利率",
  "rate-cuts": "降息",
  "rate-hikes": "加息",
  "fixed-income": "固定收益",
  "bonds": "债券",
  "treasuries": "美债",
  "yields": "收益率",
  "equities": "股票",
  "equity-market": "股票市场",
  "earnings": "企业盈利",
  "commodities": "大宗商品",
  "oil-prices": "油价",
  "gold": "黄金",
  "currency": "汇率",
  "fx": "外汇",
  "us-dollar": "美元",
  "economic-growth": "经济增长",
  "recession": "衰退",
  "pmi": "采购经理指数",
  "labor-market": "就业市场",
  "employment": "就业",
  "consumption": "消费",
  "trade": "贸易",
  "tariffs": "关税",
  "geopolitical-risk": "地缘政治风险",
  "ai-investment": "AI 投资",
  "ai-labor-market-impact": "AI 对就业的影响",
  "diversification": "资产配置分散",
  "credit": "信用",
  "china": "中国",
  "europe": "欧洲",
  "japan": "日本",
};

export function topicLabel(raw: string, locale: Locale) {
  if (locale === "en") return topicLabelEn(raw);
  return TOPIC_ZH[topicKey(raw)] ?? domainTerm(topicLabelEn(raw), locale, topicLabelEn(raw));
}

export const topicPath = (key: string) => `/topics/${key}`;

export interface TopicStat {
  key: string;
  labelEn: string;
  labelZh: string;
  /** Every spelling the model produced for this subject, so lookups can match them all. */
  raw: string[];
  views: number;
  articles: number;
  institutions: number;
  /** Tickers named by these views, most frequent first. */
  tickers: string[];
  lastAt: Date;
}

/**
 * Coverage kept per language as well as in total.
 *
 * The hub, the topic page and the sitemap used to ask three different questions of the same
 * corpus. The page filtered its articles through `publicationReadyWhere(…, locale)`, so a
 * Chinese hub was withheld unless five *Chinese-indexable* reports carried it; the hub's link
 * list and the sitemap counted every report regardless of language. A topic with ample
 * English coverage and fewer than five Chinese reports therefore appeared in the Chinese
 * sitemap and in the Chinese hub while its own page answered `noindex` — 15 topics, and a
 * sitemap advertising addresses it was simultaneously telling Google to forget. One rule,
 * asked once per language, is the only version of this that cannot drift.
 */
interface LocaleCoverage { views: number; articleIds: Set<string>; institutionIds: Set<string>; lastAt: Date }

interface IndexedTopic extends TopicStat {
  institutionIds: Set<string>;
  articleIds: Set<string>;
  tickerCounts: Map<string, number>;
  byLocale: Record<Locale, LocaleCoverage>;
}

/**
 * One full-window query and an O(rows) grouping pass, answering every topic surface in a
 * request: the hub, each topic page, the sitemap shard. React `cache()` only deduplicates
 * within a single request, so without the memo below every request re-ran the whole thing —
 * and the topics shard of the sitemap re-ran it once per crawl. A short TTL is the honest
 * trade for an aggregate: a report that just went live appears on /research immediately and
 * on its topic hub within minutes, which matches how the hub is used. A write path that
 * needs it sooner calls {@link invalidateTopicIndex}.
 */
const TOPIC_INDEX_TTL_MS = Math.max(60_000, Number(process.env.TOPIC_INDEX_TTL_MS || 300_000));
let topicIndexMemo: { at: number; index: Map<string, IndexedTopic> } | null = null;

/** Drop the memo after a write that moves a topic's counts, so the next read rebuilds. */
export function invalidateTopicIndex() {
  topicIndexMemo = null;
}

const buildTopicIndex = async (): Promise<Map<string, IndexedTopic>> => {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  // Only four scalar columns and the institution id: this groups the whole window, and the
  // article body columns are the ones that have taken the process down before.
  const rows = await prisma.atomicView.findMany({
    where: { reviewStatus: "ok", article: publicationReadyWhere({ publishedAt: { gte: since } }) },
    select: {
      topic: true, articleId: true, assetTicker: true, createdAt: true,
      article: { select: { institutionId: true, indexableEn: true, indexableZh: true } },
    },
  });

  const index = new Map<string, IndexedTopic>();
  for (const row of rows) {
    const raw = row.topic?.trim();
    if (!raw) continue;
    const key = topicKey(raw);
    if (!key || GENERIC.has(key)) continue;
    const entry = index.get(key) ?? {
      key, labelEn: topicLabelEn(raw), labelZh: topicLabel(raw, "zh-CN"), raw: [],
      views: 0, articles: 0, institutions: 0, tickers: [], lastAt: row.createdAt,
      institutionIds: new Set<string>(), articleIds: new Set<string>(), tickerCounts: new Map<string, number>(),
      byLocale: {
        en: { views: 0, articleIds: new Set<string>(), institutionIds: new Set<string>(), lastAt: row.createdAt },
        "zh-CN": { views: 0, articleIds: new Set<string>(), institutionIds: new Set<string>(), lastAt: row.createdAt },
      },
    };
    if (!entry.raw.includes(raw)) entry.raw.push(raw);
    entry.views += 1;
    entry.articleIds.add(row.articleId);
    entry.institutionIds.add(row.article.institutionId);
    if (row.assetTicker) entry.tickerCounts.set(row.assetTicker, (entry.tickerCounts.get(row.assetTicker) ?? 0) + 1);
    if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
    for (const locale of LOCALES) {
      const indexable = locale === "zh-CN" ? row.article.indexableZh : row.article.indexableEn;
      if (!indexable) continue;
      const slice = entry.byLocale[locale];
      slice.views += 1;
      slice.articleIds.add(row.articleId);
      slice.institutionIds.add(row.article.institutionId);
      if (row.createdAt > slice.lastAt) slice.lastAt = row.createdAt;
    }
    index.set(key, entry);
  }

  for (const entry of index.values()) {
    entry.articles = entry.articleIds.size;
    entry.institutions = entry.institutionIds.size;
    entry.tickers = [...entry.tickerCounts.entries()].sort((a, b) => b[1] - a[1]).map(([ticker]) => ticker).slice(0, 12);
  }
  return index;
};

const loadTopicIndex = cache(async (): Promise<Map<string, IndexedTopic>> => {
  if (topicIndexMemo && Date.now() - topicIndexMemo.at < TOPIC_INDEX_TTL_MS) return topicIndexMemo.index;
  const index = await buildTopicIndex();
  topicIndexMemo = { at: Date.now(), index };
  return index;
});

const toStat = (entry: IndexedTopic): TopicStat => ({
  key: entry.key, labelEn: entry.labelEn, labelZh: entry.labelZh, raw: entry.raw,
  views: entry.views, articles: entry.articles, institutions: entry.institutions,
  tickers: entry.tickers, lastAt: entry.lastAt,
});

/** Topics with enough independent coverage to be worth a page, strongest first. */
/**
 * Whether a topic's page is worth indexing in one language.
 *
 * The single rule the topic page, the hub's link list and the sitemap all ask. It is
 * deliberately the *page's* question — five reports this language may index, and at least one
 * usable view — because the page is what a crawler lands on. Anything this admits must be
 * served indexable; anything it refuses must not be advertised anywhere. Asking it per
 * language is what stops a Chinese hub being withheld while the English one is listed.
 */
function topicIndexableIn(entry: IndexedTopic, locale: Locale) {
  const slice = entry.byLocale[locale];
  // The corpus-wide half is not redundant: `getTopicStat` refuses a key that no longer clears
  // the cross-institution bar, and the page answers 404 for a key it refuses. Dropping it here
  // advertised `/en/topics/precious-metals`, which the page had stopped serving.
  return entry.articles >= TOPIC_MIN_ARTICLES
    && entry.institutions >= TOPIC_MIN_INSTITUTIONS
    && slice.articleIds.size >= TOPIC_MIN_ARTICLES
    && slice.views > 0;
}

/** Topics whose page is indexable in `locale`, strongest first. */
export const listIndexableTopicsFor = cache(async (locale: Locale): Promise<TopicStat[]> => {
  const index = await loadTopicIndex();
  return [...index.values()]
    .filter((entry) => !legacyTopicRedirectPath(entry.key) && topicIndexableIn(entry, locale))
    .sort((a, b) => b.byLocale[locale].views - a.byLocale[locale].views || a.key.localeCompare(b.key))
    .map(toStat);
});

/** Every topic with corpus-wide support, for surfaces that are not language-specific. */
export const listIndexableTopics = cache(async (): Promise<TopicStat[]> => {
  const index = await loadTopicIndex();
  return [...index.values()]
    .filter((entry) => !legacyTopicRedirectPath(entry.key) && entry.articles >= TOPIC_MIN_ARTICLES && entry.institutions >= TOPIC_MIN_INSTITUTIONS)
    .sort((a, b) => b.views - a.views || a.key.localeCompare(b.key))
    .map(toStat);
});

/** The last time this topic gained a report this language may index. */
export const topicLastAtFor = cache(async (key: string, locale: Locale): Promise<Date | null> => {
  const entry = (await loadTopicIndex()).get(key);
  return entry ? entry.byLocale[locale].lastAt : null;
});

/** The stat for one key, or null when the corpus does not support a page for it. */
export const getTopicStat = cache(async (key: string): Promise<TopicStat | null> => {
  if (legacyTopicRedirectPath(key)) return null;
  const index = await loadTopicIndex();
  const entry = index.get(key);
  if (!entry || entry.articles < TOPIC_MIN_ARTICLES || entry.institutions < TOPIC_MIN_INSTITUTIONS) return null;
  return toStat(entry);
});

export interface TopicViewRow {
  id: string;
  view: string;
  topic: string;
  direction: string;
  assetTicker: string | null;
  asset: string;
  importance: number;
  createdAt: Date;
  article: { slug: string; title: string; publishedAt: Date; institution: { name: string; slug: string } };
}

/**
 * The views behind one hub, newest and most important first, for the page body.
 * Text is fetched per topic rather than with the index, so the index stays cheap.
 */
export const getTopicViews = cache(async (key: string, locale: Locale, take = 12): Promise<TopicViewRow[]> => {
  const index = await loadTopicIndex();
  const entry = index.get(key);
  if (!entry) return [];
  const rows = await prisma.atomicView.findMany({
    where: { reviewStatus: "ok", topic: { in: entry.raw }, article: publicationReadyWhere() },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true, viewEn: true, viewZh: true, topic: true, direction: true, assetTicker: true, asset: true,
      importance: true, createdAt: true,
      article: { select: { slug: true, title: true, publishedAt: true, institution: { select: { name: true, slug: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    view: locale === "zh-CN" ? row.viewZh : row.viewEn,
    topic: row.topic,
    direction: row.direction,
    assetTicker: row.assetTicker,
    asset: row.asset,
    importance: row.importance,
    createdAt: row.createdAt,
    article: {
      slug: row.article.slug, title: row.article.title, publishedAt: row.article.publishedAt,
      institution: { name: row.article.institution.name, slug: row.article.institution.slug },
    },
  }));
});

/** Article ids that carry views for this topic, for the research list on the hub. */
export const getTopicArticleIds = cache(async (key: string): Promise<string[]> => {
  const index = await loadTopicIndex();
  return [...(index.get(key)?.articleIds ?? [])];
});
