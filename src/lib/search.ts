import { prisma } from "./db";
import { ASSETS } from "./assets";
import { publicationReadyWhere } from "./publication";
import { assetName, domainTerm, institutionName, localizeChineseContent, type Locale } from "./i18n";
import { hasChinese, looksLikePinyinQuery, pinyinForms, scorePinyin, type PinyinForms } from "./pinyin";

const ASSET_BY_TICKER = new Map(ASSETS.map((asset) => [asset.ticker, asset]));

export type SearchResultKind = "institution" | "asset" | "article" | "view";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  /** Set on view results: the report a view was extracted from, used to keep one report
   * from filling the list with its own views. */
  articleId?: string;
  title: string;
  subtitle: string;
  snippet?: string;
  snippetMatch?: string;
  matchKind?: "content";
  href: string;
  publishedAt?: string;
}

export interface SearchCandidate {
  result: SearchResult;
  primary: string[];
  aliases?: string[];
  secondary?: string[];
  content?: string[];
  normalizedContent?: string;
  contentWords?: string[];
  contentTrigrams?: Set<string>;
  combinedTrigrams?: Set<string>;
  normalizedPrimary?: string[];
  normalizedAliases?: string[];
  normalizedSecondary?: string[];
  normalizedCombined?: string;
  compactContent?: string;
  /** Display names as the reader sees them, kept apart from the composed result title
   * so a ticker appended for display cannot dilute the name's pronunciation. */
  displayNames?: string[];
  /** Pronunciations of the naming fields, so a Latin-keyboard query can reach them. */
  pinyin?: PinyinForms[];
}

interface PreparedQuery {
  normalized: string;
  compact: string;
  words: string[];
  trigrams?: string[];
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function bigrams(value: string) {
  const compact = value.replace(/\s/g, "");
  const result: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) result.push(compact.slice(i, i + 2));
  return result;
}

function trigrams(value: string) {
  const result: string[] = [];
  for (let i = 0; i < value.length - 2; i += 1) result.push(value.slice(i, i + 3));
  return result;
}

function prepareQuery(value: string): PreparedQuery {
  const normalized = normalizeSearchText(value);
  return {
    normalized,
    compact: normalized.replace(/\s/g, ""),
    words: normalized.split(" "),
    trigrams: /^[a-z0-9]{4,}$/i.test(normalized) ? trigrams(normalized) : undefined,
  };
}

function diceSimilarity(a: string, b: string) {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.length || !bb.length) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const pair of bb) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let overlap = 0;
  for (const pair of aa) {
    const count = counts.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * overlap) / (aa.length + bb.length);
}

function scoreNormalizedText(query: PreparedQuery, text: string, cachedWords?: string[], cachedTrigrams?: Set<string>, cachedCompact?: string) {
  const q = query.normalized;
  if (!q || !text) return 0;
  if (text === q) return 160;
  if (text.startsWith(q)) return 125;
  if (text.includes(q)) return 105;

  const compactText = cachedCompact ?? text.replace(/\s/g, "");
  if (compactText.includes(query.compact)) return 95;

  if (cachedTrigrams && query.trigrams) {
    const overlap = query.trigrams.filter((part) => cachedTrigrams.has(part)).length;
    if (overlap < Math.ceil(query.trigrams.length / 2)) return 0;
  }

  const words = cachedWords ?? text.split(" ");
  let total = 0;
  let matched = 0;
  for (const term of query.words) {
    let best = 0;
    for (const word of words) {
      if (word === term) best = Math.max(best, 48);
      else if (word.startsWith(term) || (word.length >= 3 && term.startsWith(word))) best = Math.max(best, 40);
      else if (word.includes(term)) best = Math.max(best, 32);
      else if (/^[a-z0-9]+$/i.test(term) && term.length >= 3 && word.length >= 3) {
        const limit = term.length <= 5 ? 1 : 2;
        const distance = Math.abs(term.length - word.length) <= limit ? editDistance(term, word) : limit + 1;
        if (distance <= limit) best = Math.max(best, 30 - distance * 6);
      }
    }
    if (best) {
      matched += 1;
      total += best;
    }
  }
  if (matched === query.words.length) return total / query.words.length;

  const dice = query.compact.length >= 4 && compactText.length <= 240 ? diceSimilarity(query.compact, compactText) : 0;
  return dice >= 0.45 ? dice * 36 : 0;
}

