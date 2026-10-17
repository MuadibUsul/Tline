import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";
import { LOCALES, localePath, type Locale } from "@/lib/i18n";
import { researchPath } from "@/lib/researchPath";
import { assetPath, isPublicAssetTicker } from "@/lib/assetPath";
import { listIndexableTopicsFor, topicPath } from "@/lib/topics";
import { taxonomy } from "@/lib/classification/taxonomy";
import { loadPublicThemes } from "@/lib/marketThemesPublic";

export interface SitemapAlternate { hreflang: string; href: string }
export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  alternates?: SitemapAlternate[];
}

export type SitemapKind = "pages" | "institutions" | "assets" | "topics" | "research" | "news";
export interface SitemapRequest { kind: SitemapKind; locale: Locale; index: number }
export interface SitemapIndexEntry { url: string; lastModified?: Date }

const PAGE_ALTERNATES: Array<{ hreflang: string; locale: Locale }> = [
  { hreflang: "en", locale: "en" },
  { hreflang: "zh-CN", locale: "zh-CN" },
  { hreflang: "x-default", locale: "en" },
];

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
/** One report contributes one URL to a language shard, with ample protocol headroom. */
export const SHARD_SIZE = Math.min(20_000, Math.max(100, Number(process.env.SITEMAP_SHARD_SIZE || 2000)));

const ARTICLE_ORDER = [{ publishedAt: "asc" as const }, { id: "asc" as const }];
const ARTICLE_SELECT = {
  slug: true,
  updatedAt: true,
  indexableEn: true,
  indexableZh: true,
  translations: { where: { locale: "zh-CN" }, take: 1, select: { updatedAt: true } },
} as const;

const changed = (date: string) => new Date(`${date}T00:00:00.000Z`);
const STATIC_ROUTES: Array<{ path: string; changedAt: Date; changeFrequency: SitemapEntry["changeFrequency"]; priority: number }> = [
  { path: "/", changedAt: changed("2026-09-23"), changeFrequency: "hourly", priority: 1 },
  { path: "/research", changedAt: changed("2026-10-04"), changeFrequency: "hourly", priority: 0.9 },
  // The merged subject/institution entrance. The two standalone hubs keep their addresses
  // and remain listed below.
  { path: "/categories", changedAt: changed("2026-10-17"), changeFrequency: "daily", priority: 0.8 },
  // The newsroom stream. Additive: listed once items exist; empty shards are valid.
  { path: "/news", changedAt: changed("2026-10-17"), changeFrequency: "daily", priority: 0.7 },
  { path: "/markets", changedAt: changed("2026-09-20"), changeFrequency: "daily", priority: 0.8 },
  { path: "/institutions", changedAt: changed("2026-10-04"), changeFrequency: "daily", priority: 0.8 },
  { path: "/macro", changedAt: changed("2026-09-27"), changeFrequency: "hourly", priority: 0.8 },
  { path: "/macro/calendar", changedAt: changed("2026-09-27"), changeFrequency: "daily", priority: 0.6 },
  { path: "/topics", changedAt: changed("2026-09-20"), changeFrequency: "daily", priority: 0.7 },
  { path: "/economies", changedAt: changed("2026-09-27"), changeFrequency: "daily", priority: 0.7 },
  // The institution directory (redesign P05). Additive: a new address, listed once it exists.
  { path: "/institutions-directory", changedAt: changed("2026-10-17"), changeFrequency: "daily", priority: 0.7 },
  { path: "/about", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.5 },
  // The public MCP landing page; key issuance itself requires an account.
  { path: "/mcp", changedAt: changed("2026-10-17"), changeFrequency: "monthly", priority: 0.5 },
  { path: "/methodology", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.6 },
  { path: "/editorial-policy", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.5 },
  { path: "/ai-usage", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.5 },
  { path: "/sources", changedAt: changed("2026-09-13"), changeFrequency: "weekly", priority: 0.6 },
  { path: "/privacy", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.5 },
  { path: "/corrections", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.5 },
  { path: "/financial-disclaimer", changedAt: changed("2026-09-13"), changeFrequency: "monthly", priority: 0.4 },
];

const later = (fallback: Date, ...values: Array<Date | null | undefined>) => values.reduce<Date>((latest, value) => value && value > latest ? value : latest, fallback);

/** The languages the stored verdict admits for this report. */
export function indexableSitemapLocales(article: { indexableEn: boolean; indexableZh: boolean }) {
  return LOCALES.filter((locale) => locale === "zh-CN" ? article.indexableZh : article.indexableEn);
}

