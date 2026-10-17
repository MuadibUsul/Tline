import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import { computeConsensus, consensusDeltas, type ConsensusResult } from "./consensus";
import { directionLabel } from "./assets";
import { publicationReadyWhere } from "./publication";
import { articleTimestamp, type Locale } from "./i18n";
import { isLegacyNonAssetAlias } from "./classification/taxonomy";
import { listIndexableTopicsFor } from "./topics";
import { researchLookupWhere } from "./researchPath";
import { buildTargetDistribution } from "./targetDistribution";
import { validateStructuredResearch } from "./ingest/researchQuality";

/**
 * Exactly the fields a research card reads. Every listing uses this instead of `include`.
 *
 * `include` on the root model returns *every* Article column, which quietly means the whole
 * report: the feed was carrying twenty complete English bodies — and the complete Chinese
 * translation of each — to render a 260-character preview, 490 KB fetched for 47 KB shown.
 * `rawText` sits on the same row as the title, so nothing about the query looked wrong.
 *
 * It is one shared object so this cannot drift back: a listing that wants a card says
 * `select: cardArticleSelect`, and a field the card does not read has no way to get in. The
 * body is the one exception and it is not here — `withPreviewBodies` fetches it afterwards
 * only for a missing preview or to verify a stored target before display.
 */
export const cardArticleSelect = {
  id: true,
  slug: true,
  title: true,
  publishedAt: true,
  createdAt: true,
  sourceUrl: true,
  institution: { select: { name: true, slug: true } },
  analysis: { select: { summary: true, summaryZh: true } },
  translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } },
  articleAssets: { select: { direction: true, target: true, previousTarget: true, timeHorizon: true, asset: { select: { ticker: true, name: true } } } },
  classification: {
    select: {
      jurisdictionState: true,
      jurisdictions: { select: { jurisdictionKey: true, role: true } },
      topics: { select: { topicKey: true } },
      institutions: { select: { institutionKey: true, role: true } },
    },
  },
} satisfies Prisma.ArticleSelect;

export interface FeedPulse {
  latestId: string | null;
  latestAt: string | null;
  total: number;
  /** Set by the route, not the query: which server answered. */
  instance?: string;
}

/**
 * Identity of the newest published article plus the published total.
 *
 * The live feed compares the value a page was rendered with against this, so both must
 * come from here: deriving the baseline from the first poll instead would swallow
 * anything published between the render and that poll.
 */
export async function feedPulse(): Promise<FeedPulse> {
  const [newest, total] = await Promise.all([
    prisma.article.findFirst({
      where: publicationReadyWhere(),
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, publishedAt: true, createdAt: true },
    }),
    prisma.article.count({ where: publicationReadyWhere() }),
  ]);
  return {
    latestId: newest?.id ?? null,
    latestAt: (newest?.publishedAt ?? newest?.createdAt ?? null)?.toISOString() ?? null,
    total,
  };
}

/** Newest first by the timestamp the card actually shows. */
export function byDisplayRecency<T extends { publishedAt: Date; createdAt: Date }>(a: T, b: T) {
  return articleTimestamp(b.publishedAt, b.createdAt).getTime() - articleTimestamp(a.publishedAt, a.createdAt).getTime();
}

/**
 * Attach the body opening to the cards whose preview has to fall back to it.
 *
 * A card shows at most 260 characters of a report, and the listing pages selected the whole
 * body to get them: twenty cards fetched 490 KB to render 47 KB, of which 292 KB was complete
 * English reports — on the page a crawler reads one page at a time, and with no cache in
 * front repeating the work on every request.
 *
 * Most cards never look at the body at all, because `Analysis.summary` is what they show. So
 * the body is not part of the listing query: the rows are fetched first, and only cards whose
 * locale summary is empty or whose stored target must be source-checked go back for it. This
 * keeps ordinary direction-only cards small without letting an old unverified target render.
 *
 * The preview chain served is the card's own — English shows `summary ?? rawText`, Chinese
 * shows `summaryZh ?? translation ?? rawText` — while the fetched body used only for target
 * verification is discarded before the card props are returned.
 */
export async function withPreviewBodies<
  T extends {
    id: string;
    analysis: { summary?: string | null; summaryZh?: string | null } | null;
    translations: Array<{ title: string }>;
    articleAssets: Array<{ target: number | null; previousTarget: number | null; timeHorizon: string | null; asset: { ticker: string } }>;
  },
