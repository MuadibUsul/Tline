import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionAccuracy } from "@/lib/forecast";
import { assetName, formatDate, getLocale, institutionName, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

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
          <span>{tr(locale, "Direction", "方向") } <b className="mono">{data.directionAccuracy === null ? "—" : `${(data.directionAccuracy * 100).toFixed(1)}%`}</b></span>
          <span>{tr(locale, "Mean target error", "平均目标误差")} <b className="mono">{data.meanPercentageError === null ? "—" : `${data.meanPercentageError.toFixed(2)}%`}</b></span>
        </div>
        <Link className="minibtn" href={`/institution/${params.slug}`}>← {tr(locale, "Institution", "机构")}</Link>
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
      <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        {tr(locale, "Method: first same-source observation on/after target date, with a matching observation on/before forecast date; maximum gap is configurable and defaults to 7 days.", "方法：取目标日期当天或之后同一来源的首个观测值，并匹配预测日期当天或之前的观测值；最大间隔可配置，默认 7 天。")}
      </p>
    </main>
  );
}
