import * as cheerio from "cheerio";

export interface CandidateLink {
  url: string;
  title: string;
  publishedAt: Date | null;
}

// URL path segments that are almost never a research article.
const DENY = /(\/about|\/contact|\/careers?|\/privacy|\/terms|\/cookie|\/sitemap|\/login|\/register|\/subscribe|\/faq|frequently-asked|\/values|\/purpose|\/leadership|foreign-direct|industries-we-serve|global-corporate|\/investors?(?:\/|$)|investors?-shareholders?|shareholder|\/media\/|\/events?|presentations?|modern-slavery|code-of-conduct|\/framework|advisory|\/solutions|\/banking|\/legal|\/disclaimer|\/help|\/support|\/team|\/people|\/awards|\/glossary)/i;

// A link that looks like an actual article: a date in the path, or a long slug.
function looksLikeArticleUrl(path: string): boolean {
  if (/\/20\d\d\//.test(path)) return true; // /2026/
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  const hyphens = (slug.match(/-/g) || []).length;
  return hyphens >= 3 && slug.length >= 20; // long, wordy slug
}

/** Collect plausible article links from a listing/index page. */
export function extractLinks(html: string, baseUrl: string): CandidateLink[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const pathname = base.pathname.replace(/\/$/, "");
  const basePath = /\/index\.[a-z0-9]+$/i.test(pathname)
    ? pathname.replace(/\/index\.[a-z0-9]+$/i, "")
    : pathname.replace(/\.[a-z0-9]+$/i, "");
  const out = new Map<string, { title: string; underSection: boolean; date: number; publishedAt: Date | null; research: boolean }>();

  $("a[href]").each((_, el) => {
    const chrome = $(el).closest("nav,header,footer,[role=navigation],[role=contentinfo],[class*=footer],[class*=menu]");
    if (chrome.length && !$(el).closest("article").length) return;
    const href = $(el).attr("href") || "";
    let text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 28) {
      const card = $(el).closest("article,[class*=card],[class*=tile],[class*=teaser]");
      const heading = card.find("h1,h2,h3,h4").first().text().replace(/\s+/g, " ").trim();
      if (heading) text = heading;
    }
    if (text.length < 28 || text.length > 500) return;
    text = text.slice(0, 240); // Some publishers append the standfirst and date inside the same anchor.
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.host !== base.host) return; // same institution only
    const path = abs.pathname;
    if (/\.(pdf|jpe?g|png|gif|zip|xlsx?|docx?|pptx?)$/i.test(path)) return;
    // Must be under the research section OR clearly article-shaped.
    const underSection = basePath.length > 1 && (path === basePath || path.startsWith(`${basePath}/`));
    if (DENY.test(underSection ? path.slice(basePath.length) : path)) return;
    if (!underSection && !looksLikeArticleUrl(path)) return;
    const key = abs.href.split("#")[0].split("?")[0];
    if (!out.has(key) && key !== baseUrl.replace(/\/$/, "")) {
      const yearMonth = key.match(/(20\d{2})[-_/](0?[1-9]|1[0-2])(?:[-_/]|$)/);
      const cardText = $(el).closest("article,li,[class*=card],[class*=tile],[class*=teaser],[class*=item]")
        .first().text().replace(/\s+/g, " ").trim().slice(0, 1000);
      const publishedAt = inferPublicationDate(key, text, cardText);
      out.set(key, {
        title: text,
        underSection,
        publishedAt,
        date: publishedAt?.getTime()
          ?? (yearMonth ? Date.UTC(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1) : 0),
        research: /\b(?:outlook|markets?|econom(?:y|ics?)|investment|credit|research|strategy|forecast)\b/i.test(`${path} ${text}`),
      });
    }
  });

  return [...out.entries()]
    .map(([url, value]) => ({ url, ...value }))
    .sort((a, b) => Number(b.underSection) - Number(a.underSection) || b.date - a.date || Number(b.research) - Number(a.research))
    .slice(0, 12)
    .map(({ url, title, publishedAt }) => ({ url, title, publishedAt }));
}

/** Find same-origin native PDFs and retain the surrounding card's title/date hints. */
export function extractPdfCandidates(html: string, baseUrl: string): CandidateLink[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const out = new Map<string, CandidateLink>();
  $("a[href],iframe[src],embed[src],object[data]").each((_, element) => {
    if ($(element).closest("nav,header,footer,[role=navigation],[role=contentinfo],[class*=footer],[class*=menu]").length) return;
    const raw = $(element).attr("href") || $(element).attr("src") || $(element).attr("data");
    if (!raw) return;
    try {
      const url = new URL(raw, base);
      if (url.origin !== base.origin || !/\.pdf(?:$|\?)/i.test(url.href) || DENY.test(url.pathname)) return;
      const clean = url.href.split("#")[0];
      const card = $(element).closest("article,li,[class*=card],[class*=tile],[class*=teaser],[class*=item]").first();
      const cardText = card.text().replace(/\s+/g, " ").trim().slice(0, 1000);
      const heading = card.find("h1,h2,h3,h4").first().text().replace(/\s+/g, " ").trim();
      const linkText = $(element).text().replace(/\s+/g, " ").trim();
      const filename = decodeURIComponent(url.pathname.split("/").pop() || "").replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
      const title = (heading || (/^(?:download|pdf|read more)$/i.test(linkText) ? "" : linkText) || filename).slice(0, 240);
      out.set(clean, { url: clean, title, publishedAt: inferPublicationDate(clean, title, cardText) });
    } catch { /* invalid link */ }
  });
  return [...out.values()];
}

