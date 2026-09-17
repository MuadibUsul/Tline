import type { Metadata } from "next";
import { LOCALES, localePath, type Locale } from "./i18n";
import { ORGANIZATION_ID_PATH, SITE_NAME, SITE_NAME_ZH, siteUrl } from "./site";

/**
 * The parts of a page's metadata that are the same reasoning everywhere.
 *
 * Two things were missing across the site and are worth having on every page rather than
 * on the ones someone remembered: a canonical URL, so a report reached with a tracking
 * parameter is not indexed as a second copy of itself; and, for anything behind a login,
 * an explicit instruction not to index — robots.txt asks a crawler not to *fetch* a page,
 * which is not the same as keeping it out of the index if it is linked from elsewhere.
 */

/**
 * The canonical address of a page, and the same page in the other language.
 *
 * Both languages have to be declared to each other, or a search engine treats them as
 * unrelated pages and picks one. x-default points at English, which is what an address
 * without a language resolves to for a reader with no stated preference.
 */
export function canonical(path: string, locale?: Locale, availableLocales: readonly Locale[] = LOCALES): Metadata {
  const base = siteUrl();
  if (!locale) return { alternates: { canonical: new URL(path, base).toString() } };
  const languages: Record<string, string> = {};
  for (const other of availableLocales) {
    languages[other] = new URL(localePath(other, path), base).toString();
  }
  languages["x-default"] = new URL(localePath("en", path), base).toString();
  return {
    alternates: { canonical: new URL(localePath(locale, path), base).toString(), languages },
  };
}

/** For authenticated surfaces: keep them out of the index however they were reached. */
export const noIndex: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

interface ReportSchema {
  slug: string;
  title: string;
  description: string;
  publishedAt: Date;
  updatedAt?: Date | null;
  institution: string;
  sourceUrl: string;
  locale: Locale;
  author?: string | null;
  about?: string[];
  hasTranslation?: boolean;
}

export const brandName = (locale: Locale) => locale === "zh-CN" ? SITE_NAME_ZH : SITE_NAME;
export const homeSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "Tlines 全球机构情报：银行研报与市场共识"
  : "Tlines — Institutional Research & Bank Consensus";

/**
 * Titles and descriptions are built to a length, not to a template.
 *
 * A search result shows roughly 60 characters of a title and 158 of a description, and
 * everything past that is either truncated or dropped. TITLE_SUFFIX is what the root layout
 * appends to a title it composes itself, so a builder whose output is *composed* (rather than
 * passed as `absolute`) must leave room for it — a 60-character builder then yields a
 * 69-character title. Every page-level template therefore passes `{ absolute: clamp(...) }`,
 * and seo.test.ts asserts both the suffix length and the clamp boundary.
 */
export const TITLE_SUFFIX = " · Tlines";
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 158;

