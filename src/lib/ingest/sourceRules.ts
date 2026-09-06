type SourceRule = {
  listingUrls?: string[];
  sitemapUrls?: string[];
  candidatePath?: RegExp;
  skipSitemap?: boolean;
  articleRejected?: RegExp;
  refreshKnownTitle?: RegExp;
  minimumArticleLimit?: number;
  embeddedPdfLimit?: number;
  minimumLookbackHours?: number;
  preferNativePdf?: boolean;
};

// Publisher-specific exceptions discovered during source acceptance. Scheduled
// crawling reads these rules directly; probes only verify that they still work.
const RULES: Record<string, SourceRule> = {
  commonwealth: {
    listingUrls: ["https://www.commbank.com.au/articles/newsroom.html"],
    candidatePath: /^\/articles\/newsroom\/20\d{2}\//i,
    articleRejected: /(?:content presented in this section has been provided by Australian Associated Press|merchant fees?|card surcharg(?:e|ing)|scam prevention|customer support)/i,
  },
  saxo: {
    candidatePath: /^\/content\/articles\//i,
  },
  nordea: {
    candidatePath: /^\/en\/news\/[^/]+\/?$/i,
    articleRejected: /^(?:All news stories\s*|Stock exchange release:.*|(?:Half-year report.*Nordea Hypotek|Nordea Hypotek.*half-year report).*)$/i,
  },
  mufg: {
    // MUFG publishes on two hosts: bk.mufg.jp issues occasional PDF briefs, while
    // mufgresearch.com carries the daily FX/rates/macro/credit desk output. Both are
    // listed so the crawler keeps the PDFs and picks up the far larger HTML stream.
    listingUrls: [
      "https://www.mufgresearch.com/fx/",
      "https://www.mufgresearch.com/rates/",
      "https://www.mufgresearch.com/macro/",
      "https://www.mufgresearch.com/credit/",
      "https://www.mufgresearch.com/forecasts/",
    ],
    // Article pages sit one segment below each desk; the bare desk paths are listings.
    // The second alternative keeps the bk.mufg.jp PDF briefs reachable.
    candidatePath: /^\/(?:fx|rates|macro|credit|forecasts)\/[^/]+\/?$|^\/report\//i,
    preferNativePdf: true,
    // Revisit the current research month so rows previously polluted by the
    // consent banner are replaced from the institution's own PDF.
    minimumArticleLimit: 20,
    minimumLookbackHours: 720,
  },
  westpac: {
    // Sub-topic listing pages under Westpac IQ economics.
    listingUrls: [
      "https://www.westpaciq.com.au/markets",
      "https://www.westpaciq.com.au/topic.rba",
      "https://www.westpaciq.com.au/topic.consumer",
      "https://www.westpaciq.com.au/topic.businessconditions",
      "https://www.westpaciq.com.au/topic.housing",
      "https://www.westpaciq.com.au/topic.commodities",
      "https://www.westpaciq.com.au/topic.australia",
      "https://www.westpaciq.com.au/topic.newzealand",
    ],
    articleRejected: /^Westpac IQ\s*$/i,
  },
  scotiabank: {
    // Each economics-publications sub-series is its own listing page.
    listingUrls: [
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.daily-points.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.global-week-ahead.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.economic-indicators.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.global-outlook-and-forecast-tables.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.housing.html",
      "https://www.scotiabank.com/ca/en/about/economics/economics-publications.fiscal-policy.html",
    ],
    // The main economics listing often publishes 7-11 pieces in one day. A six-item
    // batch stopped before the previous day's Daily Points, and each page's related-PDF
    // links could consume the remaining slots. Read the full current listing, but take
    // only the page's primary (first) download.
    minimumArticleLimit: 12,
    embeddedPdfLimit: 1,
    minimumLookbackHours: 168,
    refreshKnownTitle: /^Daily Points$/i,
  },
  td: {
    listingUrls: ["https://economics.td.com/ca-weekly-bottom-line"],
    minimumLookbackHours: 168,
    preferNativePdf: true,
  },
  barclays: {
    listingUrls: [
      "https://www.ib.barclays/our-insights/themes.html",
      "https://www.ib.barclays/our-insights/series.html",
      "https://www.ib.barclays/our-insights/themes/macro-shifts.html",
      "https://www.ib.barclays/our-insights/themes/innovation-edge.html",
      // The quarterly outlook, kept for when an edition appears rather than for daily flow.
      "https://www.ib.barclays/research/global-outlook.html",
    ],
  },
  nomura: {
    // Every section carries different reports, so all of them are listed; the rotation
    // in listingUrls covers them across runs rather than in one.
    listingUrls: [
      "https://www.nomuraconnects.com/economics",
      "https://www.nomuraconnects.com/emerging-markets",
      "https://www.nomuraconnects.com/annual-outlook",
      "https://www.nomuraconnects.com/central-banks",
      "https://www.nomuraconnects.com/rates",
      "https://www.nomuraconnects.com/geopolitics",
      "https://www.nomuraconnects.com/technology",
      "https://www.nomuraconnects.com/volatility",
      "https://www.nomuraconnects.com/sustainability",
      "https://www.nomuraconnects.com/asia",
      "https://www.nomuraconnects.com/americas",
      "https://www.nomuraconnects.com/emea",
      "https://www.nomuraconnects.com/japan",
    ],
  },
  ocbc: {
    listingUrls: [
      "https://www.ocbc.com/group/research/research-with-filter",
      "https://www.ocbc.com/group/research/investment-reports",
    ],
  },
  mizuho: {
    // Insights are JS-loaded tabs; every tab is its own sub-category listing.
    listingUrls: [
      "https://www.mizuhogroup.com/bank/insights/information?tab=market-outlooks",
      "https://www.mizuhogroup.com/bank/insights/information?tab=economic-information",
      "https://www.mizuhogroup.com/bank/insights/information?tab=market-trends",
      "https://www.mizuhogroup.com/bank/insights/information?tab=industry-reports",
      "https://www.mizuhogroup.com/bank/insights/information?tab=country-reports",
      "https://www.mizuhogroup.com/bank/insights/information?tab=research",
      "https://www.mizuhogroup.com/bank/insights/information?tab=research-report",
      "https://www.mizuhogroup.com/bank/insights/information?tab=information-and-reports-on-china",
      "https://www.mizuhogroup.com/bank/insights/information?tab=mizuho-china-business-express",
      "https://www.mizuhogroup.com/americas/insights",
    ],
  },
  schroders: {
    // The listing is a client-rendered shell with no article links. Schroders publishes
    // the complete global/individual inventory in this locale-specific sitemap; naming it
    // directly avoids the root sitemap's dozens of locale indexes and catches new pieces
    // without browser rendering.
    sitemapUrls: ["https://www.schroders.com/en/global/individual/sitemap.xml"],
    candidatePath: /\/insights\//i,
    // Revisit legacy rows whose dated suffix was lost by the old title cleaner. Once the
    // corrected title is stored they return to the normal URL-hash fast path.
    refreshKnownTitle: /^(?:Monthly|Quarterly) markets review$/i,
  },
  rbc: {
    // The registered source is Canadian analysis; the US Week Ahead section carries the
    // US data previews (payrolls, CPI) whose forecasts feed the expectations pipeline.
    listingUrls: ["https://www.rbc.com/en/economics/us-week-ahead/"],
    articleRejected: /^Featured Analysis\s*$/i,
  },
  commerzbank: {
    articleRejected: /^Newsletters?(?:\s*\|\s*Corporate Clients)?\s*$/i,
  },
  franklin: {
    listingUrls: [
      "https://www.franklintempleton.com/insights/franklin-templeton-institute/index",
      "https://www.franklintempleton.com/insights/research-findings/index",
    ],
    articleRejected: /^Investment Themes\s*$/i,
  },
  invesco: {
    listingUrls: [
      "https://www.invesco.com/us/en/insights/topic/market-and-economic-insights.html",
      "https://www.invesco.com/us/en/insights/topic/investment-related-insights.html",
    ],
    articleRejected: /^Market and economic insights\s*$/i,
  },
  uob: {
    articleRejected: /^Quarterly Global Outlook\s*$/i,
  },
  "nab-markets": {
    listingUrls: ["https://business.nab.com.au/tag/economic-commentary"],
    candidatePath: /^\/tag\/economic-commentary\/.+/i,
  },
  seb: {
    candidatePath: /^\/our-offering\/(?:reports-and-publications|research-and-strategy)\//i,
    articleRejected: /^Investment Outlook Reports\s*$/i,
  },
  citi: {
    candidatePath: /^(?:\/global\/insights\/(?!research\/?$).+|\/rcs\/citigpa\/storage\/public\/.+\.pdf$)/i,
    articleRejected: /^Independent Research and Market Analysis by Citi\s*$/i,
  },
  rabobank: {
    listingUrls: ["https://www.rabobank.com/knowledge/all-articles"],
    candidatePath: /^\/knowledge\/[qd]\d+-/i,
  },
  bmo: {
    articleRejected: /^BMO Named Official Bank\b/i,
  },
  natixis: {
    // Angular SPA: every path returns the same shell and there is no sitemap.
    // Discovery runs through the site's own public API (see apiSources.ts).
    candidatePath: /^\/Site\/en\/publication\//i,
    skipSitemap: true,
    preferNativePdf: true,
  },
  "cr-dit-cib": {
    // The global sitemap also contains corporate transaction announcements.
    // The configured source is the Global Markets Research area, not /news/.
    candidatePath: /(?:research|insights?)/i,
  },
  intesa: {
    // The official listing exposes native PDFs directly; its sitemap points to
    // disclaimer redirects and only delays reaching the usable listing.
    skipSitemap: true,
  },
};

