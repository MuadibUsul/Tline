import Link from "next/link";
import { answerQuery, EXAMPLE_QUERIES } from "@/lib/research";
import SearchBox from "@/app/_components/SearchBox";
import { relTime } from "@/app/_components/ui";
import { getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const locale = getLocale();
  const q = (searchParams.q ?? "").trim();
  const answer = q ? await answerQuery(q) : null;

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Ask Institutional Research", "查询机构研报")}</div>
        <h1>{tr(locale, "AI Research", "AI 研报检索")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {tr(locale, "Ask the structured institutional-view database in natural language. Answers come from stored evidence, not a web search.", "使用自然语言查询站内结构化机构观点库；答案来自已入库证据，而非网页搜索。")}
        </p>
        <div style={{ marginTop: 4 }}><SearchBox initial={q} autoFocus={!q} placeholder={tr(locale, "Search Goldman, Gold, Nvidia, Fed…", "搜索高盛、黄金、英伟达、美联储……")} ariaLabel={tr(locale, "Ask institutional research", "查询机构研报")} /></div>
      </div>

      {!answer && (
        <section style={{ paddingTop: 24 }}>
          <div className="section-t">{tr(locale, "Try", "试试这些问题")}</div>
          <div className="feed">
            {(locale === "zh-CN" ? ["机构对黄金的最新观点是什么？", "哪些机构看多英伟达？", "美联储相关研报有哪些？"] : EXAMPLE_QUERIES).map((ex) => (
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
              <div className="lbl">◆ {answer.usedLLM ? tr(locale, "AI Answer · based on stored evidence", "AI 回答 · 基于站内结构化证据") : tr(locale, "Structured Answer · stored data", "结构化回答 · 站内数据")} — {answer.intent}</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: "var(--ink)" }}>{answer.title}</div>
              <p style={{ margin: 0, color: "var(--ink-2)" }}>{answer.summary}</p>
              {answer.assetTicker && (
                <div style={{ marginTop: 10 }}>
                  <Link href={`/asset/${answer.assetTicker}`} className="minibtn">{tr(locale, `View ${answer.assetTicker} consensus`, `查看 ${answer.assetTicker} 共识`)} →</Link>
                </div>
              )}
            </div>
          </section>

          <section style={{ paddingTop: 20 }}>
            <div className="section-t">{tr(locale, `Evidence · ${answer.rows.length} sources`, `证据 · ${answer.rows.length} 个来源`)}</div>
            <div className="feed">
              {answer.rows.map((r, i) => (
                <div key={i} className="fcard">
                  <div className="top">
                    <span className="mono" style={{ color: "var(--faint)" }}>[{i + 1}]</span>
                    <Link href={`/institution/${r.slug}`}><b>{r.institution}</b></Link>
                    <span>· {relTime(r.when, locale)}</span>
                    {r.tone && <span className={`chip ${r.tone}`} style={{ marginLeft: "auto" }}>{r.tone === "bull" ? "▲" : r.tone === "bear" ? "▼" : "◆"}</span>}
                  </div>
                  <div style={{ margin: "8px 0", fontSize: 14.5, color: "var(--ink)", fontWeight: 500 }}>{r.text}</div>
                  {r.detail && <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{r.detail}</div>}
                  <div className="act">
                    {r.researchId && <Link href={`/research/${r.researchId}`} className="minibtn p">{tr(locale, "Analysis", "分析")}</Link>}
                    {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Official source ↗", "官网原文 ↗")}</a>}
                  </div>
                </div>
              ))}
              {answer.rows.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No structured evidence found — try a different query.", "未找到结构化证据，请尝试其他问题。")}</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
