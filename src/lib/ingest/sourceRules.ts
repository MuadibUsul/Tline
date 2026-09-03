type SourceRule = {
  listingUrls?: string[];
  candidatePath?: RegExp;
  skipSitemap?: boolean;
  articleRejected?: RegExp;
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
    listingUrls: [
      "https://www.nomuraconnects.com/economics",
      "https://www.nomuraconnects.com/emerging-markets",
      "https://www.nomuraconnects.com/annual-outlook",
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
    candidatePath: /\/insights\//i,
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
  natixis: {
    // Angular SPA: every path returns the same shell and there is no sitemap.
    // Discovery runs through the site's own public API (see apiSources.ts).
    candidatePath: /^\/Site\/en\/publication\//i,
    skipSitemap: true,
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

export function listingUrls(slug: string, researchUrl: string): string[] {
  return [researchUrl, ...(RULES[slug]?.listingUrls ?? [])];
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

export function articleAllowed(slug: string, title: string, text: string): boolean {
  const rejected = RULES[slug]?.articleRejected;
  return !rejected || (!rejected.test(title) && !rejected.test(text));
}