/**
 * One language's entries, declaring only the alternates that are published too.
 *
 * `available` is the set of languages this path is listed in. It was every language before,
 * which held only while a path was either in both shards or in neither: once a topic or an
 * institution could be published in one language and withheld in the other, the English entry
 * still declared a Chinese alternate — pointing at the very address the Chinese shard had just
 * stopped advertising, and which answers `noindex`. An alternate that is not a page tells a
 * search engine the site has something it does not have.
 */
function localizedEntries(
  locale: Locale,
  entries: Array<Omit<SitemapEntry, "url" | "alternates"> & { path: string; available?: Locale[] }>,
): SitemapEntry[] {
  const base = siteUrl();
  return entries.map(({ path, available, ...entry }) => {
    const languages = available ?? LOCALES;
    return {
      ...entry,
      url: base + localePath(locale, path),
      alternates: PAGE_ALTERNATES
        .filter((alternate) => languages.includes(alternate.locale))
        .map((alternate) => ({ hreflang: alternate.hreflang, href: base + localePath(alternate.locale, path) })),
    };
  });
}

const otherLocale = (locale: Locale): Locale => locale === "en" ? "zh-CN" : "en";

export async function buildPagesSitemap(locale: Locale): Promise<SitemapEntry[]> {
  const [latestArticle, latestConsensus, latestIndicator, latestRelease, indicators, liveThemes, newsColumns] = await Promise.all([
    prisma.article.findFirst({ where: publicationReadyWhere(), orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.consensusHistory.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
    prisma.macroIndicator.findFirst({ where: { enabled: true }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.macroRelease.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, select: { canonicalKey: true, updatedAt: true } }),
    loadPublicThemes(),
    prisma.newsColumn.findMany({
      where: { posts: { some: { status: "published", publishedAt: { lte: new Date() } } } },
      select: {
        slug: true, updatedAt: true,
        posts: { where: { status: "published", publishedAt: { lte: new Date() } }, select: { titleZh: true, titleEn: true } },
      },
    }),
  ]);
  const articleChanged = latestArticle?.updatedAt;
  const macroChanged = later(changed("2026-09-27"), latestIndicator?.updatedAt, latestRelease?.updatedAt);
  const dynamicDates: Record<string, Date | undefined> = {
    "/": later(changed("2026-09-23"), articleChanged, macroChanged),
    "/research": articleChanged,
    "/markets": later(changed("2026-09-20"), articleChanged, latestConsensus?.timestamp),
    "/institutions": articleChanged,
    "/macro": macroChanged,
    "/macro/calendar": latestRelease?.updatedAt,
    "/topics": articleChanged,
    "/economies": articleChanged,
  };
  const pages = STATIC_ROUTES.map((route) => ({
    path: route.path,
    lastModified: later(route.changedAt, dynamicDates[route.path]),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  pages.push(...indicators.map((indicator) => ({
    path: `/macro/indicator/${indicator.canonicalKey}`,
    lastModified: indicator.updatedAt,
    changeFrequency: "daily" as const,
    priority: 0.5,
  })));
  // A recurring desk is a public hub; list it only in a language it actually publishes in.
  pages.push(...newsColumns
    .filter((column) => column.posts.some((post) => (locale === "zh-CN" ? post.titleZh : post.titleEn)))
    .map((column) => ({
      path: `/news/columns/${column.slug}`,
      lastModified: column.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })));
  pages.push(...taxonomy.jurisdictions.map((jurisdiction) => ({
    path: `/economies/${jurisdiction.slug}`,
    lastModified: articleChanged ?? changed("2026-09-27"),
    changeFrequency: "daily" as const,
    priority: 0.6,
  })));
  if (liveThemes.length) pages.push({
    path: "/market-themes",
    lastModified: articleChanged ?? changed("2026-09-13"),
    changeFrequency: "daily",
    priority: 0.7,
  });
  return localizedEntries(locale, pages);
}

export async function buildInstitutionsSitemap(locale: Locale): Promise<SitemapEntry[]> {
  // Same fault as the topics shard: an institution with no report this language may index
  // still had a `noindex` profile page advertised in that language's sitemap.
  const institutions = await prisma.institution.findMany({
    where: { articles: { some: publicationReadyWhere(undefined, locale) } },
    select: {
      slug: true,
      articles: { where: publicationReadyWhere(undefined, locale), orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      forecasts: { where: { status: "settled" }, orderBy: { settledAt: "desc" }, take: 1, select: { settledAt: true } },
    },
  });
  const other = await prisma.institution.findMany({
    where: { articles: { some: publicationReadyWhere(undefined, otherLocale(locale)) } },
    select: { slug: true },
  });
  const otherSlugs = new Set(other.map((row) => row.slug));
  return localizedEntries(locale, institutions.flatMap((institution) => {
    const lastModified = institution.articles[0]?.updatedAt ?? changed("2026-09-17");
    const available = otherSlugs.has(institution.slug) ? LOCALES : [locale];
    return [
      { path: `/institution/${institution.slug}`, lastModified, changeFrequency: "daily" as const, priority: 0.6, available },
      ...(institution.forecasts.length ? [{ path: `/institution/${institution.slug}/accuracy`, lastModified: institution.forecasts[0].settledAt ?? lastModified, changeFrequency: "weekly" as const, priority: 0.5, available }] : []),
    ];
  }));
}

export async function buildAssetsSitemap(locale: Locale): Promise<SitemapEntry[]> {
  const assets = await prisma.asset.findMany({
    where: { articleAssets: { some: { article: publicationReadyWhere() } } },
    select: {
      ticker: true,
      articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true, updatedAt: true } } } },
      consensusHistory: { orderBy: { timestamp: "desc" }, take: 1, select: { timestamp: true } },
    },
  });
  return localizedEntries(locale, assets.flatMap((asset) => {
    if (!isPublicAssetTicker(asset.ticker)) return [];
    if (new Set(asset.articleAssets.map((item) => item.article.institutionId)).size < 2) return [];
    const articleChanged = asset.articleAssets.reduce<Date | undefined>((latest, item) => !latest || item.article.updatedAt > latest ? item.article.updatedAt : latest, undefined);
    return [{
      path: assetPath(asset.ticker),
      lastModified: later(changed("2026-09-20"), articleChanged, asset.consensusHistory[0]?.timestamp),
      changeFrequency: "daily" as const,
      priority: 0.6,
    }];
  }));
}

/**
 * Topics this language's page actually serves.
 *
 * The list used to be built once from corpus-wide counts and then printed for both
 * languages, so a Chinese topic hub whose own page answered `noindex` was still advertised
 * in the Chinese sitemap. Inclusion is now the page's question, asked in the sitemap's own
 * language.
 */
export async function buildTopicsSitemap(locale: Locale): Promise<SitemapEntry[]> {
  const [topics, otherTopics] = await Promise.all([
    listIndexableTopicsFor(locale),
    listIndexableTopicsFor(otherLocale(locale)),
  ]);
  const publishedElsewhere = new Set(otherTopics.map((topic) => topic.key));
  return localizedEntries(locale, topics.map((topic) => ({
    path: topicPath(topic.key),
    lastModified: topic.lastAt,
    changeFrequency: "daily" as const,
    priority: 0.6,
    available: publishedElsewhere.has(topic.key) ? LOCALES : [locale],
  })));
}

/** The newsroom stream, sharded at the same size as reports; only items this language can read. */
export async function newsShardCount(): Promise<number> {
  return Math.max(1, Math.ceil(await prisma.newsPost.count({ where: { status: "published", publishedAt: { lte: new Date() } } }) / SHARD_SIZE));
}

export async function buildNewsSitemap(locale: Locale, index: number): Promise<SitemapEntry[]> {
  const posts = await prisma.newsPost.findMany({
    where: { status: "published", publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: "desc" },
    skip: (index - 1) * SHARD_SIZE,
    take: SHARD_SIZE,
    select: { slug: true, updatedAt: true, titleZh: true, titleEn: true },
  });
  return posts
    .filter((post) => (locale === "zh-CN" ? post.titleZh : post.titleEn))
    .map((post) => {
      const readable = LOCALES.filter((candidate) => (candidate === "zh-CN" ? post.titleZh : post.titleEn));
      const alternates = readable.length > 1
        ? [...readable.map((candidate) => ({ hreflang: candidate, href: siteUrl() + localePath(candidate, `/news/${post.slug}`) })), { hreflang: "x-default", href: siteUrl() + localePath("en", `/news/${post.slug}`) }]
        : undefined;
      return { url: siteUrl() + localePath(locale, `/news/${post.slug}`), lastModified: post.updatedAt, changeFrequency: "daily" as const, priority: 0.6, alternates };
    });
}

export async function researchShardCount(locale: Locale): Promise<number> {
  return Math.max(1, Math.ceil(await prisma.article.count({ where: publicationReadyWhere(undefined, locale) }) / SHARD_SIZE));
}

export async function buildResearchSitemap(locale: Locale, index: number): Promise<SitemapEntry[]> {
  const base = siteUrl();
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere(undefined, locale),
    orderBy: ARTICLE_ORDER,
    skip: (index - 1) * SHARD_SIZE,
    take: SHARD_SIZE,
    select: ARTICLE_SELECT,
  });
  return articles.map((article) => {
    const locales = indexableSitemapLocales(article);
    const alternates: SitemapAlternate[] = locales.map((alternate) => ({ hreflang: alternate, href: base + localePath(alternate, researchPath(article)) }));
    if (locales.includes("en")) alternates.push({ hreflang: "x-default", href: base + localePath("en", researchPath(article)) });
    return {
      url: base + localePath(locale, researchPath(article)),
      lastModified: locale === "zh-CN" ? article.translations[0]?.updatedAt ?? article.updatedAt : article.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
      alternates,
    };
  });
}

