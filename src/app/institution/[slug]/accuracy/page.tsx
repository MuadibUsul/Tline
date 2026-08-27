import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionAccuracy } from "@/lib/forecast";

export const dynamic = "force-dynamic";

function value(value: number | null) {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default async function AccuracyPage({ params }: { params: { slug: string } }) {
  const data = await getInstitutionAccuracy(params.slug);
  if (!data) notFound();
  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">Forecast Accuracy</div>
        <h1>{data.institution.name}</h1>
        <div className="deltas">
          <span>Settled <b className="mono">{data.forecasts.length}</b></span>
          <span>Direction <b className="mono">{data.directionAccuracy === null ? "—" : `${(data.directionAccuracy * 100).toFixed(1)}%`}</b></span>
          <span>Mean target error <b className="mono">{data.meanPercentageError === null ? "—" : `${data.meanPercentageError.toFixed(2)}%`}</b></span>
        </div>
        <Link className="minibtn" href={`/institution/${params.slug}`}>← Institution</Link>
      </div>

      <section className="blk">
        <div className="section-t">Settled forecasts</div>
        {data.forecasts.length ? <div className="tbl-wrap"><table>
          <thead><tr><th>Asset</th><th>Forecast</th><th>Actual</th><th>Direction</th><th>Error</th><th>Target date</th></tr></thead>
          <tbody>{data.forecasts.map((forecast) => <tr key={forecast.id}>
            <td className="inst">{forecast.asset.name}</td>
            <td className="mono-cell">{value(forecast.targetValue)}</td>
            <td className="mono-cell">{value(forecast.actualValue)}</td>
            <td>{forecast.directionCorrect === null ? "—" : <span className={`chip ${forecast.directionCorrect ? "bull" : "bear"}`}>{forecast.directionCorrect ? "Correct" : "Miss"}</span>}</td>
            <td className="mono-cell">{forecast.percentageError === null ? "—" : `${forecast.percentageError.toFixed(2)}%`}</td>
            <td className="mono-cell">{forecast.targetDate?.toISOString().slice(0, 10) ?? "—"}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">No forecasts have enough licensed price observations to settle yet.</div>}
      </section>
      <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        Method: first same-source observation on/after target date, with a matching observation on/before forecast date; maximum gap is configurable and defaults to 7 days.
      </p>
    </main>
  );
}
