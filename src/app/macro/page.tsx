import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr, type Locale } from "@/lib/i18n";
import { beijingDateTime, unitLabel } from "@/lib/macro/presentation";
import ReleaseSpotlight, { type SpotlightRelease } from "./ReleaseSpotlight";
import { getReleaseConsensusMap } from "@/lib/macro/releaseConsensus";

export const dynamic = "force-dynamic";

const toNum = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? null : Number(value.toString()));

const CATEGORY_ORDER = ["POLICY", "INFLATION", "GROWTH", "LABOR", "LIQUIDITY"];
const CATEGORY_ZH: Record<string, string> = { POLICY: "货币政策", INFLATION: "通胀", GROWTH: "增长", LABOR: "就业", LIQUIDITY: "流动性" };
const dec = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? "—" : value.toString());

export default async function MacroPage() {
  const locale = await getLocale();
  const nm = (en: string, zh?: string | null) => (locale === "zh-CN" ? zh ?? en : en);
  const now = new Date();

  const [calendar, indicators] = await Promise.all([
    prisma.macroRelease.findMany({
      where: { scheduledAt: { gte: new Date(now.getTime() - 3 * 864e5), lte: new Date(now.getTime() + 14 * 864e5) }, importance: { gte: 3 } },
      orderBy: { scheduledAt: "asc" },
      take: 30,
      include: { values: { take: 1, include: { indicator: true } } },
    }),
    prisma.macroIndicator.findMany({
      where: { enabled: true },
      orderBy: [{ importance: "desc" }, { nameEn: "asc" }],
      include: { seriesSources: { where: { enabled: true }, orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 2 } } } },
    }),
  ]);

  const rows = indicators.map((indicator) => {
    const source = indicator.seriesSources.find((series) => series.observations.length);
    return { indicator, last: source?.observations[0] ?? null, previous: source?.observations[1] ?? null };
  });
  const categories = [...new Set([...CATEGORY_ORDER, ...rows.map((row) => row.indicator.category)])].filter((category) => rows.some((row) => row.indicator.category === category));

  const consensusMap = await getReleaseConsensusMap(calendar);
  const spotlight: SpotlightRelease[] = calendar.map((release) => {
    const value = release.values[0];
    const consensus = consensusMap.get(release.id);
    return {
      id: release.id,
      titleEn: release.titleEn,
      titleZh: release.titleZh,
      countryCode: release.countryCode,
      importance: release.importance,
      scheduledAt: release.scheduledAt.toISOString(),
      releasedAt: release.releasedAt?.toISOString() ?? null,
      status: release.status,
      actual: toNum(value?.actualInitial),
      previous: toNum(value?.revisedPreviousAtRelease ?? value?.previousAtRelease),
      // Our own institutional consensus (mined from research) takes precedence; fall back to any captured value.
      consensus: consensus?.median ?? toNum(value?.consensusAtRelease),
      consensusCount: consensus?.count ?? 0,
      unit: value?.indicator ? unitLabel(value.indicator.unit, locale) : consensus?.unit ?? "",
      analysis: (locale === "zh-CN" ? release.analysisZh : release.analysisEn) ?? null,
    };
  });

  return (
    <main className="wrap">
      <ReleaseSpotlight releases={spotlight} locale={locale} />
      <div className="page-head">
        <div className="eyebrow">Macro Intelligence</div>
        <h1>{tr(locale, "Economic Data", "经济数据")}</h1>
        <p className="sub">{tr(locale, "Official releases, point-in-time vintages and source-backed central-bank policy — release times in Beijing time.", "官方发布、时点版本与有原文依据的央行政策数据——发布时间以北京时间为准。")}</p>
        <div className="tag-row"><Link className="minibtn p" href="/macro/calendar">{tr(locale, "Full economic calendar", "完整经济日历")}</Link></div>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Economic calendar · Beijing time", "经济日历 · 北京时间")}</div>
        <div className="tbl-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Time", "时间")}</th>
            <th>{tr(locale, "Country", "国家")}</th>
            <th>{tr(locale, "Event", "事件")}</th>
            <th className="ctr">{tr(locale, "Impact", "重要性")}</th>
            <th className="num-h">{tr(locale, "Actual", "实际")}</th>
            <th className="num-h">{tr(locale, "Previous", "前值")}</th>
            <th className="num-h">{tr(locale, "Consensus", "预期")}</th>
          </tr></thead>
          <tbody>
            {calendar.map((release) => {
              const value = release.values[0];
              const released = release.status === "RELEASED";
              return (
                <tr key={release.id} className={released ? "" : "macro-upcoming"}>
                  <td className="mono-cell">{beijingDateTime(release.scheduledAt, locale)}</td>
                  <td className="mono-cell">{release.countryCode}</td>
                  <td className="inst"><Link href={`/macro/release/${release.id}`}>{nm(release.titleEn, release.titleZh)}</Link></td>
                  <td className="ctr" title={`${release.importance}/5`}>{"●".repeat(release.importance)}</td>
                  <td className="mono-cell num"><b>{released ? dec(value?.actualInitial) : tr(locale, "—", "—")}</b></td>
                  <td className="mono-cell num">{dec(value?.revisedPreviousAtRelease ?? value?.previousAtRelease)}</td>
                  <td className="mono-cell num">{dec(value?.consensusAtRelease)}</td>
                </tr>
              );
            })}
            {calendar.length === 0 && <tr><td colSpan={7} className="mono-cell" style={{ color: "var(--muted)" }}>{tr(locale, "No scheduled releases in this window.", "该时间窗内暂无计划发布。")}</td></tr>}
          </tbody>
        </table></div>
      </section>

      <div className="markets-grid">
        {categories.map((category) => (
          <section className="blk" key={category}>
            <div className="section-t">{CATEGORY_ZH[category] && locale === "zh-CN" ? CATEGORY_ZH[category] : category}</div>
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>{tr(locale, "Indicator", "指标")}</th>
                <th className="num-h">{tr(locale, "Last", "最新")}</th>
                <th className="num-h">{tr(locale, "Prev.", "前值")}</th>
                <th>{tr(locale, "Reference", "参考期")}</th>
              </tr></thead>
              <tbody>
                {rows.filter((row) => row.indicator.category === category).map(({ indicator, last, previous }) => (
                  <tr key={indicator.id}>
                    <td className="inst"><Link href={`/macro/indicator/${indicator.canonicalKey}`}>{nm(indicator.nameEn, indicator.nameZh)}</Link><small className="mono" style={{ display: "block", color: "var(--faint)" }}>{unitLabel(indicator.unit, locale)}</small></td>
                    <td className="mono-cell num"><b>{dec(last?.value)}</b></td>
                    <td className="mono-cell num" style={{ color: "var(--faint)" }}>{dec(previous?.value)}</td>
                    <td className="mono-cell">{last ? formatDate(last.period, locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        ))}
      </div>
    </main>
  );
}
