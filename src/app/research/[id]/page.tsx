import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { formatDate, getLocale, institutionName, localizeChineseContent, tr, type Locale } from "@/lib/i18n";
import { articleBlocks, stripTrailingDisclaimer, stripTrailingDisclaimerSegments } from "@/lib/articleText";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { queueContentRetry } from "@/app/admin/actions";
import PdfPreview from "@/app/_components/PdfPreview";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const locale = await getLocale();
  const article = await prisma.article.findUnique({
    where: { id },
    select: {
      title: true,
      publishedAt: true,
      institution: { select: { name: true } },
      analysis: { select: { summary: true, summaryZh: true } },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } },
    },
  });
  if (!article) return { title: tr(locale, "Report not found", "研报未找到") };
  const zh = locale === "zh-CN";
  const title = zh && article.translations[0] ? localizeChineseContent(article.translations[0].title) : article.title;
  const description = (zh ? article.analysis?.summaryZh : article.analysis?.summary)
    ?? institutionName(article.institution.name, locale);
  return {
    title,
    description: description.slice(0, 300),
    openGraph: {
      type: "article",
      title,
      description: description.slice(0, 300),
      publishedTime: article.publishedAt.toISOString(),
    },
  };
}


function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

type Figure = { id: string; afterSegmentPosition: number; alt: string | null; caption: string | null };

