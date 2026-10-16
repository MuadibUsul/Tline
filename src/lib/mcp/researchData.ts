import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { publicationReadyWhere } from "../publication";
import { researchInclude, serializeResearch } from "../apiSerialize";
import { researchPath, researchLookupWhere } from "../researchPath";
import { searchSite } from "../search";
import { classificationWhere } from "../classification/query";
import { resolveCanonicalKey } from "../classification/taxonomy";
import type { ContentFilter } from "../classification/types";
import { institutionName, localePath, type Locale } from "../i18n";
import { siteUrl } from "../site";

/**
 * Research reads for MCP. The public boundary is not re-derived here — every query asks
 * `publicationReadyWhere()`, and a detail is served through `serializeResearch`, so an
 * address a page 404s is a tool answer NOT_FOUND, and the derived shape the agent gets is
 * the same one the public API serves. What is *not* served is the same as on the site:
 * no `rawText`, no translation body, no document download.
 */

/** How deep the ranked search window goes. Bounds cursor pagination — no infinite paging. */
const SEARCH_WINDOW = 200;

/** Snippets are a preview, not the product: long enough to judge, short enough to be cheap. */
const MAX_SNIPPET = 240;

function snippet(...candidates: Array<string | null | undefined>): string | null {
  const text = candidates.find((value) => value && value.trim().length > 0);
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_SNIPPET ? `${clean.slice(0, MAX_SNIPPET - 1)}…` : clean;
}

/** Opaque, single-use cursor: a ranked window offset. Stable while the search index is. */
export function encodeSearchCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeSearchCursor(cursor: string): number | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = (parsed as { o?: unknown })?.o;
    return typeof offset === "number" && Number.isInteger(offset) && offset > 0 && offset <= SEARCH_WINDOW ? offset : null;
  } catch {
    return null;
  }
}

export interface SnippetResult {
  id: string;
  slug: string;
  kind: "article" | "view";
  title: string;
  institution?: { slug: string; name: string };
  publishedAt?: string;
  snippet?: string;
  pageUrl: string;
}

export type SearchOutcome =
  | { ok: true; data: { query: string; asOf: string; results: SnippetResult[]; nextCursor: string | null } }
  | { ok: false; code: "INVALID_RANGE"; message: string };

export interface SearchInput {
  query: string;
  locale: Locale;
  institution?: string;
  ticker?: string;
  economy?: string;
  topic?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit: number;
}

