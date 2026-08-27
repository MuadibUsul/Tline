import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { DirChip } from "@/app/_components/ui";
import { formatDate, getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function ArticleBody({ segments, fallback }: {
  segments: { id: string; heading: string | null; text: string }[];
  fallback: string;
}) {
  const sections = segments.length ? segments : [{ id: "fallback", heading: null, text: fallback }];
  return (
    <div className="prose article-sections">
      {sections.map((segment) => (
        <section className="article-section" key={segment.id}>
          {segment.heading && <h3>{segment.heading}</h3>}
          <div className="article-body">{segment.text}</div>
        </section>
      ))}
    </div>
  );
}

export default async function ResearchPage({ params }: { params: { id: string } }) {
  const locale = getLocale();
  const a = await getResearchView(params.id);
  if (!a) notFound();
  const an = a.analysis;
  const keyNumbers = parseJson<{ label: string; value: string }[]>(an?.keyNumbers, []);
  const keyArgs = parseJson<string[]>(an?.keyArguments, []);
  const risks = parseJson<string[]>(an?.risks, []);
  const date = formatDate(a.publishedAt, locale);
  const translation = a.translations[0];
  const translationStatus = translation?.status === "reviewed" ? tr(locale, "reviewed", "已复核")
    : translation?.status === "needs_review" ? tr(locale, "needs review", "待复核")
      : tr(locale, "translated", "已翻译");

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          <Link href={`/institution/${a.institution.slug}`}>{a.institution.name}</Link>
          {a.author ? ` · ${a.author}` : ""} · {date}
          {an?.reviewStatus === "needs_review" && <span className="chip neu" style={{ marginLeft: 8 }}>{tr(locale, "needs review", "待复核")}</span>}
        </div>
        <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{locale === "zh-CN" ? translation?.title ?? a.title : a.title}</h1>
      </div>

      <section className="blk">
        <div className="ai-box">
          <div className="lbl">◆ {tr(locale, "AI Summary — model-generated, not source text", "AI 摘要 — 模型生成，非原文转载")}</div>
          <p style={{ margin: 0, color: "var(--ink-2)" }}>{an?.summary}</p>
        </div>
      </section>

      {a.articleAssets.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Core Views", "核心观点")}</div>
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
          <div className="section-t">{tr(locale, "Key Numbers", "关键数字")}</div>
          <div className="dist">
            {keyNumbers.map((k, i) => (
              <div key={i} className="stat"><span>{k.label}</span><b>{k.value}</b></div>
            ))}
          </div>
        </section>
      )}

      {(keyArgs.length > 0 || risks.length > 0) && (
        <section className="blk">
          {keyArgs.length > 0 && (<><div className="section-t">{tr(locale, "Key Arguments", "关键论点")}</div><ul className="prose">{keyArgs.map((k, i) => <li key={i}>{k}</li>)}</ul></>)}
          {risks.length > 0 && (<><div className="section-t" style={{ marginTop: 16 }}>{tr(locale, "Risks", "风险")}</div><ul className="prose">{risks.map((k, i) => <li key={i}>{k}</li>)}</ul></>)}
        </section>
      )}

      {an?.interpretation && (
        <section className="blk">
          <div className="section-t">{tr(locale, "AI Trading Interpretation", "AI 交易解读")}</div>
          <p className="prose">{an.interpretation}</p>
        </section>
      )}

      <section className="blk">
        <div className="section-t">{tr(locale, "Bilingual Research", "双语研报")}</div>
        {locale === "en" && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} />
          </div>
        )}
        {translation ? locale === "zh-CN" ? (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              中文译文 · {translationStatus} · 质量 {translation.qualityScore?.toFixed(2) ?? "—"} · {translation.provider}/{translation.model}
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{translation.title}</h2>
            <ArticleBody segments={translation.segments} fallback={translation.text} />
          </div>
        ) : (
          <details className="article-original">
            <summary>Chinese translation · {translationStatus}</summary>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{translation.title}</h2>
            <ArticleBody segments={translation.segments} fallback={translation.text} />
          </details>
        ) : (
          <div className="empty-state" style={{ marginBottom: 18 }}>{tr(locale, "The Chinese translation is awaiting translation and quality review.", "中文译文正在等待翻译与质量复核。")}</div>
        )}
        {locale === "zh-CN" && a.rawText && (
          <details className="article-original">
            <summary>完整英文原文</summary>
            <ArticleBody segments={a.segments} fallback={a.rawText} />
          </details>
        )}
        {a.documents.length > 0 ? (
          <div className="act">
            {a.documents.map((document) => (
              <a key={document.id} href={`/api/documents/${document.id}`} className={`minibtn ${document.kind === "translation_pdf" ? "p" : ""}`}>
                {document.kind === "translation_pdf" ? tr(locale, "Download Chinese PDF", "下载中文 PDF") : document.kind === "source_native" ? tr(locale, "Download institution PDF", "下载机构原始 PDF") : tr(locale, "Download English PDF", "下载英文 PDF")}
              </a>
            ))}
          </div>
        ) : <div className="mono" style={{ color: "var(--muted)", fontSize: 11, marginTop: 14 }}>{tr(locale, "PDF generation pending", "PDF 正在等待生成")}</div>}
      </section>

      <section style={{ paddingTop: 24 }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          {tr(locale, "Source", "来源")}: {a.institution.name} · {tr(locale, "confidence", "置信度")} {an?.confidence.toFixed(2)} · {tr(locale, "model", "模型")} {an?.model}
        </div>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p">{tr(locale, "Read Original ↗", "阅读官网原文 ↗")}</a>
      </section>
    </main>
  );
}
