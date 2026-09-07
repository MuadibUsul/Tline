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
export function canonical(path: string, locale?: Locale): Metadata {
  const base = siteUrl();
  if (!locale) return { alternates: { canonical: new URL(path, base).toString() } };
  const languages: Record<string, string> = {};
  for (const other of LOCALES) {
    languages[other === "zh-CN" ? "zh-Hans" : other] = new URL(localePath(other, path), base).toString();
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
  id: string;
  title: string;
  description: string;
  publishedAt: Date;
  updatedAt?: Date | null;
  institution: string;
  sourceUrl: string;
  locale: Locale;
  author?: string | null;
}

export const brandName = (locale: Locale) => locale === "zh-CN" ? SITE_NAME_ZH : SITE_NAME;
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
  };
}

/**
 * A report described as an article, so a search engine can show it as one.
 *
 * The publisher is named as the author and this site as the publisher, which is what the
 * arrangement actually is: the research is theirs, the summary and the extracted views
 * are ours. isAccessibleForFree is stated because the page genuinely is.
 */
export function reportJsonLd(report: ReportSchema) {
  const url = localizedUrl(`/research/${report.id}`, report.locale);
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
    publisher: { "@id": organizationId() },
    accountablePerson: { "@type": "Organization", name: report.institution },
    abstract: report.description.slice(0, 300),
    // The publisher's own page is the authority for the research itself.
    isBasedOn: report.sourceUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(report.locale === "en"
      ? { workTranslation: { "@id": localizedUrl(`/research/${report.id}`, otherLocale) } }
      : { translationOfWork: { "@id": localizedUrl(`/research/${report.id}`, otherLocale) } }),
  };
}

/** The site itself, with the search box a result page can offer. */
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
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${localizedUrl("/research", locale)}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
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