export async function readResearchSearch(input: SearchInput): Promise<SearchOutcome> {
  const { locale } = input;
  if (input.dateFrom && input.dateTo && input.dateFrom.getTime() > input.dateTo.getTime()) {
    return { ok: false, code: "INVALID_RANGE", message: "'dateFrom' must not be later than 'dateTo'." };
  }
  let offset = 0;
  if (input.cursor) {
    const decoded = decodeSearchCursor(input.cursor);
    if (decoded === null) return { ok: false, code: "INVALID_RANGE", message: "'cursor' is not a cursor this tool issued." };
    offset = decoded;
  }
  const empty = { ok: true as const, data: { query: input.query, asOf: new Date().toISOString(), results: [], nextCursor: null } };
  if (offset >= SEARCH_WINDOW) return empty;
  const requested = Math.min(offset + input.limit, SEARCH_WINDOW);

  // The ranking is the site's own search index (version-cached), not a second text
  // matcher; the MCP layer only filters what it finds when hydrating from the database.
  const hits = (await searchSite(input.query, requested, locale)).filter((hit) => hit.kind === "article" || hit.kind === "view");
  if (!hits.length) return empty;

  // Classification facets, resolved against the same taxonomy the site filters use. An
  // unrecognised value matches nothing rather than being dropped — the same rule the
  // /research filters apply, so MCP and the site answer the same question the same way.
  const facet: ContentFilter = {};
  for (const [kind, value] of [["jurisdiction", input.economy], ["topic", input.topic]] as const) {
    if (!value) continue;
    const canonical = resolveCanonicalKey(kind, value);
    if (!canonical) return empty;
    if (kind === "jurisdiction") (facet.jurisdictions ??= []).push(canonical);
    else (facet.topics ??= []).push(canonical);
  }

  // The publisher filter resolves case-insensitively against the institution registry
  // (a handful of rows) and then filters the corpus query by exact slug — `mode:
  // "insensitive"` is unavailable on the SQLite client and has different semantics from
  // LIKE, so resolving here keeps dev and production answering the same question.
  let institutionSlugs: string[] | null = null;
  if (input.institution) {
    const needle = input.institution.trim().toLowerCase();
    const registry = await prisma.institution.findMany({ select: { slug: true, name: true } });
    institutionSlugs = registry
      .filter((row) => row.slug.toLowerCase() === needle || row.name.toLowerCase().includes(needle))
      .map((row) => row.slug);
    if (!institutionSlugs.length) return empty;
  }

  const filters: Prisma.ArticleWhereInput = {
    ...(institutionSlugs ? { institution: { slug: { in: institutionSlugs } } } : {}),
    ...(input.ticker ? { articleAssets: { some: { asset: { ticker: input.ticker.toUpperCase() } } } } : {}),
    ...(Object.keys(facet).length ? { classification: { is: classificationWhere(facet) } } : {}),
    ...(input.dateFrom || input.dateTo
      ? { publishedAt: { ...(input.dateFrom ? { gte: input.dateFrom } : {}), ...(input.dateTo ? { lte: input.dateTo } : {}) } }
      : {}),
  };

  const articleIds = hits.filter((hit) => hit.kind === "article").map((hit) => hit.id);
  const viewIds = hits.filter((hit) => hit.kind === "view").map((hit) => hit.id);

  const [articles, views] = await Promise.all([
    articleIds.length
      ? prisma.article.findMany({
          where: publicationReadyWhere({ ...filters, id: { in: articleIds } }, locale),
          select: {
            id: true, slug: true, title: true, publishedAt: true,
            institution: { select: { slug: true, name: true } },
            analysis: { select: { summary: true, summaryZh: true } },
            translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } },
          },
        })
      : Promise.resolve([]),
    viewIds.length
      ? prisma.atomicView.findMany({
          where: { id: { in: viewIds }, reviewStatus: "ok", article: publicationReadyWhere(filters) },
          select: {
            id: true, viewEn: true, viewZh: true, createdAt: true,
            article: {
              select: {
                slug: true, publishedAt: true,
                institution: { select: { slug: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const hydrated = new Map<string, SnippetResult>();
  for (const article of articles) {
    hydrated.set(article.id, {
      id: article.id,
      slug: article.slug,
      kind: "article",
      title: locale === "zh-CN" ? article.translations[0]?.title ?? article.title : article.title,
      institution: { slug: article.institution.slug, name: institutionName(article.institution.name, locale) },
      publishedAt: article.publishedAt.toISOString(),
      ...(snippet(article.analysis?.summary, article.analysis?.summaryZh) ? { snippet: snippet(article.analysis?.summary, article.analysis?.summaryZh)! } : {}),
      pageUrl: `${siteUrl()}${localePath(locale, researchPath(article))}`,
    });
  }
  for (const view of views) {
    const text = locale === "zh-CN" ? view.viewZh || view.viewEn : view.viewEn || view.viewZh;
    hydrated.set(view.id, {
      id: view.id,
      slug: view.article.slug,
      kind: "view",
      title: snippet(text) ?? "(empty view)",
      institution: { slug: view.article.institution.slug, name: institutionName(view.article.institution.name, locale) },
      publishedAt: view.article.publishedAt.toISOString(),
      ...(text ? { snippet: snippet(text)! } : {}),
      pageUrl: `${siteUrl()}${localePath(locale, `/research/${view.article.slug}`)}`,
    });
  }

  // Rank order from the search index is preserved; the slice applies to the *ranked*
  // window, so a filtered page may be shorter than `limit` — the cursor still walks.
  const ordered = hits.map((hit) => hydrated.get(hit.id)).filter((row): row is SnippetResult => Boolean(row));
  const results = ordered.slice(offset, offset + input.limit);
  const nextCursor = hits.length === requested && requested < SEARCH_WINDOW ? encodeSearchCursor(offset + input.limit) : null;
  return { ok: true, data: { query: input.query, asOf: new Date().toISOString(), results, nextCursor } };
}

export type ResearchOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: "NOT_FOUND"; message: string };

export async function readResearch(identifier: string, locale: Locale): Promise<ResearchOutcome> {
  const article = await prisma.article.findFirst({
    where: publicationReadyWhere(researchLookupWhere(identifier)),
    include: researchInclude,
  });
  if (!article) return { ok: false, code: "NOT_FOUND", message: "No public report matches that id or slug." };
  return {
    ok: true,
    data: {
      ...serializeResearch(article),
      pageUrl: `${siteUrl()}${localePath(locale, researchPath(article))}`,
      asOf: new Date().toISOString(),
    },
  };
}

export interface InstitutionRow {
  slug: string;
  name: string;
  country: string | null;
  authorityScore: number | null;
  reportCount: number;
  pageUrl: string;
}

export type InstitutionsOutcome =
  | { ok: true; data: { institutions: InstitutionRow[]; nextCursor: string | null } }
  | { ok: false; code: "INVALID_RANGE"; message: string };

export async function readInstitutions(options: { country?: string; cursor?: string; limit: number; locale: Locale }): Promise<InstitutionsOutcome> {
  const { locale } = options;
  if (options.cursor && !(await prisma.institution.findUnique({ where: { id: options.cursor }, select: { id: true } }))) {
    return { ok: false, code: "INVALID_RANGE", message: "'cursor' does not match a known institution." };
  }
  // Country values are stored as published; the caller's spelling is matched against the
  // distinct values case-insensitively (a few dozen rows) before the exact filter applies.
  let country: string | undefined;
  if (options.country) {
    const needle = options.country.trim().toLowerCase();
    const distinct = await prisma.institution.findMany({ where: { country: { not: null } }, distinct: ["country"], select: { country: true } });
    country = distinct.map((row) => row.country).find((value) => value?.toLowerCase() === needle) ?? undefined;
    if (!country) return { ok: true, data: { institutions: [], nextCursor: null } };
  }
  const rows = await prisma.institution.findMany({
    where: {
      articles: { some: publicationReadyWhere() },
      ...(country ? { country } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      slug: true,
      name: true,
      country: true,
      authorityScore: true,
      // The public subset, not every article row: a listing that counted drafts would
      // advertise a number no page could show.
      _count: { select: { articles: { where: publicationReadyWhere() } } },
    },
  });
  const page = rows.slice(0, options.limit);
  return {
    ok: true,
    data: {
      institutions: page.map((row) => ({
        slug: row.slug,
        name: institutionName(row.name, locale),
        country: row.country,
        authorityScore: row.authorityScore,
        reportCount: row._count.articles,
        pageUrl: `${siteUrl()}${localePath(locale, `/institution/${row.slug}`)}`,
      })),
      nextCursor: rows.length > options.limit ? page[page.length - 1]?.id ?? null : null,
    },
  };
}
