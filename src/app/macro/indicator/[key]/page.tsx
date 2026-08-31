import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr, type Locale } from "@/lib/i18n";
import { beijingDateTime, macroDateTime, macroNumber } from "@/lib/macro/presentation";

export const dynamic = "force-dynamic";

const num = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? null : Number(value.toString()));
const dec = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? "—" : value.toString());

// Inline SVG area chart — no external libraries, theme-aware, CSP-safe.
function SeriesChart({ points, up }: { points: { v: number }[]; up: boolean }) {
  if (points.length < 2) return null;
  const W = 640, H = 200, P = 10;
  const values = points.map((point) => point.v);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const line = points.map((point, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(point.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - P).toFixed(1)} L${x(0).toFixed(1)},${(H - P).toFixed(1)} Z`;
  const stroke = up ? "var(--bull)" : "var(--bear)";
  return (
    <svg className="macro-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="series chart">
      <path d={area} fill={stroke} fillOpacity="0.1" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

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
  const chartPoints = series.slice(-60).map((point) => ({ v: point.value }));
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

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{indicator.countryCode} · {indicator.category}</div>
        <h1>{nm(indicator.nameEn, indicator.nameZh)}</h1>
        <div className="big-score">
          <span className="num">{macroNumber(latest?.value, locale)}</span>
          <span className="mono">{indicator.unit}</span>
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

      {chartPoints.length >= 2 && (
        <section className="blk">
          <div className="section-t">{tr(locale, `History · last ${chartPoints.length} periods`, `历史走势 · 最近 ${chartPoints.length} 期`)}</div>
          <SeriesChart points={chartPoints} up={up} />
          <div className="macro-stats">
            <Stat label={tr(locale, "Latest", "最新")} value={latest ? `${latest.value}` : "—"} />
            <Stat label={tr(locale, "Previous", "前值")} value={previous ? `${previous.value}` : "—"} />
            <Stat label={tr(locale, "12-period high", "近12期高")} value={high !== null ? `${high}` : "—"} />
            <Stat label={tr(locale, "12-period low", "近12期低")} value={low !== null ? `${low}` : "—"} />
            <Stat label={tr(locale, "Unit", "单位")} value={indicator.unit} />
            <Stat label={tr(locale, "Frequency", "频率")} value={indicator.frequency} />
          </div>
        </section>
      )}

      {calendar.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Release calendar", "发布日历")}</div>
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>{tr(locale, "Reference", "数据期")}</th>
              <th>{tr(locale, "Actual", "实际值")}</th>
              <th>{tr(locale, "Previous", "前值")}</th>
              <th>{tr(locale, "Consensus", "预期")}</th>
              <th>{tr(locale, "Surprise", "超预期")}</th>
              <th>{tr(locale, "Released (Beijing)", "发布(北京时间)")}</th>
            </tr></thead>
            <tbody>
              {nextRelease && (
                <tr className="macro-next">
                  <td className="mono-cell">{tr(locale, "Next", "下次")}</td>
                  <td className="mono-cell">{tr(locale, "Not released", "尚未发布")}</td>
                  <td className="mono-cell">—</td><td className="mono-cell">—</td><td className="mono-cell">—</td>
                  <td className="mono-cell">{beijingDateTime(nextRelease.scheduledAt, locale)}</td>
                </tr>
              )}
              {calendar.map((value) => {
                const surprise = num(value.surpriseRaw);
                return (
                  <tr key={value.id}>
                    <td className="mono-cell"><Link href={`/macro/release/${value.release.id}`}>{formatDate(value.observationPeriod, locale)}</Link></td>
                    <td className="mono-cell"><b>{dec(value.actualInitial)}</b></td>
                    <td className="mono-cell">{dec(value.revisedPreviousAtRelease ?? value.previousAtRelease)}</td>
                    <td className="mono-cell">{dec(value.consensusAtRelease)}</td>
                    <td className={`mono-cell ${surprise === null ? "" : surprise >= 0 ? "up" : "down"}`}>{surprise === null ? "—" : `${surprise >= 0 ? "+" : ""}${surprise}`}</td>
                    <td className="mono-cell">{value.release.releasedAt ? beijingDateTime(value.release.releasedAt, locale) : macroDateTime(value.release.scheduledAt, locale)}</td>
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
