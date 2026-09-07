import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionAccuracy } from "@/lib/forecast";
import { assetName, formatDate, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { canonical, noIndex } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const institution = await prisma.institution.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!institution) return { title: tr(locale, "Institution not found", "机构未找到"), ...noIndex };
  const name = institutionName(institution.name, locale);
  // A record with nothing settled is the same sentence on every institution's page. Until
  // this one has a forecast to show, it is a duplicate of fifty others and asks to be left
  // out of the index rather than crawled, compared and dropped.
  const settled = await prisma.forecast.count({ where: { institutionId: institution.id, status: "settled" } });
  return {
    title: tr(locale, `${name} forecast record`, `${name} 预测准确率`),
    ...(settled === 0 ? { robots: { index: false, follow: true } } : {}),
    description: tr(
      locale,
      `How ${name}'s published forecasts have settled against what actually happened: direction, target and error, forecast by forecast.`,
      `${name}已发布的预测与实际结果的对照:方向、目标价与误差,逐条可查。`,
    ),
    ...canonical(`/institution/${slug}/accuracy`, locale),
  };
}

function value(value: number | null) {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default async function AccuracyPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getInstitutionAccuracy(params.slug);
  if (!data) notFound();
  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Forecast Accuracy", "预测准确率")}</div>
        <h1>{institutionName(data.institution.name, locale)}</h1>
        <div className="deltas">
          <span>{tr(locale, "Settled", "已结算")} <b className="mono">{data.forecasts.length}</b></span>
          <span>{tr(locale, "Awaiting prices", "等待价格")} <b className="mono">{data.pending}</b></span>
          <span>{tr(locale, "Direction", "方向") } <b className="mono">{data.directionAccuracy === null ? "—" : `${(data.directionAccuracy * 100).toFixed(1)}%`}</b></span>
          <span>{tr(locale, "Mean target error", "平均目标误差")} <b className="mono">{data.meanPercentageError === null ? "—" : `${data.meanPercentageError.toFixed(2)}%`}</b></span>
        </div>
        <Link className="minibtn" href={localePath(locale, `/institution/${params.slug}`)}>← {tr(locale, "Institution", "机构")}</Link>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Settled forecasts", "已结算预测")}</div>
        {data.forecasts.length ? <div className="tbl-wrap"><table>
          <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Forecast", "预测值")}</th><th>{tr(locale, "Actual", "实际值")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Error", "误差")}</th><th>{tr(locale, "Target date", "目标日期")}</th></tr></thead>
          <tbody>{data.forecasts.map((forecast) => <tr key={forecast.id}>
            <td className="inst">{assetName(forecast.asset.name, locale, forecast.asset.ticker)}</td>
            <td className="mono-cell">{value(forecast.targetValue)}</td>
            <td className="mono-cell">{value(forecast.actualValue)}</td>
            <td>{forecast.directionCorrect === null ? "—" : <span className={`chip ${forecast.directionCorrect ? "bull" : "bear"}`}>{forecast.directionCorrect ? tr(locale, "Correct", "正确") : tr(locale, "Miss", "未命中")}</span>}</td>
            <td className="mono-cell">{forecast.percentageError === null ? "—" : `${forecast.percentageError.toFixed(2)}%`}</td>
            <td className="mono-cell">{forecast.targetDate ? formatDate(forecast.targetDate, locale) : "—"}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{tr(locale, "No forecasts have enough licensed price observations to settle yet.", "暂无具备足够授权价格观测值、可供结算的预测。")}</div>}
      </section>
      {data.outOfScope > 0 && <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        {tr(
          locale,
          `${data.outOfScope} rate and macro calls are excluded from this score. "Bullish on 10Y Treasuries" means yields fall, and a policy or inflation stance has no price to settle against, so scoring them against the available series would invert the verdict rather than measure it.`,
          `另有 ${data.outOfScope} 条利率与宏观类判断不纳入本评分。"看多十年期美债"指的是收益率下行，而政策或通胀立场本身没有可结算的价格；用现有序列去打分会得出方向相反的结论，而不是真实的准确率。`,
        )}
      </p>}

      <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        {tr(locale, "Method: first same-source observation on/after target date, with a matching observation on/before forecast date; maximum gap is configurable and defaults to 7 days.", "方法：取目标日期当天或之后同一来源的首个观测值，并匹配预测日期当天或之前的观测值；最大间隔可配置，默认 7 天。")}
      </p>
    </main>
  );
}
