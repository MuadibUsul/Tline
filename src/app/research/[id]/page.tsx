import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { DirChip } from "@/app/_components/ui";
import { assetName, domainTerm, formatDate, getLocale, institutionName, localizeChineseContent, localizedDataValue, tr, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function ArticleBody({ segments, fallback, locale, translated = false }: {
  segments: { id: string; heading: string | null; text: string }[];
  fallback: string;
  locale: Locale;
  translated?: boolean;
}) {
  const sections = segments.length ? segments : [{ id: "fallback", heading: null, text: fallback }];
  const display = (value: string) => translated && locale === "zh-CN" ? localizeChineseContent(value) : value;
  return (
    <div className="prose article-sections">
      {sections.map((segment) => (
        <section className="article-section" key={segment.id}>
          {segment.heading && <h3>{display(segment.heading)}</h3>}
          <div className="article-body">{display(segment.text)}</div>
        </section>
      ))}
    </div>
  );
}

function AtomicViewCard({ view, locale }: { view: {
  id: string; viewEn: string; viewZh: string; type: string; asset: string; assetTicker: string | null;
  topic: string; direction: string; timeHorizon: string; value: string | null; conditionEn: string | null;
  conditionZh: string | null; rationaleEn: string | null; rationaleZh: string | null; confidence: string;
  importance: number; sourceQuote: string;
}; locale: "en" | "zh-CN" }) {
  const copy = locale === "zh-CN" ? localizeChineseContent(view.viewZh) : view.viewEn;
  const condition = locale === "zh-CN" ? view.conditionZh ? localizeChineseContent(view.conditionZh) : null : view.conditionEn;
  const rationale = locale === "zh-CN" ? view.rationaleZh ? localizeChineseContent(view.rationaleZh) : null : view.rationaleEn;
  const tone = view.direction === "bullish" ? "bull" : view.direction === "bearish" ? "bear" : "neu";
  const displayValue = localizedDataValue(view.value, locale);
  return (
    <article className="atomic-view">
      <div className="atomic-meta">
        <span className={`chip ${tone}`}>{domainTerm(view.direction, locale)}</span>
        <span className="chip gray">{domainTerm(view.type, locale)}</span>
        {view.assetTicker ? <Link href={`/asset/${view.assetTicker}`} className="chip acc">{assetName(view.asset, locale, view.assetTicker, "相关资产")}</Link> : <span className="chip acc">{assetName(view.asset, locale, null, "相关资产")}</span>}
        <span>{domainTerm(view.timeHorizon, locale, "时间范围见观点")}</span><span>{"★".repeat(view.importance)}</span>
      </div>
      <h3>{copy}</h3>
      {displayValue && <div className="atomic-value">{displayValue}</div>}
      {condition && <p><b>{tr(locale, "Condition", "条件")}:</b> {condition}</p>}
      {rationale && <p><b>{tr(locale, "Rationale", "依据")}:</b> {rationale}</p>}
      <details><summary>{tr(locale, "View supporting quote", "查看英文原文依据")}</summary><blockquote>{view.sourceQuote}</blockquote></details>
    </article>
  );
}

export default async function ResearchPage({ params }: { params: { id: string } }) {
  const locale = getLocale();
  const a = await getResearchView(params.id);
  if (!a) notFound();
  const an = a.analysis;
  const keyNumbers = parseJson<{ label: string; value: string }[]>(locale === "zh-CN" ? an?.keyNumbersZh : an?.keyNumbers, []);
  const keyArgs = parseJson<string[]>(locale === "zh-CN" ? an?.keyArgumentsZh : an?.keyArguments, []);
  const risks = parseJson<string[]>(locale === "zh-CN" ? an?.risksZh : an?.risks, []);
  const summary = locale === "zh-CN" ? an?.summaryZh : an?.summary;
  const interpretation = locale === "zh-CN" ? an?.interpretationZh : an?.interpretation;
  const date = formatDate(a.publishedAt, locale);
  const translation = a.translations[0];
  const primaryViews = a.atomicViews.filter((view) => view.importance >= 4);
  const secondaryViews = a.atomicViews.filter((view) => view.importance < 4);
  const translationStatus = translation?.status === "reviewed" ? tr(locale, "reviewed", "已复核")
    : translation?.status === "needs_review" ? tr(locale, "needs review", "待复核")
      : tr(locale, "translated", "已翻译");

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          <Link href={`/institution/${a.institution.slug}`}>{institutionName(a.institution.name, locale)}</Link>
          {a.author ? ` · ${a.author}` : ""} · {date}
          {an?.reviewStatus === "needs_review" && <span className="chip neu" style={{ marginLeft: 8 }}>{tr(locale, "needs review", "待复核")}</span>}
        </div>
        <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{locale === "zh-CN" ? localizeChineseContent(translation?.title ?? "中文译文待处理") : a.title}</h1>
      </div>

      <section className="blk">
        <div className="ai-box">
          <div className="lbl">◆ {tr(locale, "AI Summary — model-generated, not source text", "人工智能摘要 — 模型生成，非原文转载")}</div>
          <p style={{ margin: 0, color: "var(--ink-2)" }}>{summary ? locale === "zh-CN" ? localizeChineseContent(summary) : summary : tr(locale, "Structured analysis is pending. The complete source text is already available below.", "结构化分析正在等待处理，完整原文已经保存并可在下方阅读。")}</p>
        </div>
      </section>

      {a.articleAssets.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Covered assets", "涉及资产")}</div>
          <div className="tag-row">
            {a.articleAssets.map((aa) => (
              <Link key={aa.asset.ticker} href={`/asset/${aa.asset.ticker}`} className={`chip ${aa.direction > 0 ? "bull" : aa.direction < 0 ? "bear" : "neu"}`}>
                {assetName(aa.asset.name, locale, aa.asset.ticker)} {aa.direction > 0 ? "▲" : aa.direction < 0 ? "▼" : "◆"}
              </Link>
            ))}
          </div>
        </section>
      )}

      {a.atomicViews.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Atomic institutional views", "机构原子观点")} · {a.atomicViews.length}</div>
          <div className="atomic-list">
            {(primaryViews.length ? primaryViews : secondaryViews).map((view) => <AtomicViewCard key={view.id} view={view} locale={locale} />)}
          </div>
          {primaryViews.length > 0 && secondaryViews.length > 0 && <details className="atomic-more"><summary>{tr(locale, `Show ${secondaryViews.length} lower-priority views`, `展开 ${secondaryViews.length} 条次要观点`)}</summary><div className="atomic-list">{secondaryViews.map((view) => <AtomicViewCard key={view.id} view={view} locale={locale} />)}</div></details>}
        </section>
      )}

      {keyNumbers.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Key Numbers", "关键数字")}</div>
          <div className="dist">
            {keyNumbers.map((k, i) => (
              <div key={i} className="stat"><span>{locale === "zh-CN" ? localizeChineseContent(k.label) : k.label}</span><b>{k.value}</b></div>
            ))}
          </div>
        </section>
      )}

      {(keyArgs.length > 0 || risks.length > 0) && (
        <section className="blk">
          {keyArgs.length > 0 && (<><div className="section-t">{tr(locale, "Key Arguments", "关键论点")}</div><ul className="prose">{keyArgs.map((k, i) => <li key={i}>{locale === "zh-CN" ? localizeChineseContent(k) : k}</li>)}</ul></>)}
          {risks.length > 0 && (<><div className="section-t" style={{ marginTop: 16 }}>{tr(locale, "Risks", "风险")}</div><ul className="prose">{risks.map((k, i) => <li key={i}>{locale === "zh-CN" ? localizeChineseContent(k) : k}</li>)}</ul></>)}
        </section>
      )}

      {interpretation && (
        <section className="blk">
          <div className="section-t">{tr(locale, "AI Trading Interpretation", "人工智能交易解读")}</div>
          <p className="prose">{locale === "zh-CN" ? localizeChineseContent(interpretation) : interpretation}</p>
        </section>
      )}

      <section className="blk">
        <div className="section-t">{tr(locale, "Bilingual Research", "双语研报")}</div>
        {locale === "en" && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} />
          </div>
        )}
        {translation && locale === "zh-CN" ? (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              中文译文 · {translationStatus} · 质量 {translation.qualityScore?.toFixed(2) ?? "—"} · {translation.provider}/{translation.model}
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{localizeChineseContent(translation.title)}</h2>
            <ArticleBody segments={translation.segments} fallback={translation.text} locale={locale} translated />
          </div>
        ) : !translation && locale === "zh-CN" ? (
          <div className="empty-state" style={{ marginBottom: 18 }}>{tr(locale, "The Chinese translation is awaiting translation and quality review.", "中文译文正在等待翻译与质量复核。")}</div>
        ) : null}
        {locale === "zh-CN" && a.rawText && (
          <details className="article-original">
            <summary>完整英文原文</summary>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} />
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
          {tr(locale, "Source", "来源")}: {institutionName(a.institution.name, locale)}{an ? ` · ${tr(locale, "confidence", "置信度")} ${an.confidence.toFixed(2)} · ${tr(locale, "model", "模型")} ${an.model}` : ` · ${tr(locale, "analysis pending", "分析待处理")}`}
        </div>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p">{tr(locale, "Read Original ↗", "阅读官网原文 ↗")}</a>
      </section>
    </main>
  );
}
