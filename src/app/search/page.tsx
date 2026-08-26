import Link from "next/link";
import { answerQuery, EXAMPLE_QUERIES } from "@/lib/research";
import SearchBox from "@/app/_components/SearchBox";
import { relTime } from "@/app/_components/ui";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  const answer = q ? await answerQuery(q) : null;

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="eyebrow">Ask Institutional Research</div>
        <h1>AI Research</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          自然语言查询站内结构化机构观点库 · answers come from the structured DB, not a web search.
        </p>
        <div style={{ marginTop: 4 }}><SearchBox initial={q} autoFocus={!q} /></div>
      </div>

      {!answer && (
        <section style={{ paddingTop: 24 }}>
          <div className="section-t">Try</div>
          <div className="feed">
            {EXAMPLE_QUERIES.map((ex) => (
              <Link key={ex} href={`/search?q=${encodeURIComponent(ex)}`} className="fcard" style={{ textDecoration: "none" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13.5, color: "var(--ink-2)" }}>⌕ {ex}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {answer && (
        <>
          <section className="blk">
            <div className="ai-box">
              <div className="lbl">◆ {answer.usedLLM ? "AI Answer · 基于站内结构化证据" : "Structured Answer · 站内数据"} — {answer.intent}</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: "var(--ink)" }}>{answer.title}</div>
              <p style={{ margin: 0, color: "var(--ink-2)" }}>{answer.summary}</p>
              {answer.assetTicker && (
                <div style={{ marginTop: 10 }}>
                  <Link href={`/asset/${answer.assetTicker}`} className="minibtn">View {answer.assetTicker} consensus →</Link>
                </div>
              )}
            </div>
          </section>

          <section style={{ paddingTop: 20 }}>
            <div className="section-t">Evidence · {answer.rows.length} sources</div>
            <div className="feed">
              {answer.rows.map((r, i) => (
                <div key={i} className="fcard">
                  <div className="top">
                    <span className="mono" style={{ color: "var(--faint)" }}>[{i + 1}]</span>
                    <Link href={`/institution/${r.slug}`}><b>{r.institution}</b></Link>
                    <span>· {relTime(r.when)}</span>
                    {r.tone && <span className={`chip ${r.tone}`} style={{ marginLeft: "auto" }}>{r.tone === "bull" ? "▲" : r.tone === "bear" ? "▼" : "◆"}</span>}
                  </div>
                  <div style={{ margin: "8px 0", fontSize: 14.5, color: "var(--ink)", fontWeight: 500 }}>{r.text}</div>
                  {r.detail && <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{r.detail}</div>}
                  <div className="act">
                    {r.researchId && <Link href={`/research/${r.researchId}`} className="minibtn p">Analysis</Link>}
                    {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">官网原文 ↗</a>}
                  </div>
                </div>
              ))}
              {answer.rows.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>No structured evidence found — try a different query.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