function Figures({ items }: { items: Figure[] }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((figure) => (
        <figure className="article-figure" key={figure.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/figures/${figure.id}`} alt={figure.alt ?? figure.caption ?? ""} loading="lazy" />
          {figure.caption && <figcaption>{figure.caption}</figcaption>}
        </figure>
      ))}
    </>
  );
}

function ArticleBody({ segments, fallback, locale, translated = false, figures = [] }: {
  segments: { id: string; heading: string | null; text: string }[];
  fallback: string;
  locale: Locale;
  translated?: boolean;
  figures?: Figure[];
}) {
  const cleanSegments = stripTrailingDisclaimerSegments(segments);
  const cleanFallback = stripTrailingDisclaimer(fallback);
  const sections = cleanSegments.length ? cleanSegments : [{ id: "fallback", heading: null, text: cleanFallback }];
  const display = (value: string) => translated && locale === "zh-CN" ? localizeChineseContent(value) : value;
  // Figures anchor by body-segment index — identical for the English and Chinese renders.
  const lead = figures.filter((figure) => figure.afterSegmentPosition < 0);
  const at = (index: number) => figures.filter((figure) => figure.afterSegmentPosition === index);
  const tail = figures.filter((figure) => figure.afterSegmentPosition >= sections.length);
  return (
    <div className="prose article-sections">
      <Figures items={lead} />
      {sections.map((segment, index) => (
        <section className="article-section" key={segment.id}>
          {segment.heading && <h3>{display(segment.heading)}</h3>}
          <div className="article-body">
            {articleBlocks(display(segment.text)).map((block, blockIndex) =>
              block.kind === "list" ? (
                <ul key={blockIndex}>
                  {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                </ul>
              ) : (
                <p key={blockIndex}>{block.text}</p>
              ),
            )}
          </div>
          <Figures items={index === sections.length - 1 ? [...at(index), ...tail] : at(index)} />
        </section>
      ))}
    </div>
  );
}

export default async function ResearchPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const a = await getResearchView(params.id);
  if (!a) notFound();
  const an = a.analysis;
  const keyArgs = parseJson<string[]>(locale === "zh-CN" ? an?.keyArgumentsZh : an?.keyArguments, []);
  const risks = parseJson<string[]>(locale === "zh-CN" ? an?.risksZh : an?.risks, []);
  const date = formatDate(a.publishedAt, locale);
  const translation = a.translations[0];
  const analysisPoor = an?.reviewStatus === "needs_review";
  const translationPoor = (translation?.qualityScore ?? 1) < 0.8;
  const qualityWarning = analysisPoor || translationPoor;

  // The publisher's own document. Where one exists it is the report — the page around it
  // was navigation and teaser copy — so it is shown open and in full, and the text
  // extracted from that same PDF is not repeated underneath it.
  const publisherPdf = a.documents.find((document) => document.kind === "source_native");
  const previewDocument = publisherPdf ?? a.documents.find((document) => document.kind === "original_pdf");

  const user = await getSessionUser();
  const isOperator = can(user, "admin.review");
  // The retry log is operator-facing: readers get the notice, operators get the audit trail.
  const retries = qualityWarning && isOperator
    ? await prisma.contentRetry.findMany({ where: { articleId: a.id }, orderBy: { requestedAt: "desc" } })
    : [];

  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          <Link href={`/institution/${a.institution.slug}`}>{institutionName(a.institution.name, locale)}</Link>
          {a.author ? ` · ${a.author}` : ""} · {date}
        </div>
        <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{locale === "zh-CN" && translation ? localizeChineseContent(translation.title) : a.title}</h1>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p" style={{ alignSelf: "flex-start" }}>{tr(locale, "Official source ↗", "前往官网原文 ↗")}</a>
      </div>

      {qualityWarning && <div className="quality-notice" role="status">
        <b>{tr(locale, "Automated quality notice", "自动质量提示")}</b>
        <span>{tr(locale, "This report remains available, but its AI analysis or translation scored below the preferred quality threshold and is queued for improvement. Verify material decisions against the official source.", "本研报仍可阅读，但 AI 分析或译文低于优选质量阈值，已进入改进队列。重要判断请同时核对官网原文。")}</span>
        {isOperator && <div className="retry-controls">
          {(["analysis", "translation"] as const)
            .filter((kind) => (kind === "analysis" ? analysisPoor : translationPoor))
            .map((kind) => {
              const retry = retries.find((row) => row.kind === kind);
              const pending = retry?.status === "queued" || retry?.status === "running";
              return (
                <form action={queueContentRetry} key={kind}>
                  <input type="hidden" name="articleId" value={a.id} />
                  <input type="hidden" name="kind" value={kind} />
                  <button type="submit" className="minibtn" disabled={pending}>
                    {kind === "analysis" ? tr(locale, "Re-run analysis", "重跑分析") : tr(locale, "Re-run translation", "重跑译文")}
                  </button>
                </form>
              );
            })}
          {retries.map((retry) => (
            <span className="retry-log mono" key={retry.id}>
              {retry.kind} · {retry.status}
              {retry.scoreBefore !== null ? ` · ${retry.scoreBefore.toFixed(2)}` : ""}
              {retry.scoreAfter !== null ? ` → ${retry.scoreAfter.toFixed(2)}` : ""}
              {retry.error ? ` · ${retry.error.slice(0, 80)}` : ""}
            </span>
          ))}
        </div>}
      </div>}

      <section className="blk">
        <div className="section-t">{publisherPdf ? tr(locale, "The report", "研报原件") : tr(locale, "Complete Research", "完整研报正文")}</div>
        {publisherPdf && (
          <PdfPreview
            src={`/api/documents/${publisherPdf.id}?inline=1`}
            labels={{
              loading: tr(locale, "Loading the document…", "正在载入文档……"),
              failed: tr(locale, "This document could not be displayed. Download it instead.", "该文档无法显示,请改用下载。"),
              page: tr(locale, "Page", "第"),
              of: tr(locale, "of", "/"),
              previous: tr(locale, "Previous page", "上一页"),
              next: tr(locale, "Next page", "下一页"),
              zoomIn: tr(locale, "Zoom in", "放大"),
              zoomOut: tr(locale, "Zoom out", "缩小"),
            }}
          />
        )}
        {publisherPdf && locale === "zh-CN" && translation && (
          // Kept, but behind a disclosure: the document above is the report, and this is
          // a reading aid beside it.
          <details className="article-original" style={{ marginTop: 18 }}>
            <summary>完整中文译文</summary>
            <ArticleBody segments={translation.segments} fallback={translation.text} locale={locale} translated figures={a.figures} />
          </details>
        )}
        {!publisherPdf && locale === "en" && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && translation && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              完整中文译文
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{localizeChineseContent(translation.title)}</h2>
            <ArticleBody segments={translation.segments} fallback={translation.text} locale={locale} translated figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && !translation && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && translation && a.rawText && (
          <details className="article-original">
            <summary>完整英文原文</summary>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </details>
        )}
        {a.disclaimerText && (
          <details className="article-original">
            <summary>{tr(locale, "Publisher disclaimer", "机构免责声明")}</summary>
            <div className="prose article-body" style={{ marginTop: 12 }}>{a.disclaimerText}</div>
          </details>
        )}
        {!publisherPdf && previewDocument && (
          <details className="pdf-preview">
            <summary>{tr(locale, "Preview PDF", "预览 PDF")}</summary>
            <PdfPreview
              src={`/api/documents/${previewDocument.id}?inline=1`}
              labels={{
                loading: tr(locale, "Loading the document…", "正在载入文档……"),
                failed: tr(locale, "This document could not be displayed. Download it instead.", "该文档无法显示,请改用下载。"),
                page: tr(locale, "Page", "第"),
                of: tr(locale, "of", "/"),
                previous: tr(locale, "Previous page", "上一页"),
                next: tr(locale, "Next page", "下一页"),
                zoomIn: tr(locale, "Zoom in", "放大"),
                zoomOut: tr(locale, "Zoom out", "缩小"),
              }}
            />
          </details>
        )}
        <div className="act">
          {a.documents.map((document) => (
            <a key={document.id} href={`/api/documents/${document.id}`} className={`minibtn ${document.kind === "source_native" ? "p" : ""}`}>
              {document.kind === "source_native"
                ? tr(locale, "Download institution PDF", "下载机构原始 PDF")
                : tr(locale, "Download English PDF", "下载英文 PDF")}
            </a>
          ))}
        </div>
      </section>

      {(keyArgs.length > 0 || risks.length > 0) && <section className="blk">
        <div className="section-t">{tr(locale, "AI analysis", "AI 分析")}</div>
        {/* The body above is the institution's own text. Everything in this block is
            model-written about that text, and the distinction has to be legible. */}
        <div className="ai-analysis-label">
          {tr(
            locale,
            "AI-generated from the report above · not a translation and not the institution's wording · verify against the official source",
            "由 AI 依据上文研报生成 · 非原文直译、非机构原话 · 重要判断请核对官网原文",
          )}
        </div>
        {keyArgs.length > 0 && <details className="article-original"><summary>{tr(locale, "Key arguments", "关键论点")}</summary><ul className="prose">{keyArgs.map((item, index) => <li key={index}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul></details>}
        {risks.length > 0 && <details className="article-original"><summary>{tr(locale, "Risks", "风险")}</summary><ul className="prose">{risks.map((item, index) => <li key={index}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul></details>}
      </section>}
    </main>
  );
}