const GROUPS: Exclude<SitemapKind, "research" | "news">[] = ["pages", "institutions", "assets", "topics"];
const segment = (locale: Locale) => locale === "zh-CN" ? "zh" : "en";
export function sitemapPath(request: SitemapRequest) {
  const paged = request.kind === "research" || request.kind === "news";
  return `/sitemap/${request.kind}-${segment(request.locale)}${paged ? `-${request.index}` : ""}.xml`;
}

export function parseSitemapShard(value: string): SitemapRequest | null {
  const research = /^research-(en|zh)-(\d+)\.xml$/.exec(value);
  if (research) {
    const index = Number(research[2]);
    return index >= 1 ? { kind: "research", locale: research[1] === "zh" ? "zh-CN" : "en", index } : null;
  }
  const news = /^news-(en|zh)-(\d+)\.xml$/.exec(value);
  if (news) {
    const index = Number(news[2]);
    return index >= 1 ? { kind: "news", locale: news[1] === "zh" ? "zh-CN" : "en", index } : null;
  }
  const group = /^(pages|institutions|assets|topics)-(en|zh)\.xml$/.exec(value);
  return group ? { kind: group[1] as Exclude<SitemapKind, "research" | "news">, locale: group[2] === "zh" ? "zh-CN" : "en", index: 1 } : null;
}

