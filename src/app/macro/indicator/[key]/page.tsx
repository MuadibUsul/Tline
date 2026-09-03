import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr } from "@/lib/i18n";
import { beijingDateTime, macroDateTime, macroNumber, unitLabel } from "@/lib/macro/presentation";
import IndicatorChart from "./IndicatorChart";
import { canonical } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await props.params;
  const locale = await getLocale();
  const indicator = await prisma.macroIndicator.findUnique({
    where: { canonicalKey: key },
    select: { nameEn: true, nameZh: true },
  });
  if (!indicator) return { title: tr(locale, "Indicator not found", "指标未找到") };
  const name = locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn;
  return {
    title: name,
    description: tr(
      locale,
      `${name}: the released series, each revision, and what institutions forecast before it landed.`,
      `${name}:历史发布序列、每次修订,以及发布前各机构的预测。`,
    ),
    ...canonical(`/macro/indicator/${key}`),
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
      <div className="page-head">
        <div className="eyebrow">{indicator.countryCode} · {indicator.category}</div>
        <h1>{nm(indicator.nameEn, indicator.nameZh)}</h1>
        <div className="big-score">
          <span className="num">{macroNumber(latest?.value, locale)}</span>
          <span className="mono">{unitLabel(indicator.unit, locale)}</span>
          {change !== null && <span className={`macro-change ${up ? "up" : "down"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}</span>}
        </div>
        <div className="deltas">
          <span>{tr(locale, "Frequency", "频率")}: {indicator.frequency}</span>
          <span>{tr(locale, "Seasonal adjustment", "季节调整")}: {indicator.seasonalAdjustment ?? "N/A"}</span>
          <span>{tr(locale, "Updated", "更新")}: {latest ? formatDate(latest.period, locale) : "N/A"}</span>
          {nextRelease && <span>{tr(locale, "Next release", "下次发布")}: {beijingDateTime(nextRelease.scheduledAt, locale)} ({tr(locale, "Beijing", "北京时间")})</span>}
        </div>
        <Link href="/macro" className="minibtn" style={{ alignSelf: "flex-start" }}>← {tr(locale, "Economic data", "经济数据")}</Link>
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
            <Stat label={tr(locale, "Frequency", "频率")} value={indicator.frequency} />
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