function prepareCandidate(candidate: SearchCandidate) {
  if (candidate.normalizedPrimary) return;
  candidate.normalizedPrimary = candidate.primary.map(normalizeSearchText);
  candidate.normalizedAliases = (candidate.aliases ?? []).map(normalizeSearchText);
  candidate.normalizedSecondary = (candidate.secondary ?? []).map(normalizeSearchText);
  candidate.normalizedCombined = [...candidate.normalizedPrimary, ...candidate.normalizedAliases, ...candidate.normalizedSecondary].join(" ");
  candidate.normalizedContent = normalizeSearchText((candidate.content ?? []).join(" "));
  candidate.compactContent = candidate.normalizedContent.replace(/\s/g, "");
  candidate.contentWords = [...new Set(candidate.normalizedContent.split(" "))];
  candidate.contentTrigrams = new Set(candidate.contentWords.flatMap(trigrams));
  candidate.combinedTrigrams = new Set(trigrams(candidate.normalizedCombined));
}

function candidateScore(query: PreparedQuery, candidate: SearchCandidate) {
  prepareCandidate(candidate);
  if (query.trigrams) {
    let overlap = 0;
    for (const part of query.trigrams) {
      if (candidate.contentTrigrams!.has(part) || candidate.combinedTrigrams!.has(part)) overlap += 1;
    }
    if (overlap < Math.ceil(query.trigrams.length / 2)) return 0;
  }
  const max = (values: string[] | undefined, weight: number) =>
    Math.max(0, ...(values ?? []).map((value) => scoreNormalizedText(query, value) * weight));
  const score = Math.max(
    max(candidate.normalizedPrimary, 4),
    max(candidate.normalizedAliases, 3.4),
    max(candidate.normalizedSecondary, 2),
    scoreNormalizedText(query, candidate.normalizedContent!, candidate.contentWords, candidate.contentTrigrams, candidate.compactContent) * 0.75,
    scoreNormalizedText(query, candidate.normalizedCombined!) * 1.35,
  );
  const isEntity = candidate.result.kind === "institution" || candidate.result.kind === "asset";
  return isEntity ? score * 1.2 : score;
}

/**
 * The best pronunciation match among a candidate's names.
 *
 * Only consulted for a query that is plain Latin letters: Chinese text is matched
 * directly, and a query with digits or punctuation is not someone typing pinyin.
 */
// A pronunciation match is a match on the name, so it is weighted as one. Below that it
// lost to an incidental English match: "yuanyou" begins with the word "yuan", which was
// enough to put currency commentary above the oil contract the reader asked for.
const PINYIN_NAME_WEIGHT = 4;

function pinyinScore(query: string, candidate: SearchCandidate) {
  if (!candidate.pinyin?.length || !looksLikePinyinQuery(query)) return 0;
  let best = 0;
  for (const forms of candidate.pinyin) best = Math.max(best, scorePinyin(query, forms));
  if (best === 0) return 0;
  // The same preference text matching applies: an asset outranks the reports that merely
  // mention it, whichever script the reader typed.
  const isEntity = candidate.result.kind === "institution" || candidate.result.kind === "asset";
  return best * PINYIN_NAME_WEIGHT * (isEntity ? 1.2 : 1);
}

// A report carrying a dozen views on the searched asset would otherwise fill the whole
// list with itself and bury every other source.
const MAX_VIEWS_PER_ARTICLE = 2;

