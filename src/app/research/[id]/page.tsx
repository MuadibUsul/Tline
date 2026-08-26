import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { DirChip } from "@/app/_components/ui";

export const dynamic = "force-dynamic";

function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export default async function ResearchPage({ params }: { params: { id: string } }) {
  const a = await getResearchView(params.id);
  if (!a) notFound();
  const an = a.analysis;
  const keyNumbers = parseJson<{ label: string; value: string }[]>(an?.keyNumbers, []);
  const keyArgs = parseJson<string[]>(an?.keyArguments, []);
  const risks = parseJson<string[]>(an?.risks, []);
  const date = new Date(a.publishedAt).toISOString().slice(0, 10);
  const translation = a.translations[0];

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          <Link href={`/institution/${a.institution.slug}`}>{a.institution.name}</Link>
          {a.author ? ` · ${a.author}` : ""} · {date}
          {an?.reviewStatus === "needs_review" && <span className="chip neu" style={{ marginLeft: 8 }}>needs review</span>}
        </div>
        <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{a.title}</h1>
      </div>

      <section className="blk">
        <div className="ai-box">
          <div className="lbl">◆ AI Summary — 模型生成，非原文转载</div>
          <p style={{ margin: 0, color: "var(--ink-2)" }}>{an?.summary}</p>
        </div>
      </section>

      {a.articleAssets.length > 0 && (
        <section className="blk">
          <div className="section-t">Core Views</div>
          <div className="tag-row">
            {a.articleAssets.map((aa) => (
              <Link key={aa.asset.ticker} href={`/asset/${aa.asset.ticker}`} className={`chip ${aa.direction > 0 ? "bull" : aa.direction < 0 ? "bear" : "neu"}`}>
                {aa.asset.name} {aa.direction > 0 ? "▲" : aa.direction < 0 ? "▼" : "◆"}
              </Link>
            ))}
          </div>
        </section>
      )}

      {keyNumbers.length > 0 && (
        <section className="blk">
          <div className="section-t">Key Numbers</div>
          <div className="dist">
            {keyNumbers.map((k, i) => (
              <div key={i} className="stat"><span>{k.label}</span><b>{k.value}</b></div>
            ))}
          </div>
        </section>
      )}

      {(keyArgs.length > 0 || risks.length > 0) && (
        <section className="blk">
          {keyArgs.length > 0 && (<><div className="section-t">Key Arguments</div><ul className="prose">{keyArgs.map((k, i) => <li key={i}>{k}</li>)}</ul></>)}
          {risks.length > 0 && (<><div className="section-t" style={{ marginTop: 16 }}>Risks</div><ul className="prose">{risks.map((k, i) => <li key={i}>{k}</li>)}</ul></>)}
        </section>
      )}

      {an?.interpretation && (
        <section className="blk">
          <div className="section-t">AI Trading Interpretation</div>
          <p className="prose">{an.interpretation}</p>
        </section>
      )}

      {(translation || a.documents.length > 0) && (
        <section className="blk">
          <div className="section-t">Bilingual Research · 双语研报</div>
          {translation && (
            <div style={{ marginBottom: 14 }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                中文译文 · {translation.status} · {translation.provider}/{translation.model}
              </div>
              <h2 style={{ fontSize: 20, marginBottom: 8 }}>{translation.title}</h2>
              <p className="prose" style={{ whiteSpace: "pre-wrap" }}>{translation.text}</p>
            </div>
          )}
          <div className="act">
            {a.documents.map((document) => (
              <a key={document.id} href={`/api/documents/${document.id}`} className={`minibtn ${document.kind === "translation_pdf" ? "p" : ""}`}>
                {document.kind === "translation_pdf" ? "下载中文 PDF" : document.kind === "source_native" ? "下载机构原始 PDF" : "Download English PDF"}
              </a>
            ))}
          </div>
        </section>
      )}

      <section style={{ paddingTop: 24 }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          Source: {a.institution.name} · confidence {an?.confidence.toFixed(2)} · model {an?.model}
        </div>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p">Read Original ↗</a>
      </section>
    </main>
  );
}