export async function buildSitemapIndex(): Promise<SitemapIndexEntry[]> {
  const base = siteUrl();
  const [enCount, zhCount, newsCount] = await Promise.all([researchShardCount("en"), researchShardCount("zh-CN"), newsShardCount()]);
  const requests: SitemapRequest[] = LOCALES.flatMap((locale) => [
    ...GROUPS.map((kind) => ({ kind, locale, index: 1 })),
    ...Array.from({ length: newsCount }, (_, index) => ({ kind: "news" as const, locale, index: index + 1 })),
    ...Array.from({ length: locale === "en" ? enCount : zhCount }, (_, index) => ({ kind: "research" as const, locale, index: index + 1 })),
  ]);
  return requests.map((request) => ({ url: base + sitemapPath(request) }));
}

export async function buildSitemap(request: SitemapRequest): Promise<SitemapEntry[]> {
  if (request.kind === "pages") return buildPagesSitemap(request.locale);
  if (request.kind === "institutions") return buildInstitutionsSitemap(request.locale);
  if (request.kind === "assets") return buildAssetsSitemap(request.locale);
  if (request.kind === "topics") return buildTopicsSitemap(request.locale);
  if (request.kind === "news") return buildNewsSitemap(request.locale, request.index);
  return buildResearchSitemap(request.locale, request.index);
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);
}

export function renderUrlset(entries: SitemapEntry[]): string {
  if (entries.length > SITEMAP_MAX_URLS) throw new Error(`Sitemap has ${entries.length} URLs; maximum is ${SITEMAP_MAX_URLS}.`);
  const urls = entries.map((entry) => [
    "  <url>",
    `    <loc>${escapeXml(entry.url)}</loc>`,
    ...(entry.alternates ?? []).map((alternate) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`),
    `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`,
    entry.changeFrequency ? `    <changefreq>${entry.changeFrequency}</changefreq>` : null,
    entry.priority === undefined ? null : `    <priority>${entry.priority}</priority>`,
    "  </url>",
  ].filter((line) => line !== null).join("\n")).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
  const bytes = new TextEncoder().encode(xml).byteLength;
  if (bytes > SITEMAP_MAX_BYTES) throw new Error(`Sitemap is ${bytes} bytes; maximum is ${SITEMAP_MAX_BYTES}.`);
  return xml;
}

export function renderSitemapIndex(shards: SitemapIndexEntry[]): string {
  const items = shards.map((shard) => [
    "  <sitemap>",
    `    <loc>${escapeXml(shard.url)}</loc>`,
    shard.lastModified ? `    <lastmod>${shard.lastModified.toISOString()}</lastmod>` : null,
    "  </sitemap>",
  ].filter((line) => line !== null).join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

/** One hour at the edge, a day of stale service if the origin is busy or down. */
export const SITEMAP_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
