import * as cheerio from "cheerio";

export interface CandidateLink {
  url: string;
  title: string;
}

// URL path segments that are almost never a research article.
const DENY = /(\/about|\/contact|\/careers?|\/privacy|\/terms|\/cookie|\/sitemap|\/login|\/register|\/subscribe|\/faq|frequently-asked|\/values|\/purpose|\/leadership|foreign-direct|industries-we-serve|global-corporate|investors?-shareholders?|shareholder|\/media\/|\/events?|presentations?|sustainability|responsibility|\/framework|advisory|\/solutions|\/banking|\/legal|\/disclaimer|\/help|\/support|\/team|\/people|\/awards|\/glossary)/i;

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
  const basePath = base.pathname.replace(/\/$/, "").replace(/\.html?$/i, "");
  const out = new Map<string, string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 28 || text.length > 180) return; // headline-length text only
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
    const underSection = basePath.length > 1 && path.startsWith(basePath);
    if (DENY.test(underSection ? path.slice(basePath.length) : path)) return;
    if (!underSection && !looksLikeArticleUrl(path)) return;
    const key = abs.href.split("#")[0].split("?")[0];
    if (!out.has(key) && key !== baseUrl.replace(/\/$/, "")) out.set(key, text);
  });

  return [...out.entries()].map(([url, title]) => ({ url, title })).slice(0, 12);
}

/** Find same-origin native PDFs embedded by an otherwise body-less article page. */
export function extractPdfLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const out = new Set<string>();
  $("a[href],iframe[src],embed[src],object[data]").each((_, element) => {
    const raw = $(element).attr("href") || $(element).attr("src") || $(element).attr("data");
    if (!raw) return;
    try {
      const url = new URL(raw, base);
      if (url.origin === base.origin && /\.pdf(?:$|\?)/i.test(url.href)) out.add(url.href.split("#")[0]);
    } catch { /* invalid link */ }
  });
  return [...out];
}

// Boilerplate containers to drop wholesale before reading body text.
const STRIP = "script,style,noscript,nav,header,footer,aside,form,svg,button,iframe," +
  "[role=navigation],[role=banner],[role=contentinfo],[role=search],[aria-hidden=true]," +
  "[class*=nav],[class*=menu],[class*=header],[class*=footer],[class*=cookie]," +
  "[class*=consent],[class*=subscribe],[class*=breadcrumb],[class*=social]," +
  "[class*=share],[class*=related],[class*=sidebar],[class*=promo],[class*=banner]," +
  "[class*=skip],[id*=nav],[id*=menu],[id*=footer],[id*=header],[id*=cookie]";

export interface Segment { heading: string | null; text: string }

export interface ExtractedArticle {
  title: string;
  text: string;
  segments: Segment[];
  author: string | null;
  publishedAt: Date | null;
}

/** Conservative date inference for URLs/titles that carry an explicit calendar date or quarter. */
export function inferPublicationDate(...values: Array<string | null | undefined>): Date | null {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (const value of values) {
    if (!value) continue;
    const calendar = value.match(/(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])(?!\d)/);
    if (calendar) {
      const date = new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])));
      if (!isNaN(date.getTime())) return date;
    }
    const quarter = value.match(/(?:q([1-4])|([1-4])q)[\s_-]*(?:20)?(\d{2})(?!\d)/i);
    if (quarter) return new Date(Date.UTC(2000 + Number(quarter[3]), (Number(quarter[1] || quarter[2]) - 1) * 3, 1));
    const compact = value.match(/(?:^|[-_/])(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})(?!\d)/);
    if (compact) return new Date(Date.UTC(Number(compact[3]), Number(compact[2]) - 1, Number(compact[1])));
    const named = value.match(new RegExp(`(?:${months.join("|")})[-_\\s]+(0?[1-9]|[12]\\d|3[01])[-_\\s]+(20\\d{2})`, "i"));
    if (named) return new Date(Date.UTC(Number(named[2]), months.indexOf(named[0].match(/[a-z]+/i)![0].toLowerCase()), Number(named[1])));
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
  $(STRIP).remove();

  const title = (
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    ""
  ).replace(/\s+/g, " ").replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, "").trim();

  const author =
    $('meta[name="author"]').attr("content") ||
    $('[rel="author"]').first().text().trim() ||
    null;

  const dateStr =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time[datetime]").attr("datetime") ||
    $('meta[name="date"]').attr("content") ||
    $('meta[itemprop="datePublished"]').attr("content") ||
    html.match(/"(?:datePublished|PublishedDate)"\s*:\s*"([^"\\]+)"/i)?.[1] ||
    "";
  const publishedAt = dateStr ? parsePublicationDate(dateStr) : null;

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

  const text = segments.map((s) => s.text).join("\n\n");

  return {
    title,
    text,
    segments,
    author: author?.slice(0, 120) || null,
    publishedAt,
  };
}

/**
 * Reject non-research pages (nav dumps, marketing, FAQ) before they pollute the DB.
 * The strongest signal for a jammed menu is very long space-free tokens
 * ("PersonalBankingWealthBanking…") and a shortage of real sentences.
 */
/** Menu/nav dumps concatenate link labels into very long space-free tokens. */
export function isJunk(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  const longest = tokens.reduce((m, t) => Math.max(m, t.length), 0);
  if (longest > 45) return true;
  const jammed = tokens.filter((t) => t.length > 22).length / tokens.length;
  return jammed > 0.06;
}

/** Strict article check for extracted HTML content. */
export function looksLikeArticle(title: string, text: string): boolean {
  if (!title || text.length < 400) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 60) return false;
  if (isJunk(text)) return false;
  const sentences = (text.match(/[.!?。！？]/g) || []).length;
  return sentences >= 4;
}
