import { prisma } from "./db";
import type { DashboardWidget } from "./dashboards";
import { getAssetMarketSnapshot } from "./macro/market/read";
import { queryClassifiedArticleIds } from "./classification/query";
import type { ContentFilter } from "./classification/types";
import { publicationReadyWhere } from "./publication";
import { localePath, type Locale } from "./i18n";
import { researchPath } from "./researchPath";

export interface DashboardSeriesPoint { label: string; value: number }
export type DashboardWidgetData =
  | { kind: "macro"; available: boolean; latest?: string; previous?: string; unit?: string; period?: string; points?: DashboardSeriesPoint[]; sourceUrl?: string }
  | { kind: "market"; available: boolean; latest?: string; changePct?: number; asOf?: string; points?: DashboardSeriesPoint[] }
  | { kind: "research"; items: Array<{ title: string; meta: string; href: string }> }
  | { kind: "static" };

const day = (date: Date) => date.toISOString().slice(0, 10);

async function macroData(ref: string): Promise<DashboardWidgetData> {
  const indicator = await prisma.macroIndicator.findUnique({
    where: { canonicalKey: ref },
    include: {
      seriesSources: {
        where: { enabled: true },
        orderBy: { priority: "asc" },
        take: 1,
        include: { observations: { where: { status: "PUBLISHED" }, orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 40 } },
      },
    },
  });
  const source = indicator?.seriesSources[0];
  const observations = source?.observations.filter((item, index, rows) => rows.findIndex((row) => row.period.getTime() === item.period.getTime()) === index) ?? [];
  if (!indicator || !observations.length) return { kind: "macro", available: false };
  return {
    kind: "macro",
    available: true,
    latest: observations[0].value.toString(),
    previous: observations[1]?.value.toString(),
    unit: indicator.unit,
    period: day(observations[0].period),
    sourceUrl: source?.sourceUrl ?? undefined,
    points: observations.slice().reverse().map((item) => ({ label: day(item.period), value: Number(item.value) })),
  };
}

async function marketData(ref: string): Promise<DashboardWidgetData> {
  const snapshot = await getAssetMarketSnapshot(ref);
  if (!snapshot.available) return { kind: "market", available: false };
  const first = snapshot.history[0];
  const latest = snapshot.observation;
  return {
    kind: "market",
    available: true,
    latest: latest.close.toString(),
    changePct: first ? (Number(latest.close) / Number(first.close) - 1) * 100 : undefined,
    asOf: latest.observedAt.toISOString(),
    points: snapshot.history.map((item) => ({ label: day(item.observedAt), value: Number(item.close) })),
  };
}

async function researchData(widget: DashboardWidget, locale: Locale): Promise<DashboardWidgetData> {
  if (!widget.ref) return { kind: "research", items: [] };
  const filter: ContentFilter = widget.scopeKind === "institution" ? { institutions: [widget.ref] }
    : widget.scopeKind === "topic" ? { topics: [widget.ref] }
      : { assets: [widget.ref.toUpperCase()] };
  const ids = await queryClassifiedArticleIds(filter, 30);
  const articles = ids.length ? await prisma.article.findMany({
    where: publicationReadyWhere({ id: { in: ids } }, locale),
    orderBy: { publishedAt: "desc" },
    take: 5,
    select: { slug: true, title: true, publishedAt: true, institution: { select: { name: true } }, translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } } },
  }) : [];
  return {
    kind: "research",
    items: articles.map((article) => ({
      title: locale === "zh-CN" ? article.translations[0]?.title ?? article.title : article.title,
      meta: `${article.institution.name} · ${day(article.publishedAt)}`,
      href: localePath(locale, researchPath(article)),
    })),
  };
}

export async function loadDashboardWidgetData(widgets: DashboardWidget[], locale: Locale): Promise<Record<string, DashboardWidgetData>> {
  const pairs = await Promise.all(widgets.map(async (widget) => {
    const data = widget.type === "macro" && widget.ref ? await macroData(widget.ref)
      : widget.type === "market" && widget.ref ? await marketData(widget.ref)
        : widget.type === "research" ? await researchData(widget, locale)
          : { kind: "static" as const };
    return [widget.id, data] as const;
  }));
  return Object.fromEntries(pairs);
}