export function rankSearchCandidates(query: string, candidates: SearchCandidate[], limit = 12) {
  const preparedQuery = prepareQuery(query);
  const perArticle = new Map<string, number>();
  return candidates
    .map((candidate) => ({
      candidate,
      score: Math.max(candidateScore(preparedQuery, candidate), pinyinScore(preparedQuery.normalized, candidate)),
    }))
    .filter(({ score }) => score >= 18)
    .sort((a, b) => b.score - a.score ||
      (b.candidate.result.publishedAt ?? "").localeCompare(a.candidate.result.publishedAt ?? ""))
    .filter(({ candidate }) => {
      const article = candidate.result.kind === "view" ? candidate.result.articleId : undefined;
      if (!article) return true;
      const used = perArticle.get(article) ?? 0;
      if (used >= MAX_VIEWS_PER_ARTICLE) return false;
      perArticle.set(article, used + 1);
      return true;
    })
    .slice(0, limit)
    .map(({ candidate }) => {
      const context = matchingSnippet(candidate.content, query);
      return context
        ? { ...candidate.result, snippet: context.text, snippetMatch: context.match, matchKind: "content" as const }
        : candidate.result;
    });
}

function parseAliases(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function matchingSnippet(values: Array<string | null | undefined> | undefined, query: string) {
  const texts = (values ?? []).map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean);
  const lowerQuery = query.trim().toLocaleLowerCase();
  const exact = texts.map((text) => ({ text, index: text.toLocaleLowerCase().indexOf(lowerQuery) })).find(({ index }) => index >= 0);
  let best = exact ? { ...exact, match: exact.text.slice(exact.index, exact.index + lowerQuery.length), score: 160 } : undefined;

  if (!best) {
    const preparedQuery = prepareQuery(query);
    for (const text of texts) {
      for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const score = scoreNormalizedText(preparedQuery, normalizeSearchText(word[0]));
        if (score >= 24 && (!best || score > best.score)) best = { text, index: word.index ?? 0, match: word[0], score };
      }
    }
  }
  if (!best) return undefined;
  const start = best.index > 70 ? best.index - 60 : 0;
  const excerpt = best.text.slice(start, start + 190).trim();
  return {
    text: `${start ? "…" : ""}${excerpt}${start + 190 < best.text.length ? "…" : ""}`,
    match: best.match,
  };
}

// The index holds every article's full body in memory, so it is bounded explicitly.
// Beyond this the oldest articles fall out of search rather than the process falling over.
const INDEX_MAX_ARTICLES = Math.max(100, Number(process.env.SEARCH_INDEX_MAX_ARTICLES || 1000));

const loadSearchData = async () => Promise.all([
    prisma.institution.findMany({
      select: { id: true, slug: true, name: true, country: true, _count: { select: { articles: { where: publicationReadyWhere() } } } },
    }),
    prisma.asset.findMany({
      select: { id: true, ticker: true, name: true, assetClass: true, aliases: true, _count: { select: { articleAssets: { where: { article: publicationReadyWhere() } } } } },
    }),
    prisma.article.findMany({
      where: publicationReadyWhere(),
      orderBy: { publishedAt: "desc" },
      take: INDEX_MAX_ARTICLES,
      select: {
        id: true,
        title: true,
        author: true,
        rawText: true,
        publishedAt: true,
        institution: { select: { name: true, slug: true } },
        analysis: { select: { summary: true, summaryZh: true } },
        translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } },
        articleAssets: { select: { asset: { select: { ticker: true, name: true, aliases: true } } } },
        atomicViews: { select: { id: true, viewEn: true, viewZh: true, asset: true, assetTicker: true, topic: true, type: true, direction: true, timeHorizon: true, value: true, rationaleEn: true, rationaleZh: true, conditionEn: true, conditionZh: true, confidence: true } },
      },
    }),
  ]);

// ponytail: an in-process index fits the current corpus; use database full-text search at tens of thousands of articles.
const candidateCache = new Map<Locale, { version: string; candidates: SearchCandidate[] }>();
const indexBuilds = new Map<string, Promise<SearchCandidate[]>>();

