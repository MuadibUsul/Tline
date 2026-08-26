import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionView } from "@/lib/queries";
import { FeedCard, DirChip, relTime } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function InstitutionPage({ params }: { params: { slug: string } }) {
  const data = await getInstitutionView(params.slug);
  if (!data) notFound();
  const { inst, articles, count30, views, coverage } = data;

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">Institution</div>
        <h1>{inst.name}</h1>
        <div className="deltas">
          <span className="stars">{"★".repeat(inst.rating)}{"☆".repeat(5 - inst.rating)}</span>
          <span>Authority weight <b className="mono">{inst.authorityScore.toFixed(2)}</b></span>
          <span>Public views · 30d <b className="mono">{count30}</b></span>
          {coverage.length > 0 && <span style={{ color: "var(--faint)" }}>{coverage.join(" · ")}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={inst.researchUrl} target="_blank" rel="noopener noreferrer" className="minibtn">Research homepage ↗</a>
          <form action={addWatch}>
            <input type="hidden" name="kind" value="institution" />
            <input type="hidden" name="refId" value={inst.slug} />
            <input type="hidden" name="back" value={`/institution/${inst.slug}`} />
            <button type="submit" className="minibtn">＋ Watch</button>
          </form>
        </div>
      </div>

      {views.length > 0 && (
        <section className="blk">
          <div className="section-t">Current Views</div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Asset</th><th>Direction</th><th>Target</th><th>Updated</th></tr></thead>
              <tbody>
                {views.map((v) => (
                  <tr key={v.ticker}>
                    <td className="inst"><Link href={`/asset/${v.ticker}`}>{v.name}</Link></td>
                    <td><DirChip direction={v.direction} /></td>
                    <td className="mono-cell">{v.target ? `$${v.target.toLocaleString()}` : "—"}</td>
                    <td className="mono-cell">{relTime(v.when)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ paddingTop: 26 }}>
        <div className="section-t">Recent Research</div>
        <div className="feed">
          {articles.slice(0, 10).map((a) => (
            <FeedCard key={a.id} a={{ ...a, institution: { name: inst.name, slug: inst.slug } }} />
          ))}
          {articles.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>No ingested research yet for this source.</p>}
        </div>
      </section>
    </main>
  );
}