/** Backward-compatible URL-only PDF discovery. */
export function extractPdfLinks(html: string, baseUrl: string): string[] {
  return extractPdfCandidates(html, baseUrl).map((candidate) => candidate.url);
}

/** Discover publisher-declared RSS/Atom feeds without leaving the audited origin. */
export function extractFeedLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const out = new Set<string>();
  $('link[rel~="alternate"][href],a[href]').each((_, element) => {
    const href = $(element).attr("href");
    const type = ($(element).attr("type") || "").toLowerCase();
    if (!href || (!/rss|atom|feed|xml/i.test(`${href} ${type}`))) return;
    try {
      const url = new URL(href, base);
      if (url.origin === base.origin) out.add(url.href);
    } catch { /* invalid URL */ }
  });
  return [...out].slice(0, 5);
}

// Boilerplate containers to drop wholesale before reading body text.
const STRIP = "script,style,noscript,nav,header,footer,aside,form,svg,button,iframe," +
  "[role=navigation],[role=banner],[role=contentinfo],[role=search],[aria-hidden=true]," +
  "div[class*=nav],section[class*=nav],div[class*=menu],section[class*=menu]," +
  "div[class*=header],section[class*=header],div[class*=footer],section[class*=footer]," +
  "div[class*=cookie],section[class*=cookie],div[class*=consent],section[class*=consent]," +
  "div[class*=subscribe],section[class*=subscribe],div[class*=breadcrumb],section[class*=breadcrumb]," +
  "div[class*=social],section[class*=social],div[class*=share],section[class*=share]," +
  "div[class*=related],section[class*=related],div[class*=sidebar],section[class*=sidebar]," +
  "div[class*=promo],section[class*=promo],div[class*=banner],section[class*=banner]," +
  "div[class*=menu-content],div[class*=apollo-l1-info],div[class*=apollo-featured-info],div[class*=featured-content-info]," +
  "div[class*=skip],section[class*=skip],div[id*=nav],section[id*=nav],div[id*=menu],section[id*=menu]," +
  "div[id*=footer],section[id*=footer],div[id*=header],section[id*=header],div[id*=cookie],section[id*=cookie]";

export interface Segment { heading: string | null; text: string }

export interface ExtractedArticle {
  title: string;
  text: string;
  segments: Segment[];
  author: string | null;
  publishedAt: Date | null;
  publicationDateText: string | null;
}

export function newestByPublication<T extends { publishedAt: Date }>(articles: T[], limit: number): T[] {
  return [...articles].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, limit);
}