// How long a computed version fingerprint is trusted before it is probed again. The
// fingerprint itself is cheap; rebuilding the index is not — so the probe is throttled
// and the rebuild happens only when the data genuinely moved.
const VERSION_PROBE_TTL_MS = Math.max(1_000, Number(process.env.SEARCH_VERSION_PROBE_MS || 10_000));
let versionProbe: { checkedAt: number; version: string } | null = null;

/**
 * Fingerprint of everything the index reads. Counts catch deletions, the max timestamps
 * catch inserts and edits, and document readiness is included because it decides whether
 * an article is publishable at all.
 */
async function dataVersion(): Promise<string> {
  const now = Date.now();
  if (versionProbe && now - versionProbe.checkedAt < VERSION_PROBE_TTL_MS) return versionProbe.version;
  const [articles, views, newestArticle, newestTranslation, newestDocument, newestAnalysis] = await Promise.all([
    prisma.article.count(),
    prisma.atomicView.count(),
    prisma.article.aggregate({ _max: { updatedAt: true } }),
    prisma.articleTranslation.aggregate({ _max: { updatedAt: true } }),
    prisma.articleDocument.aggregate({ _max: { updatedAt: true } }),
    prisma.analysis.aggregate({ _max: { updatedAt: true } }),
  ]);
  const version = [
    articles,
    views,
    newestArticle._max.updatedAt?.getTime() ?? 0,
    newestTranslation._max.updatedAt?.getTime() ?? 0,
    newestDocument._max.updatedAt?.getTime() ?? 0,
    newestAnalysis._max.updatedAt?.getTime() ?? 0,
  ].join(":");
  versionProbe = { checkedAt: now, version };
  return version;
}

/** Invalidate immediately after a write in this process, without waiting for the probe. */
export function invalidateSearchIndex() {
  candidateCache.clear();
  versionProbe = null;
}

