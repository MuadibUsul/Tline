import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { actualText, macroDateTime, macroNumber } from "@/lib/macro/presentation";

export const dynamic = "force-dynamic";

export default async function MacroPage() {
  const locale = await getLocale();
  const now = new Date();
  const [upcoming, latest, indicators, revisions] = await Promise.all([
    prisma.macroRelease.findMany({ where: { scheduledAt: { gte: now }, importance: { gte: 4 }, status: { in: ["SCHEDULED", "WAITING", "DELAYED"] } }, orderBy: { scheduledAt: "asc" }, take: 8 }),
    prisma.macroRelease.findMany({ where: { status: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 8, include: { values: { include: { indicator: true } } } }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, orderBy: [{ category: "asc" }, { importance: "desc" }], include: { seriesSources: { where: { enabled: true }, orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 1 } } } } }),
    prisma.macroObservation.findMany({ where: { revisionNo: { gt: 0 } }, orderBy: { vintageAt: "desc" }, take: 8, include: { seriesSource: { include: { indicator: true } } } }),
  ]);
  const categories = ["INFLATION", "GROWTH", "LABOR", "POLICY"];
  return <main className="wrap">
    <div className="page-head"><div className="eyebrow">Macro Intelligence</div><h1>{tr(locale, "Economic Data", "经济数据")}</h1><p className="sub">{tr(locale, "Official releases, point-in-time vintages and source-backed central-bank policy.", "官方发布、时点版本与有原文依据的央行政策数据。")}</p><div className="tag-row"><Link className="minibtn p" href="/macro/calendar">{tr(locale, "Economic calendar", "经济日历")}</Link></div></div>
    <div className="grid-main">
      <section className="blk"><div className="section-t">{tr(locale, "Upcoming high-impact events", "即将公布的重要事件")}</div><div className="rowlist">{upcoming.length ? upcoming.map((release) => <Link key={release.id} href={`/macro/release/${release.id}`}><span><b>{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}</b><small className="mono" style={{ display: "block", color: "var(--muted)" }}>{release.countryCode} · {"●".repeat(release.importance)}</small></span><span className="mono">{macroDateTime(release.scheduledAt, locale, release.sourceTimezone)}</span></Link>) : <div className="r">{tr(locale, "No scheduled events", "暂无计划事件")}</div>}</div></section>
      <section className="blk"><div className="section-t">{tr(locale, "Recent revisions", "近期修订")}</div><div className="rowlist">{revisions.length ? revisions.map((row) => <Link key={row.id} href={`/macro/indicator/${row.seriesSource.indicator.canonicalKey}`}><span>{locale === "zh-CN" ? row.seriesSource.indicator.nameZh ?? row.seriesSource.indicator.nameEn : row.seriesSource.indicator.nameEn}</span><span className="mono">#{row.revisionNo} · {row.value.toString()}</span></Link>) : <div className="r">{tr(locale, "No revisions recorded", "暂无修订记录")}</div>}</div></section>
    </div>
    <section className="blk"><div className="section-t">{tr(locale, "Latest releases", "最新发布")}</div><div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Release", "发布")}</th><th>{tr(locale, "Indicator", "指标")}</th><th>{tr(locale, "Actual", "实际值")}</th><th>{tr(locale, "Released", "发布时间")}</th></tr></thead><tbody>{latest.flatMap((release) => release.values.length ? release.values.map((value) => <tr key={value.id}><td className="inst"><Link href={`/macro/release/${release.id}`}>{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}</Link></td><td><Link href={`/macro/indicator/${value.indicator.canonicalKey}`}>{locale === "zh-CN" ? value.indicator.nameZh ?? value.indicator.nameEn : value.indicator.nameEn}</Link></td><td className="mono-cell">{actualText(value.actualInitial, true, locale)}</td><td className="mono-cell">{release.releasedAt ? macroDateTime(release.releasedAt, locale, release.sourceTimezone) : macroNumber(null, locale)}</td></tr>) : [])}</tbody></table></div></section>
    <div className="markets-grid">{categories.map((category) => <section className="blk" key={category}><div className="section-t">{category}</div><div className="rowlist">{indicators.filter((item) => item.category === category).map((indicator) => { const observation = indicator.seriesSources.find((source) => source.observations.length)?.observations[0]; return <Link key={indicator.id} href={`/macro/indicator/${indicator.canonicalKey}`}><span>{locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn}<small className="mono" style={{ display: "block", color: "var(--faint)" }}>{indicator.unit} · {indicator.seasonalAdjustment ?? "N/A"}</small></span><span className="n">{macroNumber(observation?.value, locale)}</span></Link>; })}</div></section>)}</div>
  </main>;
}
