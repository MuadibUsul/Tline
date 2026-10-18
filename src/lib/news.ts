import { createHash } from "node:crypto";
import { pinyin } from "pinyin-pro";
import { prisma } from "./db";
import { LOCALES, type Locale } from "./i18n";

/**
 * 新鲜事 — the newsroom stream.
 *
 * An operator-written news item: an article (a longer piece), a brief (a paragraph), or a
 * flash (one or two sentences). Its own table on purpose: a news post is not a crawled
 * report, does not enter the ingest / translation / classification / social pipelines, and
 * the publication gate that decides whether a report exists does not apply — publishing is
 * the operator's own audited action, and the only thing the gate would have asked about
 * (source transparency) is carried directly by the item.
 */

export const NEWS_KINDS = ["article", "brief", "flash"] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

export const NEWS_KIND_LABEL: Record<NewsKind, { en: string; zh: string }> = {
  article: { en: "Article", zh: "文章" },
  brief: { en: "Brief", zh: "短讯" },
  flash: { en: "Flash", zh: "快讯" },
};

export function isNewsKind(value: unknown): value is NewsKind {
  return typeof value === "string" && (NEWS_KINDS as readonly string[]).includes(value);
}

export interface NewsColumnSummary {
  slug: string;
  nameZh: string;
  nameEn: string | null;
  cadence?: string | null;
}

export interface NewsImageRecord {
  id: string;
  position: number;
  caption: string | null;
  alt: string | null;
  captionZh: string | null;
  captionEn: string | null;
  altZh: string | null;
  altEn: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
}

/** The caption for this edition, falling back to the desk's original text. */
export function newsImageCaption(image: Pick<NewsImageRecord, "caption" | "captionZh" | "captionEn">, locale: Locale): string | null {
  const localized = locale === "zh-CN" ? image.captionZh : image.captionEn;
  return localized?.trim() || image.caption?.trim() || null;
}

/** The alt text for this edition; never empty when a caption exists. */
export function newsImageAlt(image: Pick<NewsImageRecord, "caption" | "captionZh" | "captionEn" | "alt" | "altZh" | "altEn">, locale: Locale): string {
  const localized = locale === "zh-CN" ? image.altZh : image.altEn;
  return localized?.trim() || image.alt?.trim() || newsImageCaption(image, locale) || "";
}

export interface NewsRecord {
  id: string;
  slug: string;
  kind: string;
  titleZh: string | null;
  titleEn: string | null;
  bodyZh: string | null;
  bodyEn: string | null;
  sourceUrl: string | null;
  status: string;
  pinned: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
  column?: NewsColumnSummary | null;
  images?: NewsImageRecord[];
  sources?: Array<{ url: string }>;
}

/** Every source a reader should be able to open, primary first, without duplicates. */
export function newsSources(post: Pick<NewsRecord, "sourceUrl" | "sources">): string[] {
  const urls = (post.sources ?? []).map((source) => source.url).filter(Boolean);
  if (post.sourceUrl) urls.unshift(post.sourceUrl);
  return [...new Set(urls)];
}

export function newsColumnName(column: NewsColumnSummary, locale: Locale): string {
  return (locale === "zh-CN" ? column.nameZh : column.nameEn) || column.nameZh;
}

export function newsCadenceLabel(cadence: string | null | undefined, locale: Locale): string {
  const zh = locale === "zh-CN";
  switch (cadence) {
    case "daily": return zh ? "每日更新" : "Daily";
    case "weekly": return zh ? "每周更新" : "Weekly";
    case "monthly": return zh ? "每月更新" : "Monthly";
    default: return zh ? "长期更新" : "Ongoing";
  }
}

/**
 * Whether a paragraph is a section heading. The desk writes "二、战况" on its own line, but
 * also opens the brief with "一、 俄 315 架…" as a full paragraph — so a numeral alone is
 * not enough; a heading is short.
 *
 * The English edition is a translation of the same paragraphs, so its headings keep the
 * numeral in Latin form ("II. Combat Situation"). Recognising only Chinese numerals made
 * every English section label a body paragraph — the text was there, but the page lost the
 * structure the Chinese edition has.
 */
export function newsParagraphRole(text: string): "heading" | "body" {
  const value = text.trim();
  if (value.length > 32) return "body";
  // A section label is a label, not a sentence: "二、战况" is a heading, "一、 一段话。" is
  // the opening paragraph even when it is short.
  if (/[。；！？.]$/.test(value)) return "body";
  if (/^(?:[一二三四五六七八九十]+、|【[^】]{2,20}】$)/.test(value)) return "heading";
  if (/^[IVXLC]{1,5}[.)]\s+\S/.test(value)) return "heading";
  return "body";
}

