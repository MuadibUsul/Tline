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
  const basePath = base.pathname.replace(/\/$/, "");
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
    if (DENY.test(path)) return;
    // Must be under the research section OR clearly article-shaped.
    const underSection = basePath.length > 1 && path.startsWith(basePath);
    if (!underSection && !looksLikeArticleUrl(path)) return;
    const key = abs.href.split("#")[0].split("?")[0];
    if (!out.has(key) && key !== baseUrl.replace(/\/$/, "")) out.set(key, text);
  });

  return [...out.entries()].map(([url, title]) => ({ url, title })).slice(0, 12);
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
    "";
  const publishedAt = dateStr ? new Date(dateStr) : null;

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

  const text = segments.map((s) => s.text).join("\n\n").slice(0, 16000);

  return {
    title,
    text,
    segments,
    author: author?.slice(0, 120) || null,
    publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
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

/** Strict article check for HTML-extracted content (RSS snippets are exempt). */
export function looksLikeArticle(title: string, text: string): boolean {
  if (!title || text.length < 400) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 60) return false;
  if (isJunk(text)) return false;
  const sentences = (text.match(/[.!?。！？]/g) || []).length;
  return sentences >= 4;
}
