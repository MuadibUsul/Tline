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
    articleRejected: /content presented in this section has been provided by Australian Associated Press/i,
  },
  saxo: {
    candidatePath: /^\/content\/articles\//i,
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
    candidatePath: /^\/Site\/en\/publication\//i,
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

export function candidateAllowed(slug: string, url: string): boolean {
  const path = RULES[slug]?.candidatePath;
  if (!path) return true;
  try { return path.test(new URL(url).pathname); } catch { return false; }
}

export function sitemapEnabled(slug: string): boolean {
  return !RULES[slug]?.skipSitemap;
}

export function articleAllowed(slug: string, title: string, text: string): boolean {
  const rejected = RULES[slug]?.articleRejected;
  return !rejected || (!rejected.test(title) && !rejected.test(text));
}
