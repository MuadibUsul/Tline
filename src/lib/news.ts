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
}

export function newsTitle(post: NewsRecord, locale: Locale): string | null {
  const value = locale === "zh-CN" ? post.titleZh : post.titleEn;
  return value?.trim() || null;
}

export function newsBody(post: NewsRecord, locale: Locale): string | null {
  const value = locale === "zh-CN" ? post.bodyZh : post.bodyEn;
  return value?.trim() || null;
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
  const transliterated = ascii.length >= 3
    ? ascii
    : pinyin(title, { toneType: "none", type: "string", nonZh: "consecutive" })
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
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
  return issues;
}

/** Newest published first, pinned ahead of the stream, limited to what this language reads. */
export async function listPublishedNews(locale: Locale, take = 60): Promise<NewsRecord[]> {
  const rows = await prisma.newsPost.findMany({
    where: { status: "published", publishedAt: { lte: new Date() } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: take * 3,
  });
  return rows.filter((row) => newsTitle(row as NewsRecord, locale) !== null).slice(0, take);
}

export async function getPublishedNewsBySlug(slug: string): Promise<NewsRecord | null> {
  const row = await prisma.newsPost.findFirst({ where: { slug, status: "published", publishedAt: { lte: new Date() } } });
  return (row as NewsRecord | null) ?? null;
}