>(rows: T[], locale: Locale | undefined): Promise<Array<T & {
  rawText: string | null;
  translations: Array<T["translations"][number] & { text?: string }>;
  articleAssets: T["articleAssets"];
}>> {
  const needsBody = (row: T) => !(locale === "zh-CN" ? row.analysis?.summaryZh?.trim() : row.analysis?.summary?.trim());
  const ids = rows.filter((row) => needsBody(row) || row.articleAssets.some((asset) => asset.target != null || asset.previousTarget != null || asset.timeHorizon)).map((row) => row.id);
  const bodies = ids.length
    ? await prisma.article.findMany({
        where: { id: { in: ids } },
        select: { id: true, rawText: true, translations: { where: { locale: "zh-CN" }, take: 1, select: { text: true } } },
      })
    : [];
  const fallback = new Map(bodies.map((body) => [body.id, { rawText: body.rawText, translationText: body.translations[0]?.text ?? null }]));
  return rows.map((row) => {
    const body = fallback.get(row.id);
    return {
      ...row,
      rawText: needsBody(row) ? body?.rawText ?? null : null,
      articleAssets: row.articleAssets.map((asset) => {
        if (!body?.rawText) return { ...asset, target: null, previousTarget: null, timeHorizon: null };
        const safe = validateStructuredResearch({}, body.rawText, [{ ticker: asset.asset.ticker, target: asset.target, previousTarget: asset.previousTarget, timeHorizon: asset.timeHorizon }]).forecasts[0];
        return { ...asset, target: safe.target ?? null, previousTarget: safe.previousTarget ?? null, timeHorizon: safe.timeHorizon ?? null };
      }),
      translations: row.translations.map((translation) => ({ ...translation, text: body?.translationText ?? undefined })),
    };
  }) as Array<T & { rawText: string | null; translations: Array<T["translations"][number] & { text?: string }>; articleAssets: T["articleAssets"] }>;
}

/**
 * The home feed answers "what is new here", so it is ordered by when a report arrived,
 * not by when its publisher dated it.
 *
 * The two came apart once discovery looked back a week: a report published six days ago
 * and fetched an hour ago belongs at the top as far as a reader is concerned, but dated
 * ordering buried it six days down, and a day's worth of new research could land without
 * anything visibly changing.
 */
export async function latestFeed(limit = 8, locale?: Locale) {
  return withPreviewBodies(await prisma.article.findMany({
    where: publicationReadyWhere(undefined, locale),
    orderBy: [{ createdAt: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: cardArticleSelect,
  }), locale);
}

/**
 * The editorial picks, newest pick first — what an operator chose in the console to sit
 * above the chronological stream. The public gate still applies: a featured report the
 * gate withholds drops out of the lead slot like any other row.
 */
export async function featuredFeed(limit = 5, locale?: Locale) {
  return withPreviewBodies(await prisma.article.findMany({
    where: publicationReadyWhere({ featuredAt: { not: null } }, locale),
    orderBy: { featuredAt: "desc" },
    take: limit,
    select: cardArticleSelect,
  }), locale);
}

/**
 * The four coverage numbers, in one place with one set of rules: a report counts when the
 * gate admits it, an institution when it has at least one such report, an asset when at
 * least two institutions hold views on it (the same rule the markets hub applies), and a
 * topic when it clears the topic thresholds for this language. The About page shows these;
 * a homepage no longer does (2026-10-17), so this is the one口径.
 */
export async function coverageCounts(locale: Locale) {
  const [reports, institutions, assetRows, topics] = await Promise.all([
    prisma.article.count({ where: publicationReadyWhere() }),
    prisma.institution.count({ where: { articles: { some: publicationReadyWhere() } } }),
    prisma.asset.findMany({
      where: { articleAssets: { some: { article: publicationReadyWhere() } } },
      select: {
        ticker: true,
        articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true } } } },
      },
    }),
    listIndexableTopicsFor(locale),
  ]);
  const assets = assetRows.filter((asset) =>
    !isLegacyNonAssetAlias(asset.ticker)
    && asset.articleAssets.length >= 2
    && new Set(asset.articleAssets.map((row) => row.article.institutionId)).size >= 2,
  ).length;
  return { reports, institutions, assets, topics: topics.length };
}