export function clamp(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).replace(/[,;:.·|\-—]\s*$/, "")}…`;
}

/** A title that owns its full width instead of sharing it with the layout's brand suffix. */
export function absoluteTitle(subject: string, max = TITLE_MAX) {
  return { absolute: clamp(subject, max) };
}

/** Title for a page whose own name is the query, so the name leads and the qualifier follows. */
export function namedSeoTitle(subject: string, intent: string, locale: Locale) {
  return clamp(locale === "zh-CN" ? `${subject}${intent}` : `${subject} — ${intent}`, 60);
}

export const assetSeoTitle = (name: string, locale: Locale, ticker?: string | null) => locale === "zh-CN"
  ? clamp(`${name}机构展望、目标价与共识`, 60)
  : clamp(`${name}${ticker && ticker.toUpperCase() !== name.toUpperCase() ? ` (${ticker.toUpperCase()})` : ""} Institutional Outlook & Bank Forecasts`, 60);

export const institutionSeoTitle = (name: string, locale: Locale) => locale === "zh-CN"
  ? clamp(`${name}研报、市场观点与预测`, 60)
  : clamp(`${name} Research, Market Views & Forecasts`, 60);

export const marketsSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "资产机构展望：各资产机构观点与共识"
  : clamp("Institutional Market Outlooks by Asset", 60);
export const researchSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "机构研报流：可溯源的银行研究"
  : clamp("Institutional Research Feed: Source-Linked Bank Reports", 60);
export const viewsSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "机构观点：按热度排序的银行市场观点"
  : clamp("Institutional Market Views, Ranked by Heat", 60);
export const macroSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "经济数据：发布、预期与机构预测"
  : clamp("Economic Data: Releases, Consensus & Institutional Forecasts", 60);
export const topicsSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "宏观与市场主题：机构正在研究什么"
  : clamp("Market Topics: What Institutions Are Researching", 60);
export const marketThemesSeoTitle = (locale: Locale) => locale === "zh-CN"
  ? "交易主线：机构研报支持的当期市场逻辑"
  : clamp("Market Themes: Narratives Backed by Institutional Research", 60);

export const localizedUrl = (path: string, locale: Locale) => new URL(localePath(locale, path), siteUrl()).toString();
export const organizationId = () => `${siteUrl()}${ORGANIZATION_ID_PATH}`;
export function ogImage(kind: string, title: string, subtitle?: string) {
  const url = new URL("/api/og", siteUrl());
  url.searchParams.set("kind", kind); url.searchParams.set("title", title);
  if (subtitle) url.searchParams.set("subtitle", subtitle);
  return url.toString();
}

export function organizationJsonLd(locale: Locale) {
  const base = siteUrl();
  const sameAs = (process.env.BRAND_SAME_AS ?? "").split(",").map((url) => url.trim()).filter((url) => /^https:\/\//.test(url));
  return {
    "@context": "https://schema.org", "@type": "Organization", "@id": organizationId(),
    name: brandName(locale), alternateName: locale === "zh-CN" ? SITE_NAME : SITE_NAME_ZH,
    url: base, logo: { "@type": "ImageObject", url: `${base}/icon.svg` }, sameAs,
    // What the organization is, in its own words, on the entity rather than only on a policy page.
    description: locale === "zh-CN"
      ? "Tlines 把全球金融机构公开发布的研报，整理成可比较、可追踪、可溯源的结构化市场观点、共识与信号。"
      : "Tlines structures publicly published institutional research into comparable, source-linked market views, consensus and signals.",
    // Where the editorial rules are written down, so the entity points at its own accountability.
    publishingPrinciples: `${base}${localePath(locale, "/editorial-policy")}`,
    diversityPolicy: `${base}${localePath(locale, "/sources")}`,
    correctionsPolicy: `${base}${localePath(locale, "/corrections")}`,
    ...(process.env.BRAND_FOUNDED ? { foundingDate: process.env.BRAND_FOUNDED } : {}),
  };
}

/**
 * A list of things that are on the page, in the order a reader sees them.
 *
 * Only for pages that really render the items: a hub page naming its assets, a feed naming
 * its reports. The items are the page's own links, so nothing here is a claim the HTML does
 * not already make.
 */
export function itemListJsonLd(locale: Locale, path: string, name: string, items: Array<{ name: string; path: string }>) {
  const url = localizedUrl(path, locale);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${url}#itemlist`,
    name,
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: localizedUrl(item.path, locale),
    })),
  };
}

/** A hub page: the collection itself, plus what it is a collection of. */
export function collectionPageJsonLd(locale: Locale, path: string, name: string, description: string, about?: string) {
  const page = webPageJsonLd(locale, path, name, description, "CollectionPage");
  return about ? { ...page, about: { "@type": "Thing", name: about } } : page;
}

/**
 * The report page's search-facing title.
 *
 * The stored title is the publisher's own wording, which is right for the H1 and wrong for a
 * result: many series titles start with the institution's name, bracket noise or a document
 * label. The cleaned title is used only where a search engine reads it.
 */
const NOISE_IN_TITLE = /^(?:pdf|document|file of entire text|untitled)\b/i;
export function researchSeoSubject(title: string) {
  const clean = title.replace(/\s*[·|]\s*(?:global economics|fixed income commentary|macro)\s*$/i, "")
    .replace(/【[^】]*】/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || NOISE_IN_TITLE.test(clean)) return null;
  return clean;
}

/**
 * The publisher's headline, as shown to a reader.
 *
 * Extraction occasionally lower-cases a whole headline, so report pages have gone live titled
 * "the turkish central bank stays on hold signals continued caution". Capitalising the first
 * letter is the whole of the safe repair here — re-casing proper nouns is a rewrite, and the
 * institution's wording is the thing being preserved.
 */