/** A list excerpt made of body paragraphs only, so section labels never run into the prose. */
export function newsExcerpt(post: NewsRecord, locale: Locale, limit = 220): string {
  const text = splitNewsParagraphs(newsBody(post, locale))
    .filter((paragraph) => newsParagraphRole(paragraph) === "body")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export function newsTitle(post: NewsRecord, locale: Locale): string | null {
  const value = locale === "zh-CN" ? post.titleZh : post.titleEn;
  return value?.trim() || null;
}

export function newsBody(post: NewsRecord, locale: Locale): string | null {
  const value = locale === "zh-CN" ? post.bodyZh : post.bodyEn;
  return value?.trim() || null;
}

/**
 * The body the stream shows in place, rather than behind a permalink.
 *
 * A flash is a sentence and a brief is a paragraph; making a reader open a page to see
 * either is a click for nothing. An article is thousands of characters and keeps its
 * excerpt and its page.
 */
export function newsInlineParagraphs(post: NewsRecord, locale: Locale): string[] {
  const kind = isNewsKind(post.kind) ? post.kind : "brief";
  return kind === "flash" || kind === "brief" ? splitNewsParagraphs(newsBody(post, locale)) : [];
}

/** The languages this item can actually be read in. */
export function newsLocales(post: NewsRecord): Locale[] {
  return LOCALES.filter((locale) => newsTitle(post, locale) !== null);
}

/** Body paragraphs: blank-line separated, trimmed, empty runs dropped. */
export function splitNewsParagraphs(body: string | null | undefined): string[] {
  return (body ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * The desk's calendar is Beijing time, like the macro calendar's clocks.
 *
 * Both the day grouping and the printed date go through these, so a flash published at
 * 01:00 in Shanghai is filed and labelled under that day, not the previous UTC day.
 */
const DESK_TIME_ZONE = "Asia/Shanghai";

export function newsDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DESK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function newsDateLabel(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeZone: DESK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** A relative stamp for the front-page rail, falling back to the desk date after a day. */
export function newsAgo(date: Date, locale: Locale, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return locale === "zh-CN" ? "刚刚" : "now";
  if (minutes < 60) return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "zh-CN" ? `${hours} 小时前` : `${hours} hr ago`;
  return newsDateLabel(date, locale);
}

/**
 * A stable, readable slug: the Latin title as-is; a Chinese title transliterated (the
 * site already ships pinyin-pro for search); either way suffixed with six characters of
 * the id's digest so two headlines from the same week never collide and the address never
 * changes when a title is edited. The slug is set once, at creation.
 */
export function buildNewsSlug(title: string, id: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A Chinese title that happens to contain a date or a number ("2026-10-17-315") used to
  // win on ascii length and produce a slug with no subject in it. The presence of Han text,
  // not the count of Latin characters, decides whether the title is transliterated.
  const transliterated = /\p{Script=Han}/u.test(title)
    ? pinyin(title, { toneType: "none", type: "string", nonZh: "consecutive" })
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : ascii;
  const stem = (transliterated || "news").slice(0, 60).replace(/-+$/g, "");
  return `${stem}-${createHash("sha256").update(id).digest("hex").slice(0, 6)}`;
}

export interface NewsIssue { code: string; message: string }

export interface NewsInput {
  kind?: string;
  titleZh?: string;
  titleEn?: string;
  bodyZh?: string;
  bodyEn?: string;
  sourceUrl?: string;
  sources?: string[];
  columnSlug?: string;
}

const TITLE_MAX = 300;
const BODY_MAX = 40_000;
const TITLE_MIN = 2;

/**
 * Field rules for the editor. One of the two languages must be present — an item nobody
 * can read in either language is not content — and a body may only accompany its own
 * language's title. A flash may be title-only; a longer piece wants a body.
 */
export function validateNewsInput(input: NewsInput): NewsIssue[] {
  const issues: NewsIssue[] = [];
  const zh = input.titleZh?.trim() ?? "";
  const en = input.titleEn?.trim() ?? "";
  const bodyZh = input.bodyZh?.trim() ?? "";
  const bodyEn = input.bodyEn?.trim() ?? "";

  if (input.kind !== undefined && !isNewsKind(input.kind)) issues.push({ code: "kind.invalid", message: "Unknown news kind." });
  if (!zh && !en) issues.push({ code: "title.required", message: "At least one language needs a title." });
  if (zh && zh.length < TITLE_MIN) issues.push({ code: "title.zh_short", message: "The Chinese title is too short." });
  if (en && en.length < TITLE_MIN) issues.push({ code: "title.en_short", message: "The English title is too short." });
  if (zh.length > TITLE_MAX || en.length > TITLE_MAX) issues.push({ code: "title.long", message: `Titles are limited to ${TITLE_MAX} characters.` });
  if (bodyZh.length > BODY_MAX || bodyEn.length > BODY_MAX) issues.push({ code: "body.long", message: `Bodies are limited to ${BODY_MAX} characters.` });
  if (bodyZh && !zh) issues.push({ code: "body.zh_without_title", message: "A Chinese body needs a Chinese title." });
  if (bodyEn && !en) issues.push({ code: "body.en_without_title", message: "An English body needs an English title." });
  if (input.sourceUrl?.trim()) {
    try {
      const url = new URL(input.sourceUrl.trim());
      if (url.protocol !== "https:") issues.push({ code: "sourceUrl.not_https", message: "Source URL must use https." });
    } catch {
      issues.push({ code: "sourceUrl.invalid", message: "Source URL is not a valid URL." });
    }
  }
  // A brief is often a synthesis: several sources, and the same dashboard may appear every
  // day. URLs are display metadata here, not a uniqueness key.
  const sources = input.sources ?? [];
  if (sources.length > 10) issues.push({ code: "sources.too_many", message: "At most 10 sources per item." });
  sources.forEach((source, index) => {
    try {
      const url = new URL(source.trim());
      if (url.protocol !== "https:") issues.push({ code: "sources.not_https", message: `Source ${index + 1} must use https.` });
    } catch {
      issues.push({ code: "sources.invalid", message: `Source ${index + 1} is not a valid URL.` });
    }
  });
  return issues;
}

/** Newest published first, pinned ahead of the stream, limited to what this language reads. */
export async function listPublishedNews(locale: Locale, take = 60): Promise<NewsRecord[]> {
  const rows = await prisma.newsPost.findMany({
    where: { status: "published", publishedAt: { lte: new Date() } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: take * 3,
    include: {
      column: { select: { slug: true, nameZh: true, nameEn: true, cadence: true } },
      images: { orderBy: { position: "asc" }, take: 1, select: { id: true, position: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true, mimeType: true, width: true, height: true } },
    },
  });
  return rows.filter((row) => newsTitle(row as NewsRecord, locale) !== null).slice(0, take) as NewsRecord[];
}

export async function getPublishedNewsBySlug(slug: string): Promise<NewsRecord | null> {
  const row = await prisma.newsPost.findFirst({
    where: { slug, status: "published", publishedAt: { lte: new Date() } },
    include: {
      column: { select: { slug: true, nameZh: true, nameEn: true, cadence: true } },
      images: { orderBy: { position: "asc" }, select: { id: true, position: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true, mimeType: true, width: true, height: true } },
      sources: { orderBy: { position: "asc" }, select: { url: true } },
    },
  });
  return (row as NewsRecord | null) ?? null;
}

/**
 * Columns that have at least one published edition in this language, with their editions.
 *
 * The post filter is applied in memory because it depends on which title column this locale
 * reads; a column with no readable edition is not advertised in that language.
 */
export async function listPublishedColumns(locale: Locale): Promise<Array<NewsColumnSummary & {
  descriptionZh: string | null;
  descriptionEn: string | null;
  posts: NewsRecord[];
}>> {
  const rows = await prisma.newsColumn.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      posts: {
        where: { status: "published", publishedAt: { lte: new Date() } },
        orderBy: { publishedAt: "desc" },
        include: { column: { select: { slug: true, nameZh: true, nameEn: true, cadence: true } }, images: { orderBy: { position: "asc" }, take: 1, select: { id: true, position: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true, mimeType: true, width: true, height: true } } },
      },
    },
  });
  return rows
    .map((row) => ({ ...row, posts: row.posts.filter((post) => newsTitle(post as NewsRecord, locale) !== null) as NewsRecord[] }))
    .filter((row) => row.posts.length > 0);
}

export async function getPublishedColumnBySlug(slug: string, locale: Locale): Promise<(NewsColumnSummary & {
  descriptionZh: string | null;
  descriptionEn: string | null;
  posts: NewsRecord[];
}) | null> {
  const row = await prisma.newsColumn.findUnique({
    where: { slug },
    include: {
      posts: {
        where: { status: "published", publishedAt: { lte: new Date() } },
        orderBy: { publishedAt: "desc" },
        include: { column: { select: { slug: true, nameZh: true, nameEn: true, cadence: true } }, images: { orderBy: { position: "asc" }, take: 1, select: { id: true, position: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true, mimeType: true, width: true, height: true } } },
      },
    },
  });
  if (!row) return null;
  const posts = row.posts.filter((post) => newsTitle(post as NewsRecord, locale) !== null) as NewsRecord[];
  return posts.length ? { ...row, posts } : null;
}
