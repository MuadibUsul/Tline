import { prisma } from "./db";
import { ASSETS } from "./assets";
import { assetName, domainTerm, institutionName, localizeChineseContent, type Locale } from "./i18n";

export type SearchResultKind = "institution" | "asset" | "article";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  snippet?: string;
  href: string;
  publishedAt?: string;
}

export interface SearchCandidate {
  result: SearchResult;
  primary: string[];
  aliases?: string[];
  secondary?: string[];
  content?: string[];
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

function scoreText(query: string, value: string) {
  const q = normalizeSearchText(query);
  const text = normalizeSearchText(value);
  if (!q || !text) return 0;
  if (text === q) return 160;
  if (text.startsWith(q)) return 125;
  if (text.includes(q)) return 105;

  const compactQ = q.replace(/\s/g, "");
  const compactText = text.replace(/\s/g, "");
  if (compactText.includes(compactQ)) return 95;

  const queryWords = q.split(" ");
  const words = text.split(" ");
  let total = 0;
  let matched = 0;
  for (const term of queryWords) {
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
  if (matched === queryWords.length) return total / queryWords.length;

  const dice = compactQ.length >= 4 && compactText.length <= 240 ? diceSimilarity(compactQ, compactText) : 0;
  return dice >= 0.45 ? dice * 36 : 0;
}

function candidateScore(query: string, candidate: SearchCandidate) {
  const max = (values: string[] | undefined, weight: number) =>
    Math.max(0, ...(values ?? []).map((value) => scoreText(query, value) * weight));
  const combined = [
    ...candidate.primary,
    ...(candidate.aliases ?? []),
    ...(candidate.secondary ?? []),
    ...(candidate.content ?? []),
  ].join(" ");
  const score = Math.max(
    max(candidate.primary, 4),
    max(candidate.aliases, 3.4),
    max(candidate.secondary, 2),
    max(candidate.content, 0.75),
    scoreText(query, combined) * 1.35,
  );
  return candidate.result.kind === "article" ? score : score * 1.2;
}

export function rankSearchCandidates(query: string, candidates: SearchCandidate[], limit = 12) {
  return candidates
    .map((candidate) => ({ candidate, score: candidateScore(query, candidate) }))
    .filter(({ score }) => score >= 18)
    .sort((a, b) => b.score - a.score ||
      (b.candidate.result.publishedAt ?? "").localeCompare(a.candidate.result.publishedAt ?? ""))
    .slice(0, limit)
    .map(({ candidate }) => candidate.result);
}

function parseAliases(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function snippet(values: Array<string | null | undefined>, query: string) {
  const text = values.find((value) => value?.trim())?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = index > 70 ? index - 60 : 0;
  const excerpt = text.slice(start, start + 190).trim();
  return `${start ? "…" : ""}${excerpt}${start + 190 < text.length ? "…" : ""}`;
}

export async function searchSite(query: string, limit = 12, locale: Locale = "en"): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 120);
  if (normalizeSearchText(q).length < 2) return [];
  const useChinese = locale === "zh-CN";

  const [institutions, assets, articles] = await Promise.all([
    prisma.institution.findMany({
      select: { id: true, slug: true, name: true, country: true, _count: { select: { articles: true } } },
    }),
    prisma.asset.findMany({
      select: { id: true, ticker: true, name: true, assetClass: true, aliases: true, _count: { select: { articleAssets: true } } },
    }),
    prisma.article.findMany({
      orderBy: { publishedAt: "desc" },
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
        atomicViews: { select: { viewEn: true, viewZh: true, asset: true, assetTicker: true, topic: true, type: true, direction: true, timeHorizon: true, value: true } },
      },
    }),
  ]);

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
    })),
    ...assets.map((asset) => {
      const canonicalAliases = ASSETS.find((definition) => definition.ticker === asset.ticker)?.aliases ?? [];
      return {
        result: {
          id: asset.id,
          kind: "asset" as const,
          title: `${assetName(asset.name, locale, asset.ticker)} · ${asset.ticker}`,
          subtitle: `${domainTerm(asset.assetClass, locale)} · ${asset._count.articleAssets} ${useChinese ? "篇相关研报" : "related reports"}`,
          href: `/asset/${asset.ticker}`,
        },
        primary: [asset.name, asset.ticker],
        aliases: [...new Set([...parseAliases(asset.aliases), ...canonicalAliases])],
      };
    }),
    ...articles.map((article) => {
      const translation = article.translations[0];
      const title = useChinese ? localizeChineseContent(translation?.title ?? "中文译文待处理") : article.title;
      const assetTerms = article.articleAssets.flatMap(({ asset }) => [
        asset.name,
        asset.ticker,
        ...parseAliases(asset.aliases),
        ...(ASSETS.find((definition) => definition.ticker === asset.ticker)?.aliases ?? []),
      ]);
      const atomicText = article.atomicViews.flatMap((view) => [view.viewEn, view.viewZh, view.asset, view.assetTicker ?? "", view.topic, view.type, view.direction, view.timeHorizon, view.value ?? ""]);
      return {
        result: {
          id: article.id,
          kind: "article" as const,
          title,
          subtitle: institutionName(article.institution.name, locale),
          snippet: snippet(useChinese
            ? [...article.atomicViews.map((view) => view.viewZh), article.analysis?.summaryZh, translation?.text, translation?.title, article.analysis?.summary, article.rawText]
            : [...article.atomicViews.map((view) => view.viewEn), article.analysis?.summary, article.rawText, translation?.text], q),
          href: `/research/${article.id}`,
          publishedAt: article.publishedAt.toISOString(),
        },
        primary: [article.title, translation?.title ?? ""],
        aliases: [...assetTerms, ...article.atomicViews.flatMap((view) => [view.asset, view.assetTicker ?? "", view.topic])],
        secondary: [article.institution.name, article.institution.slug, article.author ?? ""],
        content: [article.analysis?.summary ?? "", article.analysis?.summaryZh ?? "", article.rawText ?? "", translation?.text ?? "", ...atomicText],
      };
    }),
  ];

  return rankSearchCandidates(q, candidates, limit);
}
