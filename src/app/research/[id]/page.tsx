import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { assetName, formatDate, getLocale, institutionName, localizeChineseContent, tr, type Locale, localePath } from "@/lib/i18n";
import { articleBlocks, stripTrailingDisclaimer, stripTrailingDisclaimerSegments } from "@/lib/articleText";
import { prisma } from "@/lib/db";
import PdfPreview from "@/app/_components/PdfPreview";
import { JsonLd, breadcrumbJsonLd, canonical, localizedUrl, ogImage, reportJsonLd } from "@/lib/seo";
import { preferredEnglishDocuments, publicationReadyWhere, LOCALE_STRICT_ZH_SINCE } from "@/lib/publication";
import { researchPath } from "@/lib/researchPath";
import { contentQuality } from "@/lib/contentQuality";
import { assetPath } from "@/lib/assetPath";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const locale = await getLocale();
  const article = await prisma.article.findFirst({
    where: publicationReadyWhere({ OR: [{ id }, { slug: id }] }),
    select: {
      slug: true,
      title: true,
      rawText: true,
      sourceUrl: true,
      language: true,
      publishedAt: true,
      institution: { select: { name: true } },
      analysis: { select: { seoTitle: true, summary: true, summaryZh: true, reviewStatus: true } },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true } },
    },
  });
  if (!article) return { title: tr(locale, "Report not found", "研报未找到") };
  const zh = locale === "zh-CN";
  const title = zh && article.translations[0] ? localizeChineseContent(article.translations[0].title) : article.title;
  // What search sees. Publisher titles name the series — "The Commodities Feed", "EcoWeek 2"
  // — which tells a search engine nothing about the subject, so a generated title leads
  // instead when there is one. The page heading is unchanged: the institution's own wording
  // is what the reader is shown and what the citation carries.
  const searchTitle = zh ? title : article.analysis?.seoTitle?.trim() || title;
  const description = (zh ? article.analysis?.summaryZh : article.analysis?.summary)
    ?? institutionName(article.institution.name, locale);
  const quality = contentQuality(article, locale);
  const availableLocales = article.translations[0] ? (["en", "zh-CN"] as const) : (["en"] as const);
  return {
    title: searchTitle,
    description: description.slice(0, 160),
    ...canonical(researchPath(article), locale, availableLocales),
    ...(quality.eligibility === "INDEX" ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "article",
      url: localizedUrl(researchPath(article), locale),
      locale,
      title: searchTitle,
      description: description.slice(0, 160),
      publishedTime: article.publishedAt.toISOString(),
      images: [{ url: ogImage("Research", title, article.institution.name), width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [ogImage("Research", title, article.institution.name)] },
  };
}


function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

type Figure = { id: string; afterSegmentPosition: number; alt: string | null; caption: string | null; width: number | null; height: number | null };

function Figures({ items }: { items: Figure[] }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((figure) => (
        <figure className="article-figure" key={figure.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/figures/${figure.id}`} alt={figure.alt ?? figure.caption ?? ""} width={figure.width ?? undefined} height={figure.height ?? undefined} loading="lazy" />
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
  if (params.id !== a.slug) permanentRedirect(localePath(locale, researchPath(a)));
  // A report first seen after the cutoff with no Chinese translation yet must not render a
  // half-English page in Chinese: send the reader to the English report instead, until the
  // translation lands. Older reports are grandfathered and shown as before.
  if (locale === "zh-CN" && !a.translations[0] && a.createdAt >= LOCALE_STRICT_ZH_SINCE) {
    redirect(localePath("en", researchPath(a)));
  }
  const an = a.analysis;
  const keyArgs = parseJson<string[]>(locale === "zh-CN" ? an?.keyArgumentsZh : an?.keyArguments, []);
  const risks = parseJson<string[]>(locale === "zh-CN" ? an?.risksZh : an?.risks, []);
  const keyNumbers = parseJson<Array<{ label?: string; value?: string }>>(locale === "zh-CN" ? an?.keyNumbersZh : an?.keyNumbers, []);
  const date = formatDate(a.publishedAt, locale);
  const translation = a.translations[0];
  const usableTranslation = translation ?? null;

  // The publisher's own document. Where one exists it is the report — the page around it
  // was navigation and teaser copy — so it is shown open and in full, and the text
  // extracted from that same PDF is not repeated underneath it.
  const downloadDocuments = preferredEnglishDocuments(a.documents);
  const publisherPdf = downloadDocuments.find((document) => document.kind === "source_native");
  const previewDocument = publisherPdf ?? a.documents.find((document) => document.kind === "original_pdf");

  const heading = locale === "zh-CN" && usableTranslation ? localizeChineseContent(usableTranslation.title) : a.title;
  const summary = (locale === "zh-CN" ? an?.summaryZh : an?.summary) ?? institutionName(a.institution.name, locale);
  const relatedAssets = [...new Map(a.atomicViews.filter((view) => view.assetTicker).map((view) => [view.assetTicker!, view.asset])).entries()];

  return (
    <main className="wrap" style={{ maxWidth: publisherPdf ? 1080 : 820 }}>
      <JsonLd data={reportJsonLd({
        slug: a.slug,
        title: heading,
        description: summary,
        publishedAt: a.publishedAt,
        updatedAt: a.updatedAt,
        institution: a.institution.name,
        sourceUrl: a.sourceUrl,
        locale,
        author: a.author,
        about: [...new Set(a.atomicViews.flatMap((view) => [view.topic, view.asset]).filter(Boolean))],
        hasTranslation: Boolean(usableTranslation),
      })} />
      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Research", "研报"), path: "/research" },
        { name: institutionName(a.institution.name, locale), path: `/institution/${a.institution.slug}` },
        { name: heading, path: researchPath(a) },
      ])} />
      <div className="page-head">
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          <Link href={localePath(locale, `/institution/${a.institution.slug}`)}>{institutionName(a.institution.name, locale)}</Link>
          {a.author ? ` · ${a.author}` : ""} · {date}
        </div>
        <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{heading}</h1>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p" style={{ alignSelf: "flex-start" }}>{tr(locale, "Official source ↗", "前往官网原文 ↗")}</a>
      </div>

      <section className="citation-card" aria-labelledby="citation-summary">
        <div className="section-t">{tr(locale, "Citable research brief", "可引用研究简报")}</div>
        <h2 id="citation-summary">{tr(locale, "One-sentence conclusion", "一句话结论")}</h2>
        <p>{summary}</p>
        <dl className="citation-facts">
          <div><dt>{tr(locale, "Institution", "机构")}</dt><dd>{institutionName(a.institution.name, locale)}</dd></div>
          <div><dt>{tr(locale, "Published", "发布时间")}</dt><dd>{date}</dd></div>
          <div><dt>{tr(locale, "Time horizon", "时间范围")}</dt><dd>{[...new Set(a.atomicViews.map((view) => view.timeHorizon))].join(" · ") || tr(locale, "Not explicitly stated", "原文未明确说明")}</dd></div>
        </dl>
        {relatedAssets.length > 0 && <div className="tag-row" aria-label={tr(locale, "Related assets", "相关资产")}>{relatedAssets.map(([ticker, name]) => <Link className="chip acc" href={localePath(locale, assetPath(ticker))} key={ticker}>{assetName(name, locale, ticker)} · {ticker}</Link>)}</div>}
        {keyArgs.length > 0 && <section className="citation-arguments" aria-labelledby="key-arguments-heading">
          <h3 id="key-arguments-heading">{tr(locale, "Key arguments", "关键论点")}</h3>
          <ul className="citation-list">{keyArgs.map((item, index) => <li key={`${item}-${index}`}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul>
        </section>}
        {(keyNumbers.length > 0 || risks.length > 0) && <div className="citation-evidence">
          {keyNumbers.length > 0 && <section aria-labelledby="key-numbers-heading">
            <h3 id="key-numbers-heading">{tr(locale, "Key numbers", "关键数字")}</h3>
            <dl className="key-number-grid">
              {keyNumbers.map((item, index) => <div key={`${item.label}-${item.value}-${index}`}>
                <dt>{item.label || tr(locale, "Value", "数值")}</dt>
                <dd>{item.value}</dd>
              </div>)}
            </dl>
          </section>}
          {risks.length > 0 && <section aria-labelledby="main-risks-heading">
            <h3 id="main-risks-heading">{tr(locale, "Main risks", "主要风险")}</h3>
            <ul className="citation-list">{risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul>
          </section>}
        </div>}
        {a.atomicViews.some((view) => view.conditionEn || view.conditionZh) && <section className="citation-conditions">
          <h3>{tr(locale, "Conditions / invalidation", "条件 / 失效条件")}</h3>
          <ul className="citation-list">{a.atomicViews.map((view) => locale === "zh-CN" ? view.conditionZh : view.conditionEn).filter(Boolean).map((condition, index) => <li key={`${condition}-${index}`}>{condition}</li>)}</ul>
        </section>}
        <p className="citation-source">{tr(locale, "Context: this is Tlines' automated structure of a public institutional report, not the institution's wording. Scope and date above travel with the conclusion.", "上下文：这是 Tlines 对公开机构研报的自动结构化结果，并非机构原话；引用结论时须同时保留上述机构与日期范围。")}</p>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Verify at the original source ↗", "在原始来源核验 ↗")}</a>
      </section>

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
              zoomIn: tr(locale, "Zoom in", "放大"),
              zoomOut: tr(locale, "Zoom out", "缩小"),
            }}
          />
        )}
        {publisherPdf && locale === "zh-CN" && usableTranslation && (
          // Kept, but behind a disclosure: the document above is the report, and this is
          // a reading aid beside it.
          <details className="article-original" style={{ marginTop: 18 }}>
            <summary>完整中文译文</summary>
            <ArticleBody segments={usableTranslation.segments} fallback={usableTranslation.text} locale={locale} translated figures={a.figures} />
          </details>
        )}
        {!publisherPdf && locale === "en" && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && usableTranslation && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              完整中文译文
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{localizeChineseContent(usableTranslation.title)}</h2>
            <ArticleBody segments={usableTranslation.segments} fallback={usableTranslation.text} locale={locale} translated figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && !usableTranslation && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {!publisherPdf && locale === "zh-CN" && usableTranslation && a.rawText && (
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
                zoomIn: tr(locale, "Zoom in", "放大"),
                zoomOut: tr(locale, "Zoom out", "缩小"),
              }}
            />
          </details>
        )}
        <div className="act">
          {downloadDocuments.map((document) => (
            <a key={document.id} href={localePath(locale, `/api/documents/${document.id}`)} className={`minibtn ${document.kind === "source_native" ? "p" : ""}`}>
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
      </section>}
    </main>
  );
}