export async function searchSite(query: string, limit = 12, locale: Locale = "en"): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 120);
  if (normalizeSearchText(q).length < 2) return [];
  const useChinese = locale === "zh-CN";
  const version = await dataVersion();
  const cached = candidateCache.get(locale);
  if (cached && cached.version === version) return rankSearchCandidates(q, cached.candidates, limit);
  const buildKey = `${locale}:${version}`;
  const existingBuild = indexBuilds.get(buildKey);
  if (existingBuild) return rankSearchCandidates(q, await existingBuild, limit);
  const build = (async () => {
    const [institutions, assets, articles] = await loadSearchData();

    const candidates: SearchCandidate[] = [
    ...institutions.map((institution) => ({
      result: {
        id: institution.id,
        kind: "institution" as const,
        title: institutionName(institution.name, locale),
        subtitle: [institution.country, `${institution._count.articles} ${useChinese ? "篇研报" : "reports"}`].filter(Boolean).join(" · "),
        href: `/institution/${institution.slug}`,
      },
      primary: [institution.name, institution.slug],
      displayNames: [institutionName(institution.name, locale)],
    })),
    ...assets.map((asset) => {
      const canonicalAliases = ASSET_BY_TICKER.get(asset.ticker)?.aliases ?? [];
      return {
        result: {
          id: asset.id,
          kind: "asset" as const,
          title: `${assetName(asset.name, locale, asset.ticker)} · ${asset.ticker}`,
          subtitle: `${domainTerm(asset.assetClass, locale)} · ${asset._count.articleAssets} ${useChinese ? "篇相关研报" : "related reports"}`,
          href: `/asset/${asset.ticker}`,
        },
        primary: [asset.name, asset.ticker],
        displayNames: [assetName(asset.name, locale, asset.ticker)],
        aliases: [...new Set([...parseAliases(asset.aliases), ...canonicalAliases])],
      };
    }),
    ...articles.flatMap((article): SearchCandidate[] => {
      const translation = article.translations[0];
      const title = useChinese && translation ? localizeChineseContent(translation.title) : article.title;
      const assetTerms = article.articleAssets.flatMap(({ asset }) => [
        asset.name,
        asset.ticker,
        ...parseAliases(asset.aliases),
        ...(ASSET_BY_TICKER.get(asset.ticker)?.aliases ?? []),
      ]);
      const atomicText = article.atomicViews.flatMap((view) => [view.viewEn, view.viewZh, view.asset, view.assetTicker ?? "", view.topic, view.type, view.direction, view.timeHorizon, view.value ?? ""]);
      const institution = institutionName(article.institution.name, locale);
      return [{
        result: {
          id: article.id,
          kind: "article" as const,
          title,
          subtitle: institution,
          href: `/research/${article.id}`,
          publishedAt: article.publishedAt.toISOString(),
        },
        primary: [article.title, translation?.title ?? ""],
        aliases: [...assetTerms, ...article.atomicViews.flatMap((view) => [view.asset, view.assetTicker ?? "", view.topic])],
        secondary: [article.institution.name, article.institution.slug, article.author ?? ""],
        content: [article.analysis?.summary ?? "", article.analysis?.summaryZh ?? "", article.rawText ?? "", translation?.text ?? "", ...atomicText],
      },
      // Each extracted view is searchable in its own right: someone looking for "gold"
      // usually wants the stance an institution took, not only the report carrying it.
      ...article.atomicViews.flatMap((view): SearchCandidate[] => {
        const text = (useChinese ? view.viewZh || view.viewEn : view.viewEn || view.viewZh).trim();
        if (!text) return [];
        const asset = assetName(view.asset, locale, view.assetTicker, "相关资产");
        // The view stores its asset in English, so a Chinese query only reaches it
        // through the dictionary aliases for that one ticker. Taking the parent report's
        // whole asset list instead would let an oil view answer a query about gold.
        const definition = ASSET_BY_TICKER.get(view.assetTicker ?? "");
        return [{
          result: {
            id: view.id,
            kind: "view" as const,
            articleId: article.id,
            title: text,
            subtitle: [institution, asset, domainTerm(view.direction, locale), view.timeHorizon].filter(Boolean).join(" · "),
            // Views have no page of their own; the site links them to their report, and
            // so does this.
            href: `/research/${article.id}`,
            publishedAt: article.publishedAt.toISOString(),
          },
          primary: [view.viewEn, view.viewZh],
          // Only this view's own asset: inheriting the report's other tickers would make
          // an oil view answer a query about gold just because they shared a report.
          aliases: [view.asset, view.assetTicker ?? "", view.topic, ...(definition ? [definition.name, ...definition.aliases] : [])],
          secondary: [article.institution.name, view.type, view.direction, view.timeHorizon, view.value ?? ""],
          content: [view.rationaleEn ?? "", view.rationaleZh ?? "", view.conditionEn ?? "", view.conditionZh ?? ""],
        }];
      })];
    }),
  ];

    for (const candidate of candidates) {
    // Names only. Running the whole body through a dictionary would cost far more than it
    // could return: nobody searches an article's twentieth paragraph by its sound.
    const names = [...(candidate.displayNames ?? []), ...candidate.primary, ...(candidate.aliases ?? [])]
      .filter((value) => value && hasChinese(value));
    if (names.length) candidate.pinyin = [...new Set(names)].map(pinyinForms);
    prepareCandidate(candidate);
    }
    return candidates;
  })();
  indexBuilds.set(buildKey, build);

  try {
    const candidates = await build;
    candidateCache.set(locale, { version, candidates });
    return rankSearchCandidates(q, candidates, limit);
  } finally {
    indexBuilds.delete(buildKey);
  }
}

/** Build both per-locale indexes before the first user query. */
export async function warmSearchIndex() {
  await searchSite("search", 1, "en");
  await searchSite("搜索", 1, "zh-CN");
}
