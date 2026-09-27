import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr, localePath, type Locale } from "@/lib/i18n";
import { beijingDateTime, frequencyLabel, macroDateTime, macroNumber, unitLabel } from "@/lib/macro/presentation";
import IndicatorChart from "./IndicatorChart";
import { JsonLd, breadcrumbJsonLd, canonical, datasetJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

interface IndicatorFacts { nameEn: string; nameZh: string | null; unit: string; frequency: string; countryCode: string }

/**
 * The sentence a result shows under the title, and the one the page's Dataset carries.
 *
 * The cadence and the unit are what distinguishes one indicator page from another; without
 * them every page in the family carried the same sentence with a substituted name. The
 * Chinese side also used half-width ":" and "," between Chinese characters, which is a
 * different glyph from the full-width one a Chinese page sets.
 */
function indicatorDescription(locale: Locale, indicator: IndicatorFacts) {
  const name = locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn;
  // `frequency` and `unit` are stored as enum keys. Printing them raw put "按MONTHLY发布，单位为
  // THOUSANDS_OF_PERSONS" in a Chinese description, so both go through the same localizers the
  // page body uses.
  const frequency = frequencyLabel(indicator.frequency, locale);
  const unit = unitLabel(indicator.unit, locale);
  return tr(
    locale,
    `${name} (${indicator.countryCode}): the released series and every revision, the consensus institutions expected before each print, and the next release date. Reported ${frequency}, in ${unit}.`,
    `${name}（${indicator.countryCode}）：历史发布序列与每次修订、发布前各机构的预期共识，以及下次发布日期。按${frequency}发布，单位为${unit}。`,
  );
}

export async function generateMetadata(props: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await props.params;
  const locale = await getLocale();
  const indicator = await prisma.macroIndicator.findUnique({
    where: { canonicalKey: key },
    select: { nameEn: true, nameZh: true, unit: true, frequency: true, countryCode: true },
  });
  if (!indicator) return { title: tr(locale, "Indicator not found", "指标未找到") };
  const name = locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn;
  return {
    title: name,
    description: indicatorDescription(locale, indicator),
    ...canonical(`/macro/indicator/${key}`, locale),
  };
}

const dec = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? "—" : value.toString());
const fmtChange = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value) >= 100 ? Math.abs(value).toFixed(0) : Math.abs(value).toFixed(2)}`;

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="macro-stat"><span className="k">{label}</span><span className="v tnum">{value}</span></div>;
}

export default async function MacroIndicatorPage(props: { params: Promise<{ key: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const indicator = await prisma.macroIndicator.findUnique({
    where: { canonicalKey: params.key },
    include: { seriesSources: { orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 500 } } } },
  });
  if (!indicator) notFound();
  const nm = (en: string, zh?: string | null) => (locale === "zh-CN" ? zh ?? en : en);

  // Latest vintage per period, oldest→newest, for the chart and previous-value change.
  const byPeriod = new Map<number, { period: Date; value: number; source: (typeof indicator.seriesSources)[number] }>();
  for (const source of indicator.seriesSources) {
    for (const observation of source.observations) {
      const key = observation.period.getTime();
      if (!byPeriod.has(key)) byPeriod.set(key, { period: observation.period, value: Number(observation.value.toString()), source });
    }
  }
  const series = [...byPeriod.values()].sort((a, b) => a.period.getTime() - b.period.getTime());
  const latest = series.at(-1);
  const previous = series.at(-2);
  const change = latest && previous ? latest.value - previous.value : null;
  const window = series.slice(-12).map((point) => point.value);
  const high = window.length ? Math.max(...window) : null;
  const low = window.length ? Math.min(...window) : null;
  const up = Boolean(latest && previous && latest.value >= previous.value);

  const [calendar, nextFamily] = await Promise.all([
    prisma.macroReleaseValue.findMany({
      where: { indicatorId: indicator.id },
      orderBy: { observationPeriod: "desc" },
      take: 12,
      include: { release: { select: { id: true, releaseFamily: true, scheduledAt: true, releasedAt: true, status: true } } },
    }),
    prisma.macroReleaseValue.findFirst({ where: { indicatorId: indicator.id }, orderBy: { observationPeriod: "desc" }, select: { release: { select: { releaseFamily: true } } } }),
  ]);
  const nextRelease = nextFamily?.release.releaseFamily
    ? await prisma.macroRelease.findFirst({
        where: { releaseFamily: nextFamily.release.releaseFamily, scheduledAt: { gte: new Date() }, status: { in: ["SCHEDULED", "WAITING", "DELAYED"] } },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, scheduledAt: true },
      })
    : null;

  // Release history straight from the observation series (which has data); enrich the
  // consensus column from any captured release values (blank until a forecast feed exists).
  const consensusByPeriod = new Map(calendar.map((value) => [value.observationPeriod.getTime(), value.consensusAtRelease] as const));
  const descending = [...series].reverse();
  const history = descending.slice(0, 14).map((point, index) => ({
    period: point.period,
    value: point.value,
    previous: descending[index + 1]?.value ?? null,
    consensus: consensusByPeriod.get(point.period.getTime()) ?? null,
  }));

  return (
    <main className="wrap">
      {/*
        The page is a data series with a release history, and it carried no structured data at
        all: a crawler saw the numbers but nothing that said what they were, who published them
        or how often they change. The Dataset names the series and dates its last revision; the
        breadcrumb is the trail back to the hub that lists it.
      */}
      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Economic data", "经济数据"), path: "/macro" },
        { name: nm(indicator.nameEn, indicator.nameZh), path: `/macro/indicator/${indicator.canonicalKey}` },
      ])} />
      <JsonLd data={datasetJsonLd(
        locale,
        `/macro/indicator/${indicator.canonicalKey}`,
        nm(indicator.nameEn, indicator.nameZh),
        indicatorDescription(locale, indicator),
        latest?.period,
      )} />
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}>
        <Link href={localePath(locale, "/macro")}>{tr(locale, "Economic data", "经济数据")}</Link><span>›</span><span>{nm(indicator.nameEn, indicator.nameZh)}</span>
      </nav>
      <div className="page-head">
        <div className="eyebrow">{indicator.countryCode} · {indicator.category}</div>
        <h1>{nm(indicator.nameEn, indicator.nameZh)}</h1>
        <div className="big-score">
          <span className="num">{macroNumber(latest?.value, locale)}</span>
          <span className="mono">{unitLabel(indicator.unit, locale)}</span>
          {change !== null && <span className={`macro-change ${up ? "up" : "down"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}</span>}
        </div>
        <div className="deltas">
          <span>{tr(locale, "Frequency", "频率")}: {frequencyLabel(indicator.frequency, locale)}</span>
          <span>{tr(locale, "Seasonal adjustment", "季节调整")}: {indicator.seasonalAdjustment ?? "N/A"}</span>
          <span>{tr(locale, "Updated", "更新")}: {latest ? formatDate(latest.period, locale) : "N/A"}</span>
          {nextRelease && <span>{tr(locale, "Next release", "下次发布")}: {beijingDateTime(nextRelease.scheduledAt, locale)} ({tr(locale, "Beijing", "北京时间")})</span>}
        </div>
        <Link href={localePath(locale, "/macro")} className="minibtn" style={{ alignSelf: "flex-start" }}>← {tr(locale, "Economic data", "经济数据")}</Link>
      </div>

      {series.length >= 2 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "History", "历史走势")}</div>
          <IndicatorChart series={series.map((point) => ({ period: point.period.toISOString(), value: point.value }))} unit={unitLabel(indicator.unit, locale)} locale={locale} />
          <div className="macro-stats">
            <Stat label={tr(locale, "Latest", "最新")} value={latest ? `${latest.value}` : "—"} />
            <Stat label={tr(locale, "Previous", "前值")} value={previous ? `${previous.value}` : "—"} />
            <Stat label={tr(locale, "12-period high", "近12期高")} value={high !== null ? `${high}` : "—"} />
            <Stat label={tr(locale, "12-period low", "近12期低")} value={low !== null ? `${low}` : "—"} />
            <Stat label={tr(locale, "Unit", "单位")} value={unitLabel(indicator.unit, locale)} />
            <Stat label={tr(locale, "Frequency", "频率")} value={frequencyLabel(indicator.frequency, locale)} />
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Release history", "发布历史")}</div>
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>{tr(locale, "Reference", "参考日期")}</th>
              <th className="num-h">{tr(locale, "Actual", "现值")}</th>
              <th className="num-h">{tr(locale, "Previous", "前次数据")}</th>
              <th className="num-h">{tr(locale, "Change", "变化")}</th>
              <th className="num-h">{tr(locale, "Consensus", "市场预期值")}</th>
            </tr></thead>
            <tbody>
              {nextRelease && (
                <tr className="macro-next">
                  <td className="mono-cell">{tr(locale, "Next release", "下次发布")} · {beijingDateTime(nextRelease.scheduledAt, locale)}</td>
                  <td className="mono-cell num">{tr(locale, "Not released", "尚未发布")}</td>
                  <td className="mono-cell num">{dec(latest?.value)}</td>
                  <td className="mono-cell num">—</td>
                  <td className="mono-cell num">—</td>
                </tr>
              )}
              {history.map((row) => {
                const change = row.previous !== null ? row.value - row.previous : null;
                return (
                  <tr key={row.period.getTime()}>
                    <td className="mono-cell">{formatDate(row.period, locale)}</td>
                    <td className="mono-cell num"><b>{row.value}</b></td>
                    <td className="mono-cell num" style={{ color: "var(--faint)" }}>{row.previous ?? "—"}</td>
                    <td className={`mono-cell num ${change === null ? "" : change >= 0 ? "up" : "down"}`}>{change === null ? "—" : fmtChange(change)}</td>
                    <td className="mono-cell num">{dec(row.consensus)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      )}

      <details className="article-original">
        <summary>{tr(locale, "History and vintages", "历史与版本")}</summary>
        <div className="tbl-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Period", "数据期")}</th><th>{tr(locale, "Value", "数值")}</th><th>{tr(locale, "Provider", "提供方")}</th>
            <th>{tr(locale, "Vintage", "版本时间")}</th><th>{tr(locale, "Revision", "修订")}</th><th>{tr(locale, "Source", "来源")}</th>
          </tr></thead>
          <tbody>
            {indicator.seriesSources.flatMap((source) => source.observations.map((row) => ({ ...row, source })))
              .sort((a, b) => b.period.getTime() - a.period.getTime() || b.vintageAt.getTime() - a.vintageAt.getTime())
              .map((row) => (
                <tr key={row.id}>
                  <td className="mono-cell">{formatDate(row.period, locale)}</td>
                  <td className="mono-cell">{row.value.toString()}</td>
                  <td>{row.source.provider}</td>
                  <td className="mono-cell">{macroDateTime(row.vintageAt, locale)}</td>
                  <td className="mono-cell">#{row.revisionNo}{row.isInitial ? ` · ${tr(locale, "initial", "初值")}` : ""}</td>
                  <td>{row.source.sourceUrl ? <a href={row.source.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Official source ↗", "官方来源 ↗")}</a> : "N/A"}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
      </details>
    </main>
  );
}