/** Conservative date inference for URLs/titles that carry an explicit calendar date or quarter. */
export function inferPublicationDate(...values: Array<string | null | undefined>): Date | null {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const decoded = values.filter(Boolean).map((value) => {
    try { return decodeURIComponent(value!); } catch { return value!; }
  });
  for (const value of values) {
    if (!value) continue;
    let input = value;
    try { input = decodeURIComponent(value); } catch { /* keep the original value */ }
    const compactCalendar = input.match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
    if (compactCalendar) return new Date(Date.UTC(Number(compactCalendar[1]), Number(compactCalendar[2]) - 1, Number(compactCalendar[3])));
    const calendar = input.match(/(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])(?!\d)/);
    if (calendar) {
      const date = new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])));
      if (!isNaN(date.getTime())) return date;
    }
    const quarter = input.match(/(?:q([1-4])|([1-4])q)[\s_-]*(?:20)?(\d{2})(?!\d)/i);
    if (quarter) return new Date(Date.UTC(2000 + Number(quarter[3]), (Number(quarter[1] || quarter[2]) - 1) * 3, 1));
    const compact = input.match(/(?:^|[-_/\s])(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})(?!\d)/);
    if (compact) return new Date(Date.UTC(Number(compact[3]), Number(compact[2]) - 1, Number(compact[1])));
    const shortCompact = input.match(/(?:^|[-_/\s])(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(\d{2})(?!\d)/);
    if (shortCompact) return new Date(Date.UTC(2000 + Number(shortCompact[3]), Number(shortCompact[2]) - 1, Number(shortCompact[1])));
    const named = input.match(new RegExp(`(?:${months.join("|")})[-_\\s]+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?[,]?[-_\\s]+(20\\d{2})`, "i"));
    if (named) return new Date(Date.UTC(Number(named[2]), months.indexOf(named[0].match(/[a-z]+/i)![0].toLowerCase()), Number(named[1])));
    const dayNamed = input.match(new RegExp(`(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?[-_\\s]+(${months.join("|")})[,]?[-_\\s]+(20\\d{2})`, "i"));
    if (dayNamed) return new Date(Date.UTC(Number(dayNamed[3]), months.indexOf(dayNamed[2].toLowerCase()), Number(dayNamed[1])));
  }

  // Some publishers put the year in the URL/card and only "22 June" in the body.
  const years = [...new Set(decoded.flatMap((value) => value.match(/\b20\d{2}\b/g) || []))];
  if (years.length === 1) {
    for (const input of decoded) {
      const named = input.match(new RegExp(`\\b(${months.join("|")})[-_\\s]+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\b`, "i"));
      if (named) return new Date(Date.UTC(Number(years[0]), months.indexOf(named[1].toLowerCase()), Number(named[2])));
      const dayNamed = input.match(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?[-_\\s]+(${months.join("|")})\\b`, "i"));
      if (dayNamed) return new Date(Date.UTC(Number(years[0]), months.indexOf(dayNamed[2].toLowerCase()), Number(dayNamed[1])));
    }
  }
  return null;
}

function parsePublicationDate(value: string): Date | null {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  if (!/[T:]|(?:Z|[+-]\d\d:?\d\d)$/i.test(value)) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }
  return parsed;
}

/** Extract a clean title + body text (+ heading-delimited segments) from an article page. */
export function extractArticle(html: string): ExtractedArticle {
  const $ = cheerio.load(html);
  const partialDate = new RegExp(`(?:\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2}|\\b\\d{1,2}\\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))\\b`, "i");
  const visibleDateBeforeStrip = $("time[datetime]").attr("datetime") ||
    $("time,[class*=publish],[class*=date],[data-testid*=date],p").toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim())
      .find((value) => value.length <= 160 && (inferPublicationDate(value) || partialDate.test(value))) || "";
  $(STRIP).each((_, element) => {
    if ($(element).find("main,article,[itemprop=articleBody]").length === 0) $(element).remove();
  });

  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    ""
  ).replace(/\s+/g, " ").replace(/\s+[|–—-]\s+[^|–—-]{0,40}$/, "").trim();

  const author =
    $('meta[name="author"]').attr("content") ||
    $('[rel="author"]').first().text().trim() ||
    null;

  const dateStr =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").attr("datetime") ||
    $('meta[name="date"]').attr("content") ||
    $('meta[itemprop="datePublished"]').attr("content") ||
    html.match(/"(?:datePublished|PublishedDate|publishDateStr|publishDate)"\s*:\s*"([^"\\]+)"/i)?.[1] ||
    html.match(/&quot;(?:datePublished|PublishedDate|publishDateStr|publishDate)&quot;\s*:\s*&quot;([^&]+)&quot;/i)?.[1] ||
    visibleDateBeforeStrip ||
    "";
  let publishedAt = dateStr
    ? inferPublicationDate(dateStr) || (/\b20\d{2}\b|[T:]|(?:Z|[+-]\d\d:?\d\d)$/i.test(dateStr) ? parsePublicationDate(dateStr) : null)
    : null;
  if (!publishedAt) {
    const visibleDate = $("time,[class*=publish],[class*=date],[data-testid*=date]").toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim())
      .find((value) => inferPublicationDate(value));
    publishedAt = inferPublicationDate(visibleDate);
  }

  // Pick the densest container by PARAGRAPH text (menus have lots of text but few <p>).
  let bestEl: any = null;
  let bestScore = 0;
  const candidates = "article,[itemprop=articleBody],main,[class*=article],[class*=post],[class*=content],[class*=rich-text],[class*=body-copy]";
  $(candidates).each((_, el) => {
    const score = $(el).find("p").toArray()
      .map((p) => $(p).text().replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 40)
      .reduce((s, t) => s + t.length, 0);
    if (score > bestScore) { bestScore = score; bestEl = el; }
  });

  // Split the chosen container into heading-delimited segments (h2/h3/h4 → p).
  const segments: Segment[] = [];
  if (bestEl && bestScore >= 300) {
    let cur: { heading: string | null; buf: string[] } = { heading: null, buf: [] };
    const flush = () => { if (cur.buf.length) segments.push({ heading: cur.heading, text: cur.buf.join("\n\n") }); };
    $(bestEl).find("h2,h3,h4,p").each((_, node) => {
      const tag = (node as any).name as string;
      const t = $(node).text().replace(/\s+/g, " ").trim();
      if (!t) return;
      if (/^h[234]$/.test(tag)) { flush(); cur = { heading: t.slice(0, 160), buf: [] }; }
      else if (t.length > 40) cur.buf.push(t);
    });
    flush();
  }
  if (segments.length === 0) {
    // Fallback: no usable container/headings — one segment of every substantive paragraph.
    const paras = $("p").toArray().map((p) => $(p).text().replace(/\s+/g, " ").trim()).filter((t) => t.length > 50);
    if (paras.length) segments.push({ heading: null, text: paras.join("\n\n") });
  }
  if (segments.length === 0) {
    // Modern client-rendered publishers sometimes emit prose as nested divs without <p> tags.
    // Limit the fallback to semantic content roots; never use the entire body/document.
    let fallbackText = "";
    $("article,[itemprop=articleBody],main,[role=main],[class*=article-body],[class*=article-content],[class*=rich-text]").each((_, element) => {
      const candidate = $(element).text().replace(/\s+/g, " ").trim();
      if (candidate.length > fallbackText.length) fallbackText = candidate;
    });
    if (fallbackText.length >= 700) segments.push({ heading: null, text: fallbackText });
  }

  const text = segments.map((s) => s.text).join("\n\n");
  publishedAt ??= inferPublicationDate(title, text.slice(0, 1200));

  return {
    title,
    text,
    segments,
    author: author?.slice(0, 120) || null,
    publishedAt,
    publicationDateText: visibleDateBeforeStrip || null,
  };
}

/**
 * Reject non-research pages (nav dumps, marketing, FAQ) before they pollute the DB.
 * The strongest signal for a jammed menu is very long space-free tokens
 * ("PersonalBankingWealthBanking…") and a shortage of real sentences.
 */
/** Menu/nav dumps concatenate link labels into very long space-free tokens. */
export function isJunk(text: string): boolean {
  if (isAccessGateText(text)) return true;
  const tokens = text.split(/\s+/).filter((token) => token && !/^https?:\/\//i.test(token));
  if (tokens.length < 8) return false;
  const longest = tokens.reduce((m, t) => Math.max(m, t.length), 0);
  if (longest > 45) return true;
  const jammed = tokens.filter((t) => t.length > 22).length / tokens.length;
  return jammed > 0.06;
}

/** Recognize consent/login copy so it is never mistaken for publisher research. */
export function isAccessGateText(text: string): boolean {
  return /these cookies are necessary for the website to function|view as guest|sign in to continue|log in to continue|subscription required/i.test(text);
}

/** Reject pages whose extracted "body" is really only the publisher's legal footer. */
export function isDisclaimerOnly(text: string): boolean {
  const markers = [
    /for informational purposes only/i,
    /does not constitute (?:an )?offer/i,
    /past (?:investment )?performance/i,
    /a word about risk/i,
    /without (?:prior )?notice/i,
    /no representation (?:is|has been) made/i,
    /should not be considered as investment advice/i,
    /no part of this material may be reproduced/i,
  ];
  const hits = markers.filter((marker) => marker.test(text)).length;
  if (hits < 4) return false;
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const legalChars = paragraphs
    .filter((paragraph) => markers.some((marker) => marker.test(paragraph)))
    .reduce((sum, paragraph) => sum + paragraph.length, 0);
  return legalChars / Math.max(text.length, 1) >= 0.65;
}

/** Topic gate for PDFs discovered without an explicit article page. */
export function looksLikeResearchTopic(title: string, text: string): boolean {
  const sample = `${title}\n${text.slice(0, 4000)}`;
  const signals = [
    /\bresearch\b/i, /\boutlook\b/i, /\bmarkets?\b/i, /\beconom(?:y|ic|ics)\b/i,
    /\binvest(?:ment|ing|or)\b/i, /\bportfolio\b/i, /\bassets?\b/i, /\bequit(?:y|ies)\b/i,
    /\bbonds?\b/i, /\byields?\b/i, /\binflation\b/i, /\bcommodit(?:y|ies)\b/i,
    /\bcurrenc(?:y|ies)\b/i, /\bforex\b/i, /\bmonetary\b/i, /\bgdp\b/i,
    /\bearnings\b/i, /\bvaluation\b/i, /\bforecast\b/i,
    /\b(?:employment|unemployment|jobs?|labou?r|wages?)\b/i,
  ];
  return signals.filter((signal) => signal.test(sample)).length >= 2;
}

/** Strict article check for extracted HTML content. */
export function looksLikeArticle(title: string, text: string): boolean {
  if (!title || text.length < 700) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 60) return false;
  if (isJunk(text)) return false;
  if (isDisclaimerOnly(text)) return false;
  const sentences = (text.match(/[.!?。！？]/g) || []).length;
  return sentences >= 4;
}