/**
 * The listings to visit, with the extras rotated.
 *
 * A crawl visits only the first few pages it is given, so a publisher with more sections
 * than that budget would have had its later ones read on no run at all — they sat at the
 * end of a fixed list and were never reached. Rotating by the day covers every section
 * within a few days while each run stays the same size. The research URL stays first,
 * since it is the page the source is defined by.
 */
export function listingUrls(slug: string, researchUrl: string, day = Math.floor(Date.now() / 864e5)): string[] {
  const extras = RULES[slug]?.listingUrls ?? [];
  if (extras.length === 0) return [researchUrl];
  const offset = day % extras.length;
  return [researchUrl, ...extras.slice(offset), ...extras.slice(0, offset)];
}

/**
 * Recordings, wherever they are published.
 *
 * A podcast or video page carries a blurb, not a report, so it can never pass the article
 * gates — but it is fetched, rendered and examined first, and on a desk that publishes
 * mostly recordings that consumes the whole crawl budget before a written report is
 * reached. Excluding them by path costs nothing and is true of every publisher.
 */
const RECORDING_PATH = /(?:^|[/-])(?:podcasts?|videos?|webinars?|webcasts?|episodes?|listen|watch)(?:$|[/-])/i;

export function candidateAllowed(slug: string, url: string): boolean {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return false; }
  if (RECORDING_PATH.test(pathname)) return false;
  const path = RULES[slug]?.candidatePath;
  return path ? path.test(pathname) : true;
}

export function sitemapEnabled(slug: string): boolean {
  return !RULES[slug]?.skipSitemap;
}

export function sitemapUrls(slug: string): string[] {
  return RULES[slug]?.sitemapUrls ?? [];
}

export function articleAllowed(slug: string, title: string, text: string): boolean {
  const rejected = RULES[slug]?.articleRejected;
  return !rejected || (!rejected.test(title) && !rejected.test(text));
}

export function refreshKnownCandidate(slug: string, title: string): boolean {
  return RULES[slug]?.refreshKnownTitle?.test(title) ?? false;
}

export function minimumArticleLimit(slug: string): number {
  return RULES[slug]?.minimumArticleLimit ?? 0;
}

export function embeddedPdfLimit(slug: string): number {
  return RULES[slug]?.embeddedPdfLimit ?? Number.POSITIVE_INFINITY;
}

export function minimumLookbackHours(slug: string): number {
  return RULES[slug]?.minimumLookbackHours ?? 0;
}

export function prefersNativePdf(slug: string): boolean {
  return RULES[slug]?.preferNativePdf ?? false;
}
