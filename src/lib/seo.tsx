import type { Metadata } from "next";
import { LOCALES, localePath, type Locale } from "./i18n";
import { siteUrl } from "./site";

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
  locale: string;
}

/**
 * A report described as an article, so a search engine can show it as one.
 *
 * The publisher is named as the author and this site as the publisher, which is what the
 * arrangement actually is: the research is theirs, the summary and the extracted views
 * are ours. isAccessibleForFree is stated because the page genuinely is.
 */
export function reportJsonLd(report: ReportSchema) {
  const url = new URL(`/research/${report.id}`, siteUrl()).toString();
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
    author: { "@type": "Organization", name: report.institution },
    publisher: { "@type": "Organization", name: "Tline", url: siteUrl() },
    // The publisher's own page is the authority for the research itself.
    isBasedOn: report.sourceUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}

/** The site itself, with the search box a result page can offer. */
export function siteJsonLd(name: string, description: string) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: base,
    name,
    description,
    publisher: { "@type": "Organization", name, url: base },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/research?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/** A trail a search engine can show instead of a bare URL. */
export function breadcrumbJsonLd(trail: Array<{ name: string; path: string }>) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: new URL(step.path, base).toString(),
    })),
  };
}

/** Renders structured data. Server-only: the payload is built from trusted fields. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
