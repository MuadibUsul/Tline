import { prisma } from "./db";
import { contentQuality } from "./contentQuality";
import { LOCALES, type Locale } from "./i18n";

/**
 * The publication gate, evaluated once per change instead of once per read.
 *
 * `contentQuality` decides whether a report exists at an address at all, and the page keeps
 * calling it per request — that is deliberate, and it is why a report the pipeline later
 * repairs comes back on its own with nothing to re-run. The gate is a pure function of the
 * row, so evaluating it again costs nothing but the read.
 *
 * What a read cannot afford is the gate's *inputs*: every issue it looks for needs the body,
 * the summary and the translation. So a listing that wanted to agree with the page had to
 * fetch all of it — the research feed was pulling 490 KB to render twenty cards, and a sitemap
 * shard was fetching 34 MB — and the listings that could not afford it simply asked
 * `publicationReadyWhere` instead and advertised cards whose page answers 404.
 *
 * This module writes the answer down when the inputs change. The page keeps computing it live;
 * the listings and the sitemap read the boolean; and `gateIssues` is the answer to "why is
 * this report not public", which until now existed nowhere but inside a request.
 */
const GATE_SELECT = {
  title: true,
  rawText: true,
  sourceUrl: true,
  language: true,
  analysis: { select: { summary: true, summaryZh: true, reviewStatus: true } },
  translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true } },
} as const;

export interface GateArticle {
  title: string;
  rawText: string | null;
  sourceUrl: string;
  language: string;
  analysis: { summary: string; summaryZh?: string | null; reviewStatus: string } | null;
  translations: Array<{ title: string; text?: string; qualityScore: number | null; status: string }>;
}

export interface GateVerdict {
  indexable: Record<Locale, boolean>;
  issues: Record<Locale, string[]>;
}

/** The gate's answer for one article, in the shape the columns store. */
export function gateVerdict(article: GateArticle): GateVerdict {
  const indexable = {} as Record<Locale, boolean>;
  const issues = {} as Record<Locale, string[]>;
  for (const locale of LOCALES) {
    const result = contentQuality(article, locale);
    indexable[locale] = result.indexable;
    issues[locale] = result.issues;
  }
  return { indexable, issues };
}

/** Recompute and store the verdict for one article, after something it reads has changed. */
export async function refreshGate(articleId: string): Promise<GateVerdict | null> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: GATE_SELECT });
  if (!article) return null;
  const verdict = gateVerdict(article);
  await prisma.article.update({
    where: { id: articleId },
    data: {
      indexableEn: verdict.indexable.en,
      indexableZh: verdict.indexable["zh-CN"],
      gateIssuesEn: JSON.stringify(verdict.issues.en),
      gateIssuesZh: JSON.stringify(verdict.issues["zh-CN"]),
      gateCheckedAt: new Date(),
    },
  });
  return verdict;
}

/**
 * Recompute every stored verdict, or only those a change has been made to.
 *
 * `--stale-only` picks the rows whose analysis or translation was written after the verdict was
 * taken, which is how an operator repairs a sweep that a writer missed without re-reading the
 * whole corpus.
 */
export async function recomputeGates(options: { limit?: number; ids?: string[] } = {}) {
  const where = options.ids?.length ? { id: { in: options.ids } } : {};
  const rows = await prisma.article.findMany({
    where,
    select: { id: true },
    orderBy: { publishedAt: "desc" },
    ...(options.limit ? { take: options.limit } : {}),
  });
  let indexableEn = 0;
  let indexableZh = 0;
  for (const row of rows) {
    const verdict = await refreshGate(row.id);
    if (verdict?.indexable.en) indexableEn++;
    if (verdict?.indexable["zh-CN"]) indexableZh++;
  }
  return { checked: rows.length, indexableEn, indexableZh };
}