export async function mostActive(days = 7, limit = 6) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.article.groupBy({
    by: ["institutionId"],
    where: publicationReadyWhere({ publishedAt: { gte: since } }),
    _count: { _all: true },
    orderBy: { _count: { institutionId: "desc" } },
    take: limit,
  });
  const insts = await prisma.institution.findMany({
    where: { id: { in: rows.map((r) => r.institutionId) } },
  });
  const map = new Map(insts.map((i) => [i.id, i]));
  return rows.map((r) => ({ inst: map.get(r.institutionId)!, count: r._count._all }));
}

export async function getAssetView(ticker: string, locale?: Locale) {
  const asset = await prisma.asset.findUnique({ where: { ticker: ticker.toUpperCase() } });
  if (!asset) return null;
  const [c, deltas] = await Promise.all([computeConsensus(asset.id), consensusDeltas([asset.id], [1, 7, 30])]);
  const d = deltas.get(asset.id) ?? {};
  const d1 = d[1] ?? null, d7 = d[7] ?? null, d30 = d[30] ?? null;
  // Re-check stored target values against their own source before building a public
  // distribution. Old rows predate the strict write gate and cannot be trusted merely
  // because they have a number and a horizon.
  const targetSources = c?.contributors.length ? await prisma.article.findMany({
    where: { id: { in: c.contributors.map((row) => row.articleId) } },
    select: { id: true, institutionId: true, rawText: true, articleAssets: { where: { assetId: asset.id }, take: 1, select: { target: true, previousTarget: true, timeHorizon: true, asset: { select: { ticker: true } } } } },
  }) : [];
  const safeTargets = new Map(targetSources.flatMap((row) => {
    const view = row.articleAssets[0];
    if (!view) return [];
    const safe = validateStructuredResearch({}, row.rawText ?? "", [{ ticker: view.asset.ticker, target: view.target, previousTarget: view.previousTarget, timeHorizon: view.timeHorizon }]).forecasts[0];
    return [[row.id, safe] as const];
  }));
  const consensus = c ? { ...c, contributors: c.contributors.map((row) => {
    const safe = safeTargets.get(row.articleId);
    return { ...row, target: safe?.target ?? null, previousTarget: safe?.previousTarget ?? null, timeHorizon: safe?.timeHorizon ?? null };
  }) } : null;
  const dist = buildTargetDistribution(consensus?.contributors ?? []);
  const articles = await withPreviewBodies(await prisma.article.findMany({
    where: publicationReadyWhere({ articleAssets: { some: { assetId: asset.id } } }, locale),
    orderBy: { publishedAt: "desc" },
    take: 8,
    select: cardArticleSelect,
  }), locale);
  return { asset, consensus, d1, d7, d30, dist, articles };
}

export interface InstTimeline {
  institution: string;
  slug: string;
  targetChain: number[]; // e.g. [4600, 4800, 5000]
  dirChain: { direction: number; label: string; tone: "bull" | "bear" | "neu"; when: Date }[];
  latestTone: "bull" | "bear" | "neu";
  lastChange: Date;
  hasTargetMove: boolean;
  hasDirFlip: boolean;
}

/** Per-institution target + direction evolution for one asset, changed sources first. */
export async function getAssetTimeline(assetId: string): Promise<InstTimeline[]> {
  const rows = await prisma.articleAsset.findMany({
    where: { assetId, article: publicationReadyWhere() },
    // The chain needs a direction, a target and a date per view — not the body behind them.
    include: { article: { select: { publishedAt: true, institutionId: true, rawText: true, institution: { select: { name: true, slug: true } } } } },
    orderBy: { article: { publishedAt: "asc" } },
  });
  const byInst = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.article.institutionId;
    (byInst.get(k) ?? byInst.set(k, []).get(k)!).push(r);
  }

  const out: InstTimeline[] = [];
  for (const list of byInst.values()) {
    const targets: number[] = [];
    for (const r of list) {
      const safe = validateStructuredResearch({}, r.article.rawText ?? "", [{ ticker: "asset", target: r.target, previousTarget: r.previousTarget, timeHorizon: r.timeHorizon }]).forecasts[0];
      if (safe.previousTarget != null && targets.length === 0) targets.push(safe.previousTarget);
      if (safe.target != null) targets.push(safe.target);
    }
    // de-dup consecutive equal targets
    const targetChain = targets.filter((t, i) => i === 0 || t !== targets[i - 1]);

    const dirRaw = list.map((r) => ({ ...directionLabel(r.direction), direction: r.direction, when: r.article.publishedAt }));
    const dirChain = dirRaw.filter((d, i) => i === 0 || d.direction !== dirRaw[i - 1].direction);

    const last = list[list.length - 1];
    out.push({
      institution: last.article.institution.name,
      slug: last.article.institution.slug,
      targetChain,
      dirChain,
      latestTone: directionLabel(last.direction).tone,
      lastChange: last.article.publishedAt,
      hasTargetMove: targetChain.length > 1,
      hasDirFlip: dirChain.length > 1,
    });
  }
  out.sort((a, b) => b.lastChange.getTime() - a.lastChange.getTime());
  return out;
}

