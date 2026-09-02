import type { Prisma } from "@prisma/client";
import { directionLabel } from "./assets";

/**
 * The public shape of a research report.
 *
 * What is served is this platform's own derived signal — the summary, the extracted
 * views, the direction and target for each asset — plus enough metadata to attribute a
 * report and link back to it. The publisher's article body and rendered PDFs are
 * deliberately absent: displaying licensed third-party research on this site is not the
 * same act as redistributing it to another party's systems.
 */

export const researchInclude = {
  institution: { select: { slug: true, name: true, country: true, authorityScore: true } },
  analysis: true,
  translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } },
  articleAssets: { include: { asset: { select: { ticker: true, name: true, assetClass: true } } } },
  atomicViews: { orderBy: { position: "asc" } },
} satisfies Prisma.ArticleInclude;

type ResearchRow = Prisma.ArticleGetPayload<{ include: typeof researchInclude }>;

function jsonList(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeResearch(article: ResearchRow) {
  return {
    id: article.id,
    title: { en: article.title, zh: article.translations[0]?.title ?? null },
    author: article.author,
    language: article.language,
    publishedAt: article.publishedAt.toISOString(),
    ingestedAt: article.createdAt.toISOString(),
    sourceUrl: article.sourceUrl,
    institution: {
      slug: article.institution.slug,
      name: article.institution.name,
      country: article.institution.country,
      authorityScore: article.institution.authorityScore,
    },
    analysis: article.analysis && {
      summary: { en: article.analysis.summary, zh: article.analysis.summaryZh },
      keyArguments: { en: jsonList(article.analysis.keyArguments), zh: jsonList(article.analysis.keyArgumentsZh) },
      keyNumbers: { en: jsonList(article.analysis.keyNumbers), zh: jsonList(article.analysis.keyNumbersZh) },
      risks: { en: jsonList(article.analysis.risks), zh: jsonList(article.analysis.risksZh) },
      interpretation: { en: article.analysis.interpretation, zh: article.analysis.interpretationZh },
      importanceScore: article.analysis.importanceScore,
      confidence: article.analysis.confidence,
    },
    assets: article.articleAssets.map((link) => ({
      ticker: link.asset.ticker,
      name: link.asset.name,
      assetClass: link.asset.assetClass,
      direction: link.direction,
      directionLabel: directionLabel(link.direction).label,
      target: link.target,
      previousTarget: link.previousTarget,
      timeHorizon: link.timeHorizon,
      confidence: link.confidence,
    })),
    views: article.atomicViews.map((view) => ({
      position: view.position,
      type: view.type,
      asset: view.asset,
      assetTicker: view.assetTicker,
      topic: view.topic,
      direction: view.direction,
      timeHorizon: view.timeHorizon,
      value: view.value,
      text: { en: view.viewEn, zh: view.viewZh },
      condition: { en: view.conditionEn, zh: view.conditionZh },
      rationale: { en: view.rationaleEn, zh: view.rationaleZh },
      confidence: view.confidence,
      importance: view.importance,
    })),
  };
}