export function displayTitle(title: string) {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  if (/^[a-z]/.test(clean) && !/[A-Z]/.test(clean)) return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
  return clean;
}

/** Drops a publisher name that the headline repeats, e.g. "UOB Group Research · UOB Group". */
export function stripPublisherPrefix(title: string, publisher: string) {
  const clean = displayTitle(title);
  const prefix = publisher.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!prefix || prefix.length < 4) return clean;
  const match = clean.match(new RegExp(`^${prefix}\\b[\\s:·\\-—|]*`, "i"));
  if (!match) return clean;
  const rest = clean.slice(match[0].length).trim();
  return rest.length >= 12 ? rest : clean;
}

/**
 * A report described as an article, so a search engine can show it as one.
 *
 * The institution remains the report publisher. Tlines is sdPublisher: it publishes this
 * structured-data description and the surrounding analysis page, not the source report.
 */
export function reportJsonLd(report: ReportSchema) {
  const path = `/research/${report.slug}`;
  const url = localizedUrl(path, report.locale);
  const otherLocale: Locale = report.locale === "en" ? "zh-CN" : "en";
  return {
    "@context": "https://schema.org",
    "@type": "AnalysisNewsArticle",
    "@id": url,
    url,
    headline: report.title.slice(0, 110),
    description: report.description.slice(0, 300),
    datePublished: report.publishedAt.toISOString(),
    dateModified: (report.updatedAt ?? report.publishedAt).toISOString(),
    inLanguage: report.locale,
    isAccessibleForFree: true,
    author: report.author ? { "@type": "Person", name: report.author } : { "@type": "Organization", name: report.institution },
    publisher: { "@type": "Organization", name: report.institution },
    sdPublisher: { "@id": organizationId() },
    abstract: report.description.slice(0, 300),
    ...(report.about?.length ? { about: report.about.map((name) => ({ "@type": "Thing", name })) } : {}),
    // The publisher's own page is the authority for the research itself.
    isBasedOn: report.sourceUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(report.locale === "en"
      ? report.hasTranslation ? { workTranslation: { "@id": localizedUrl(path, otherLocale) } } : {}
      : { translationOfWork: { "@id": localizedUrl(path, otherLocale) } }),
  };
}

/** The site itself. SearchAction is omitted until a crawlable search-results route exists. */
export function siteJsonLd(locale: Locale, description: string) {
  const url = localizedUrl("/", locale);
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${url}#website`,
    url,
    name: brandName(locale),
    description,
    inLanguage: locale,
    publisher: { "@id": organizationId() },
  };
}

/** A trail a search engine can show instead of a bare URL. */
export function breadcrumbJsonLd(locale: Locale, trail: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: localizedUrl(step.path, locale),
    })),
  };
}

export function webPageJsonLd(locale: Locale, path: string, name: string, description: string, type = "WebPage") {
  const url = localizedUrl(path, locale);
  return { "@context": "https://schema.org", "@type": type, "@id": `${url}#webpage`, url, name, description, inLanguage: locale, isPartOf: { "@id": `${localizedUrl("/", locale)}#website` }, publisher: { "@id": organizationId() } };
}

export function institutionProfileJsonLd(locale: Locale, path: string, name: string, description: string, officialUrl: string) {
  const page = webPageJsonLd(locale, path, name, description, "ProfilePage");
  return {
    ...page,
    mainEntity: {
      "@type": "Organization",
      "@id": `${localizedUrl(path, locale)}#institution`,
      name,
      url: officialUrl,
      sameAs: officialUrl,
      mainEntityOfPage: { "@id": page["@id"] },
    },
  };
}

export function datasetJsonLd(locale: Locale, path: string, name: string, description: string, dateModified?: Date) {
  const url = localizedUrl(path, locale);
  return { "@context": "https://schema.org", "@type": "Dataset", "@id": `${url}#dataset`, name, description, url, inLanguage: locale, isAccessibleForFree: true, creator: { "@id": organizationId() }, ...(dateModified ? { dateModified: dateModified.toISOString() } : {}) };
}

/** Renders structured data. Server-only: the payload is built from trusted fields. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