export async function getInstitutionView(slug: string, locale?: Locale) {
  const inst = await prisma.institution.findUnique({ where: { slug } });
  if (!inst) return null;
  const since = new Date(Date.now() - 90 * 864e5);
  const articles = await withPreviewBodies(await prisma.article.findMany({
    where: publicationReadyWhere({ institutionId: inst.id, publishedAt: { gte: since } }, locale),
    orderBy: { publishedAt: "desc" },
    select: { ...cardArticleSelect, articleAssets: { select: { direction: true, target: true, previousTarget: true, timeHorizon: true, asset: { select: { ticker: true, name: true, assetClass: true } } } } },
  }), locale);
  // Current views = latest direction per asset.
  const views = new Map<string, { ticker: string; name: string; direction: number; target: number | null; when: Date }>();
  for (const art of articles) {
    for (const aa of art.articleAssets) {
      if (!views.has(aa.asset.ticker)) {
        views.set(aa.asset.ticker, {
          ticker: aa.asset.ticker,
          name: aa.asset.name,
          direction: aa.direction,
          target: aa.target,
          when: art.publishedAt,
        });
      }
    }
  }
  const coverage = [...new Set(articles.flatMap((a) => a.articleAssets.map((x) => x.asset.assetClass)))];
  return {
    inst,
    articles,
    count30: articles.filter((a) => a.publishedAt > new Date(Date.now() - 30 * 864e5)).length,
    views: [...views.values()].map((v) => ({ ...v, ...directionLabel(v.direction) })),
    coverage,
  };
}

export async function getResearchView(identifier: string) {
  return prisma.article.findFirst({
    where: publicationReadyWhere(researchLookupWhere(identifier)),
    include: {
      institution: true,
      analysis: true,
      segments: { orderBy: { position: "asc" } },
      figures: { orderBy: [{ afterSegmentPosition: "asc" }, { ordinal: "asc" }] },
      // Anchored to body segments like the figures, so the English and Chinese renders place
      // them identically and one stored table serves both.
      tables: { orderBy: [{ afterSegmentPosition: "asc" }, { ordinal: "asc" }] },
      // Only the kinds still produced. A Chinese PDF left from before must not be
      // offered, least of all under the English label.
      documents: {
        where: { status: "ready", kind: { in: ["source_native", "original_pdf"] } },
        orderBy: { createdAt: "asc" },
      },
      translations: {
        where: { locale: "zh-CN" },
        take: 1,
        include: { segments: { orderBy: { position: "asc" } } },
      },
      articleAssets: { include: { asset: true } },
      atomicViews: { where: { reviewStatus: "ok" }, orderBy: { position: "asc" } },
      classification: { include: { jurisdictions: true, topics: true, institutions: true } },
    },
  });
}

// China observes a fixed UTC+8 (no DST), so the Beijing week boundary is exact.
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
function endOfBeijingWeek(now: Date): Date {
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const daysUntilSunday = (7 - beijing.getUTCDay()) % 7; // week ends Sunday
  const wall = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate() + daysUntilSunday, 23, 59, 59, 999);
  return new Date(wall - BEIJING_OFFSET_MS);
}

/** A short list of high-impact macro releases scheduled for the rest of the current Beijing week. */
export async function importantReleasesThisWeek(limit = 5) {
  const now = new Date();
  return prisma.macroRelease.findMany({
    where: {
      scheduledAt: { gte: now, lte: endOfBeijingWeek(now) },
      importance: { gte: 4 },
      status: { in: ["SCHEDULED", "WAITING", "DELAYED"] },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true, titleEn: true, titleZh: true, countryCode: true, importance: true, scheduledAt: true },
  });
}

export type { ConsensusResult };
