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
  printToPdf?: boolean;
  documentOrigins?: string[];
};

// Publisher-specific exceptions discovered during source acceptance. Scheduled
// crawling reads these rules directly; probes only verify that they still work.
const RULES: Record<string, SourceRule> = {
  ubs: {
    // Refresh the reported row while it remains in the normal recent-article window.
    refreshKnownTitle: /^Daily: Look beyond rates to gold.s long-term support$/i,
  },
  bnp: {
    // Article pages expose a public `/pdf/<locale>/...` route without a `.pdf`
    // suffix. Some new editions temporarily return a one-line "coming soon" PDF;
    // the complete public article print view is the fallback in that case.
    preferNativePdf: true,
    printToPdf: true,
  },
  ing: {
    preferNativePdf: true,
  },
  danske: {
    preferNativePdf: true,
  },
  commonwealth: {
    listingUrls: ["https://www.commbank.com.au/articles/newsroom.html"],
    candidatePath: /^\/articles\/newsroom\/20\d{2}\//i,
    articleRejected: /(?:we couldn't find that page|content presented in this section has been provided by Australian Associated Press|merchant fees?|card surcharg(?:e|ing)|scam prevention|customer support)/i,
  },
  "charles-schwab": {
    articleRejected: /sorry, we can't find the page you're looking for/i,
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
    documentOrigins: ["https://library.westpaciq.com.au"],
    minimumLookbackHours: 240,
    preferNativePdf: true,
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
    preferNativePdf: true,
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
    // "Read the full report" currently redirects anonymous readers to Nomura Now's
    // login page. Preserve the complete public Connects article through its print view.
    preferNativePdf: true,
    printToPdf: true,
  },
  ocbc: {
    listingUrls: [
      "https://www.ocbc.com/group/research/research-with-filter",
      "https://www.ocbc.com/group/research/investment-reports",
    ],
  },
  mizuho: {
    // Mizuho publishes research in two shapes, and the rule needs both.
    //
    // The `?tab=` addresses were ten listings on paper and one page in fact: the tabs are
    // switched in the browser, so every one of them returned the same 1.2 MB document and
    // the crawl spent ten fetches to read it ten times. One address is kept.
    //
    // That page carries the Japanese research desk's reports — Economic Outlook, the FX
    // Medium-Term Outlook, the monthly bulletins — as ~870 direct PDF links in newest-
    // first order, on two document hosts (below). A modest embedded limit takes the head
    // of that list, which is the current month, and leaves the back catalogue alone.
    //
    // The Americas and Asia-Pacific desks publish written pieces instead, fully server-
    // rendered at /americas-insights/ and /asia-pacific-insights/. Their download icon is
    // `window.print()`, not a file, so those pages are the document.
    listingUrls: [
      "https://www.mizuhogroup.com/americas/insights",
      "https://www.mizuhogroup.com/asia-pacific/insights",
      "https://www.mizuhogroup.com/bank/insights/information",
    ],
    // Without this the site's 6,800-URL sitemap answers with corporate press releases:
    // the five rows this source held were merger announcements from 2004 to 2018, filed
    // as research. Only the insight collections are research; /americas-news/,
    // /global-news/ and /news-release/ are not, and /th/ and /jp/ are translations of
    // pages already read in English.
    candidatePath: /^\/(?:americas-insights|asia-pacific-insights|beyond-the-obvious)\/[^/]+\/?$/i,
    // Files live on the site platform's CDN and on Mizuho's own document library; the
    // pages that link them do not.
    documentOrigins: ["https://cdn.prod.website-files.com", "https://library.mizuhogroup.com"],
    // The research listing also links each chapter of a bound report as its own file
    // ("00 Front cover", "01", "02"…). Reading the head of the list keeps the crawl on
    // this month's publications rather than a decade of section covers.
    embeddedPdfLimit: 12,
    articleRejected: /^(?:Insights|Research|Economic information|Market outlooks?)\s*$/i,
  },
  schroders: {
    // The listing is a client-rendered shell with no article links. Schroders publishes
    // the complete global/individual inventory in this locale-specific sitemap; naming it
    // directly avoids the root sitemap's dozens of locale indexes and catches new pieces
    // without browser rendering.
    sitemapUrls: ["https://www.schroders.com/en/global/individual/sitemap.xml"],
    candidatePath: /\/insights\//i,
    minimumLookbackHours: 240,
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
    minimumLookbackHours: 240,
    preferNativePdf: true,
    printToPdf: true,
    articleRejected: /^Investment Themes\s*$/i,
  },
  invesco: {
    listingUrls: [
      "https://www.invesco.com/us/en/insights/topic/market-and-economic-insights.html",
      "https://www.invesco.com/us/en/insights/topic/investment-related-insights.html",
    ],
    minimumLookbackHours: 240,
    articleRejected: /^Market and economic insights\s*$/i,
  },
  pimco: {
    minimumLookbackHours: 240,
    preferNativePdf: true,
    printToPdf: true,
    // Revisit the one legacy row whose title and body absorbed the visitor modal.
    // The corrected publisher title no longer matches, so this repair is self-limiting.
    refreshKnownTitle: /PIMCO United States\s*[·|]\s*Key takeaways$/i,
  },
  "goldman-sachs": {
    minimumLookbackHours: 240,
    preferNativePdf: true,
  },
  "state-street": {
    minimumLookbackHours: 240,
    preferNativePdf: true,
  },
  "wellington-management": {
    minimumLookbackHours: 240,
  },
  daiwa: {
    minimumLookbackHours: 240,
    preferNativePdf: true,
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

/**
 * Hosts a publisher serves its own documents from.
 *
 * Pages and files need not share a host. A site built on a hosted platform keeps its
 * pages on the corporate domain and its PDFs on the platform's asset CDN, and a same-
 * origin-only reader sees a listing full of research and comes away with nothing. Only
 * hosts named here are widened to, so a link to a third party's document is still refused.
 */
export function documentOrigins(slug: string): string[] {
  return RULES[slug]?.documentOrigins ?? [];
}

export function prefersNativePdf(slug: string): boolean {
  return RULES[slug]?.preferNativePdf ?? false;
}

/** Article pages whose publisher-provided Print control is the document export. */
export function printsToPdf(slug: string): boolean {
  return RULES[slug]?.printToPdf ?? false;
}
