import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { assetName, formatDate, getLocale, institutionName, localizeChineseContent, tr, LOCALES, type Locale, localePath } from "@/lib/i18n";
import { articleBlocks, stripTrailingDisclaimer, stripTrailingDisclaimerSegments } from "@/lib/articleText";
import { prisma } from "@/lib/db";
import PdfPreview from "@/app/_components/PdfPreview";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, displayTitle, localizedUrl, ogImage, reportJsonLd, stripPublisherPrefix } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { preferredEnglishDocuments, publicationReadyWhere } from "@/lib/publication";
import { researchLookupWhere, researchPath, researchRedirectPath } from "@/lib/researchPath";
import { contentQuality, isNativeChineseArticle } from "@/lib/contentQuality";
import { articleReadCounts } from "@/lib/analytics/news";
import { effectiveSummaryZh } from "@/lib/summary";
import { assetPath } from "@/lib/assetPath";
import { getArticleTopics, getPeerReports, topicHref } from "@/lib/related";
import { ClassificationChips } from "@/app/_components/ui";
import ReadingProgress from "@/app/_components/ReadingProgress";
import BookmarkButton from "@/app/_components/BookmarkButton";
import InlineRegistrationCTA from "@/app/_components/InlineRegistrationCTA";
import { registrationGateEnabled, registrationNudgeEnabled, registrationNudgeRollout } from "@/lib/registration";
import ShareCiteButton from "@/app/_components/ShareCiteButton";
import NewsletterCTA from "@/app/_components/NewsletterCTA";
import { Byline, SourceBadge } from "@/app/_components/editorial";
import { redesignAtLeast } from "@/lib/redesign";
import { getSessionUser } from "@/lib/auth";
import { directionLabel } from "@/lib/assets";
import { validateStructuredResearch } from "@/lib/ingest/researchQuality";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const locale = await getLocale();
  const article = await prisma.article.findFirst({
    where: publicationReadyWhere(researchLookupWhere(id)),
    select: {
      slug: true,
      title: true,
      rawText: true,
      sourceUrl: true,
      language: true,
      publishedAt: true,
      institution: { select: { name: true } },
      analysis: {
        select: {
          seoTitle: true, summary: true, summaryZh: true, reviewStatus: true,
          keyArguments: true, keyNumbers: true, risks: true, interpretation: true,
        },
      },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true } },
    },
  });
  if (!article) notFound();
  const zh = locale === "zh-CN";
  const title = zh && article.translations[0] ? localizeChineseContent(article.translations[0].title) : article.title;
  // What search sees. Publisher titles name the series — "The Commodities Feed", "EcoWeek 2"
  // — which tells a search engine nothing about the subject, so a generated title leads
  // instead when there is one. The page heading is unchanged: the institution's own wording
  // is what the reader is shown and what the citation carries.
  const searchTitle = clamp(stripPublisherPrefix(zh ? title : article.analysis?.seoTitle?.trim() || title, article.institution.name), 60);
  const quality = contentQuality(article, locale);
  // Only the languages that pass the gate are declared to each other. An hreflang pair where
  // one side answers noindex tells a search engine the site has a page it does not have.
  const indexableLocales = LOCALES.filter((candidate) => contentQuality(article, candidate).eligibility === "INDEX");
  // The description is the page's own summary where one exists. Where none does, the
  // institution name alone was a four-character description on Chinese pages; the fallback
  // now carries the publisher, the date and what the page is.
  const summary = (zh
    ? effectiveSummaryZh({ summaryZh: article.analysis?.summaryZh, translation: article.translations[0] })
    : article.analysis?.summary)?.trim();
  // clamp rather than slice: a description cut at exactly 158 characters ends mid-word,
  // and every report page was doing that.
  const description = clamp(summary
    || tr(
      locale,
      `${article.institution.name} published this report on ${formatDate(article.publishedAt, locale)}. This page is Tlines' structured reading of it.`,
      `${article.institution.name} 于 ${formatDate(article.publishedAt, locale)} 发布该研报，本页为 Tlines 的结构化解读。`,
    ), 158);
  return {
    // Absolute: the subject is what a searcher matches, and the layout's brand suffix costs
    // nine characters of it. Search results already show the site name separately.
    title: { absolute: searchTitle },
    description,
    /**
     * Declaring an alternate that answers `noindex` would tell a search engine the site has a
     * page it does not have, so the language map carries only the languages that passed. With
     * none, the page names only itself and adds no alternates.
     *
     * The canonical stays self-referential even when this locale is the one being withheld.
     * Pointing it at the other language was tried and is wrong: a translation is not a
     * duplicate of its source, and a canonical across languages contradicts the `hreflang`
     * pair that says these two addresses are alternates of each other. `noindex` on a page
     * that names itself canonical is one instruction, not two that disagree — the page is
     * simply not in the index, and it stays that way until it passes the gate.
     */
    ...(indexableLocales.length
      ? canonical(researchPath(article), locale, indexableLocales)
      : { alternates: { canonical: localizedUrl(researchPath(article), locale) } }),
    ...(quality.eligibility === "INDEX" ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "article",
      url: localizedUrl(researchPath(article), locale),
      locale,
      title: searchTitle,
      description,
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

/**
 * A trailing series name ("· 亚洲外汇周报") is a label, not another clause of the headline.
 * Keep it inside the H1 for the full title, but set it on its own line so the headline can
 * balance its lines instead of leaving a two-character widow.
 */
function splitResearchTitle(title: string): { main: string; series: string | null } {
  const index = title.lastIndexOf("·");
  if (index < 16) return { main: title, series: null };
  const series = title.slice(index + 1).trim();
  if (!series || series.length > 36 || /[。！？]/.test(series)) return { main: title, series: null };
  return { main: title.slice(0, index).trim(), series };
}

function localizedDirection(value: number, locale: Locale) {
  const key = directionLabel(value).key;
  return ({
    strong_bull: tr(locale, "Strong bullish", "强烈看多"),
    bull: tr(locale, "Bullish", "看多"),
    neutral: tr(locale, "Neutral", "中性"),
    bear: tr(locale, "Bearish", "看空"),
    strong_bear: tr(locale, "Strong bearish", "强烈看空"),
  } as const)[key];
}

type Figure = { id: string; afterSegmentPosition: number; alt: string | null; caption: string | null; width: number | null; height: number | null };
type Table = { id: string; afterSegmentPosition: number; caption: string | null; headerRow: boolean; dataJson: string };

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

/**
 * A publisher's table, rendered as a table.
 *
 * These used to arrive as a run of loose sentences — the cells' paragraphs lifted into the
 * body on their own — which is what a page of quarterly figures looks like when it loses its
 * rows and columns. The numbers are not translated: they are the figures the report is about,
 * and the column headings beside them are short enough that a translated table would be a
 * different table. A heading row and a scroll container are the whole treatment; the styling
 * is the site's, so a wide table scrolls rather than shrinking the reading column.
 */
function Tables({ items }: { items: Table[] }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((table) => {
        const rows = parseJson<{ rows?: string[][] }>(table.dataJson, {}).rows ?? [];
        if (rows.length === 0) return null;
        const [head, ...body] = table.headerRow ? rows : [[], ...rows];
        return (
          <figure className="article-table" key={table.id}>
            <div className="tbl-wrap">
              <table>
                {table.headerRow && head.length > 0 && (
                  <thead>
                    <tr>{head.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr>
                  </thead>
                )}
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => <td key={cellIndex} className={/^[\d.,%()\-−–+\s]*$/.test(cell) && /\d/.test(cell) ? "tnum" : undefined}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.caption && <figcaption>{table.caption}</figcaption>}
          </figure>
        );
      })}
    </>
  );
}

function ArticleBody({ segments, fallback, locale, translated = false, figures = [], tables = [] }: {
  segments: { id: string; heading: string | null; text: string }[];
  fallback: string;
  locale: Locale;
  translated?: boolean;
  figures?: Figure[];
  tables?: Table[];
}) {
  const cleanSegments = stripTrailingDisclaimerSegments(segments);
  const cleanFallback = stripTrailingDisclaimer(fallback);
  const sections = cleanSegments.length ? cleanSegments : [{ id: "fallback", heading: null, text: cleanFallback }];
  const display = (value: string) => translated && locale === "zh-CN" ? localizeChineseContent(value) : value;
  // Figures and tables anchor by body-segment index — identical for the English and Chinese
  // renders, which is what lets one table row serve both.
  const lead = figures.filter((figure) => figure.afterSegmentPosition < 0);
  const leadTables = tables.filter((table) => table.afterSegmentPosition < 0);
  const at = (index: number) => figures.filter((figure) => figure.afterSegmentPosition === index);
  const tablesAt = (index: number) => tables.filter((table) => table.afterSegmentPosition === index);
  const tail = figures.filter((figure) => figure.afterSegmentPosition >= sections.length);
  const tailTables = tables.filter((table) => table.afterSegmentPosition >= sections.length);
  return (
    <div className="prose article-sections">
      <Figures items={lead} />
      <Tables items={leadTables} />
      {sections.map((segment, index) => (
        <section
          className="article-section"
          key={segment.id}
          data-track-section={`research-section-${index + 1}`}
          data-track-title={segment.heading ? display(segment.heading) : `Section ${index + 1}`}
        >
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
          <Tables items={index === sections.length - 1 ? [...tablesAt(index), ...tailTables] : tablesAt(index)} />
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
  const canonicalRedirect = researchRedirectPath(params.id, a);
  if (canonicalRedirect) permanentRedirect(localePath(locale, canonicalRedirect));
  /**
   * A language's address exists only while that language has a page the site would index.
   *
   * The page used to stay up under `noindex` when the gate withheld it, which kept 600-odd
   * Chinese addresses in front of a crawler: pages carrying a publisher's English at a /zh
   * address, or a translation whose reviewer found whole sections still untranslated. A
   * `noindex` says "do not index this"; it does not stop the crawl, and it leaves the reader
   * on a page the site itself has judged not good enough.
   *
   * The rule is the gate's, read per request. A language that fails it is retired and the
   * reader is sent to the language that passes. `permanentRedirect`, not `redirect`: a
   * temporary redirect asks a search engine to keep the old address and keep asking after
   * it, and this address is not a second copy waiting to be judged again. Measured live,
   * `redirect` was answering 307.
   *
   * English is the fallback rather than a special case — it is the site's `x-default`, so a
   * language with no usable page falls back to it. A report with no usable page in any
   * language has no page at all and answers 404: leaving it up as `noindex` is the thing the
   * owner asked to stop, and it buys a crawl of it forever that never produces a page.
   * Nothing is written down, so a report that later passes comes back by itself.
   */
  const indexable = LOCALES.filter((candidate) => contentQuality(a, candidate).eligibility === "INDEX");
  if (!indexable.includes(locale)) {
    if (locale !== "en" && indexable.includes("en")) permanentRedirect(localePath("en", researchPath(a)));
    notFound();
  }
  const an = a.analysis;
  const keyArgs = parseJson<string[]>(locale === "zh-CN" ? an?.keyArgumentsZh : an?.keyArguments, []);
  const risks = parseJson<string[]>(locale === "zh-CN" ? an?.risksZh : an?.risks, []);
  const keyNumbers = parseJson<Array<{ label?: string; value?: string }>>(locale === "zh-CN" ? an?.keyNumbersZh : an?.keyNumbers, []);
  const date = formatDate(a.publishedAt, locale);
  const translation = a.translations[0];
  const usableTranslation = translation ?? null;
  const readCount = (await articleReadCounts([a.slug]))[a.slug];

  // The publisher's own document. Where one exists it is the report — the page around it
  // was navigation and teaser copy — so it is shown open and in full, and the text
  // extracted from that same PDF is not repeated underneath it.
  const downloadDocuments = preferredEnglishDocuments(a.documents);
  const publisherPdf = downloadDocuments.find((document) => document.kind === "source_native");
  // A publisher PDF is preferred, but an original/English PDF is still the report. It is
  // shown as the document, not repeated as extracted text with a "preview" disclosure.
  const displayPdf = publisherPdf ?? a.documents.find((document) => document.kind === "original_pdf");

  const heading = displayTitle(locale === "zh-CN" && usableTranslation ? localizeChineseContent(usableTranslation.title) : a.title);
  const titleParts = splitResearchTitle(heading);
  // Same call the gate makes, so the conclusion the reader sees is the one that let the page
  // into the index: an analysis summary where there is one, the translation's opening where
  // there is not. Reading `summaryZh` alone showed the institution name on pages the gate had
  // already accepted on the strength of their translation.
  const nativeChinese = isNativeChineseArticle(a);
  const summary = (locale === "zh-CN"
    ? nativeChinese
      ? (an?.summaryZh?.trim() || an?.summary)
      : effectiveSummaryZh({ summaryZh: an?.summaryZh, translation })
    : an?.summary) ?? institutionName(a.institution.name, locale);
  const summaryProvenance = locale === "zh-CN" && !nativeChinese && !an?.summaryZh?.trim()
    ? "translation_excerpt"
    : an?.provider === "local" ? "publisher_excerpt" : "tlines_extraction";
  const timeHorizons = [...new Set(a.atomicViews.map((view) => view.timeHorizon).filter((value) => value && value !== "unspecified"))];
  const researchTopics = [...new Set(a.atomicViews.flatMap((view) => [view.topic, view.asset]).filter((value) => value && !/^(?:general|market|other|unspecified)$/i.test(value)))];
  const sourceEvidence = a.atomicViews.filter((view) => view.sourceQuote.trim()).slice(0, 3);
  const relatedAssets = [...new Map(a.atomicViews.filter((view) => view.assetTicker).map((view) => [view.assetTicker!, view.asset])).entries()];
  // Both come from stored rows: the topics the extraction tagged, and other houses' reports
  // on the same asset. Nothing is inferred, and an absent relation renders nothing.
  const primaryTicker = a.atomicViews.find((view) => view.assetTicker)?.assetTicker ?? null;
  const primaryAssetView = primaryTicker ? a.articleAssets.find((view) => view.asset.ticker === primaryTicker) ?? null : null;
  const primarySafeForecast = primaryAssetView
    ? validateStructuredResearch({}, a.rawText ?? "", [{ ticker: primaryAssetView.asset.ticker, target: primaryAssetView.target, previousTarget: primaryAssetView.previousTarget, timeHorizon: primaryAssetView.timeHorizon }]).forecasts[0]
    : null;
  // The editorial reading layer (PRD P03), gated by the redesign flag. Everything below
  // that is not in this branch — gate, metadata, JSON-LD, evidence, downloads — is
  // identical in both modes.
  const redesigned = redesignAtLeast("article");
  const [articleTopics, peerReports, user] = await Promise.all([
    getArticleTopics(a.id, locale),
    primaryTicker ? getPeerReports({ articleId: a.id, ticker: primaryTicker, institutionId: a.institution.id, locale }) : Promise.resolve([]),
    // The session is independent of the topics and peers; waiting for them before asking
    // added a second round trip to every article open.
    redesigned ? getSessionUser() : Promise.resolve(null),
  ]);
  const bookmarked = user
    ? Boolean(await prisma.articleBookmark.findUnique({ where: { userId_articleId: { userId: user.id, articleId: a.id } }, select: { id: true } }))
    : false;

  return (
    <main className="wrap research-detail">
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
        image: a.figures[0] ? `${siteUrl()}/api/figures/${a.figures[0].id}` : new URL(ogImage("Research", heading, institutionName(a.institution.name, locale)), siteUrl()).toString(),
      })} />
      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Research", "研报"), path: "/research" },
        { name: institutionName(a.institution.name, locale), path: `/institution/${a.institution.slug}` },
        { name: heading, path: researchPath(a) },
      ])} />
      {redesigned ? (
        <>
          <ReadingProgress />
          <header className="art-head">
            <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")} style={{ marginBottom: 10 }}>
              <Link href={localePath(locale, "/research")}>{tr(locale, "Research", "研报")}</Link>
              <span>›</span>
              <Link href={localePath(locale, `/institution/${a.institution.slug}`)}>{institutionName(a.institution.name, locale)}</Link>
            </nav>
            <h1 className="art-title">
              {titleParts.main}
              {titleParts.series ? <span className="art-title-series">{titleParts.series}</span> : null}
            </h1>
            {locale === "en" && usableTranslation?.title ? (
              <details className="art-sub" style={{ fontStyle: "normal", fontSize: 14 }}>
                <summary style={{ cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12, color: "var(--faint)" }}>中文标题</summary>
                <p style={{ margin: "6px 0 0" }}>{localizeChineseContent(usableTranslation.title)}</p>
              </details>
            ) : null}
            <div className="art-meta">
              <Byline locale={locale} institution={a.institution.name} institutionSlug={a.institution.slug} publishedAt={a.publishedAt} updatedAt={a.updatedAt} />
              <span className="chip gray">{readCount?.views ?? 0} {tr(locale, "views", "阅读")}</span>
            </div>
            <div className="art-toolbar">
              <SourceBadge href={a.sourceUrl} locale={locale} />
              <div className="art-toolbar-actions">
                <BookmarkButton articleId={a.id} initialBookmarked={bookmarked} signedIn={Boolean(user)} locale={locale} gateEnabled={registrationGateEnabled()} />
                <ShareCiteButton
                  citation={`${heading} — ${institutionName(a.institution.name, locale)} — ${date} — ${localizedUrl(researchPath(a), locale)} — ${a.sourceUrl}`}
                  labels={{
                    cite: tr(locale, "Copy citation", "复制引文"),
                    copied: tr(locale, "Citation copied", "引文已复制"),
                    copyLink: tr(locale, "Copy link", "复制链接"),
                    linkCopied: tr(locale, "Link copied", "链接已复制"),
                    copyFailed: tr(locale, "Copy failed — select the address manually", "复制失败，请手动选择地址"),
                  }}
                />
              </div>
            </div>
            <ClassificationChips classification={a.classification} locale={locale} />
          </header>
        </>
      ) : (
        <div className="page-head">
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            <Link href={localePath(locale, `/institution/${a.institution.slug}`)}>{institutionName(a.institution.name, locale)}</Link>
            {a.author ? ` · ${a.author}` : ""} · {date}
          </div>
          <h1 style={{ fontSize: "clamp(24px,3.4vw,32px)" }}>{heading}</h1>
          <ClassificationChips classification={a.classification} locale={locale} />
          <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn p self-start">{tr(locale, "Official source ↗", "前往官网原文 ↗")}</a>
        </div>
      )}

      <section className="citation-card" aria-labelledby="citation-summary">
        <div className="section-t">{tr(locale, "Citable research brief", "可引用研究简报")}</div>
        <h2 id="citation-summary">{summaryProvenance === "publisher_excerpt"
          ? tr(locale, "Publisher evidence excerpt", "机构原文证据摘录")
          : summaryProvenance === "translation_excerpt"
            ? tr(locale, "Translated report excerpt", "研报译文摘录")
            : tr(locale, "Core conclusion · Tlines extraction", "核心结论 · Tlines 提取")}</h2>
        {summaryProvenance === "tlines_extraction" ? <p>{summary}</p> : <blockquote><p>{summary}</p></blockquote>}
        <dl className="citation-facts">
          <div><dt>{tr(locale, "Institution", "机构")}</dt><dd>{institutionName(a.institution.name, locale)}</dd></div>
          <div><dt>{tr(locale, "Published", "发布时间")}</dt><dd>{date}</dd></div>
          <div><dt>{tr(locale, "Research topic", "研究主题")}</dt><dd>{researchTopics.slice(0, 3).join(" · ") || tr(locale, "Not explicitly stated", "原文未明确说明")}</dd></div>
          <div><dt>{tr(locale, "Time horizon", "时间范围")}</dt><dd>{timeHorizons.join(" · ") || tr(locale, "Not explicitly stated", "原文未明确说明")}</dd></div>
        </dl>
        {relatedAssets.length > 0 && <div className="tag-row" aria-label={tr(locale, "Related assets", "相关资产")}>{relatedAssets.map(([ticker, name]) => <Link className="chip acc" href={localePath(locale, assetPath(ticker))} key={ticker}>{assetName(name, locale, ticker)} · {ticker}</Link>)}</div>}
        {keyArgs.length > 0 && <section className="citation-arguments" aria-labelledby="key-arguments-heading">
          <h2 id="key-arguments-heading">{tr(locale, "Key arguments", "关键论点")}</h2>
          <ul className="citation-list">{keyArgs.map((item, index) => <li key={`${item}-${index}`}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul>
        </section>}
        <div className="citation-evidence">
          <section aria-labelledby="key-numbers-heading">
            <h2 id="key-numbers-heading">{tr(locale, "Key numbers", "关键数字")}</h2>
            {keyNumbers.length > 0 ? <dl className={`key-number-grid${keyNumbers.length % 2 === 1 ? " single" : ""}`}>
              {keyNumbers.map((item, index) => <div key={`${item.label}-${item.value}-${index}`}>
                <dt>{item.label || tr(locale, "Value", "数值")}</dt>
                <dd>{item.value}</dd>
              </div>)}
            </dl> : <p>{tr(locale, "No source-backed key figure was extracted.", "未提取到可由原文核验的关键数字。")}</p>}
          </section>
          <section aria-labelledby="main-risks-heading">
            <h2 id="main-risks-heading">{tr(locale, "Main risks", "主要风险")}</h2>
            {risks.length > 0 ? <ul className="citation-list">{risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul> : <p>{tr(locale, "Not explicitly stated in the extracted material.", "提取材料中未明确给出。")}</p>}
          </section>
        </div>
        <section className="citation-arguments" aria-labelledby="source-evidence-heading">
          <h2 id="source-evidence-heading">{tr(locale, "Corresponding source evidence", "对应原文证据")}</h2>
          {sourceEvidence.length > 0 ? <ol className="citation-list">{sourceEvidence.map((view) => (
            <li key={view.id}><q>{view.sourceQuote}</q>{view.timeHorizon !== "unspecified" ? ` · ${view.timeHorizon}` : ""}</li>
          ))}</ol> : <p>{tr(locale, "No sentence-level evidence was extracted; verify the report directly.", "未提取到句级证据，请直接核验原文。")}</p>}
        </section>
        {a.atomicViews.some((view) => view.conditionEn || view.conditionZh) && <section className="citation-conditions">
          <h2>{tr(locale, "Conditions / invalidation", "条件 / 失效条件")}</h2>
          <ul className="citation-list">{a.atomicViews.map((view) => locale === "zh-CN" ? view.conditionZh : view.conditionEn).filter(Boolean).map((condition, index) => <li key={`${condition}-${index}`}>{condition}</li>)}</ul>
        </section>}
        <p className="citation-source">{summaryProvenance === "publisher_excerpt"
          ? tr(locale, "Context: the quoted core view and evidence are publisher wording selected by deterministic rules. Other fields are Tlines structures; verify them at the source.", "上下文：带引号的核心观点与证据为规则选出的机构原话；其余字段为 Tlines 结构化结果，请回到原始来源核验。")
          : summaryProvenance === "translation_excerpt"
            ? tr(locale, "Context: this is an automated translation excerpt, not a publisher quotation or a Tlines conclusion. Verify against the original report.", "上下文：此处为自动译文摘录，并非机构原话，也不是 Tlines 结论；请对照原始研报核验。")
            : tr(locale, "Context: the conclusion is Tlines' automated extraction, not the institution's wording. Quoted evidence is publisher wording. Scope and date must travel with the conclusion.", "上下文：结论为 Tlines 自动提取，并非机构原话；带引号的证据为机构原文。引用时须同时保留机构、日期与时间范围。")}</p>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Verify at the original source ↗", "在原始来源核验 ↗")}</a>
      </section>

      <InlineRegistrationCTA locale={locale} enabled={registrationNudgeEnabled()} rollout={registrationNudgeRollout()} />

      <section className="blk">
        <div className="section-t section-t-report">
          {downloadDocuments.length > 0 && (
            <div className="report-downloads">
              {downloadDocuments.map((document) => (
                <a key={document.id} href={localePath(locale, `/api/documents/${document.id}`)} className={`minibtn ${document.kind === "source_native" ? "p" : ""}`}>
                  {document.kind === "source_native"
                    ? tr(locale, "Download institution PDF", "下载机构原始 PDF")
                    : tr(locale, "Download English PDF", "下载英文 PDF")}
                </a>
              ))}
            </div>
          )}
          <span>{displayPdf ? tr(locale, "The report", "研报原件") : tr(locale, "Complete Research", "完整研报正文")}</span>
        </div>
        {displayPdf && (
          <PdfPreview
            src={`/api/documents/${displayPdf.id}?inline=1`}
            labels={{
              loading: tr(locale, "Loading the document…", "正在载入文档……"),
              failed: tr(locale, "This document could not be displayed. Download it instead.", "该文档无法显示,请改用下载。"),
            }}
          />
        )}
        {!displayPdf && locale === "en" && a.rawText && (
          <div className="mb-22">
            <div className="mono meta-muted mb-6">{nativeChinese ? "Complete Chinese original" : "Complete English original"}</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} tables={a.tables} />
          </div>
        )}
        {!displayPdf && locale === "zh-CN" && usableTranslation && (
          <div className="mb-22">
            <div className="mono meta-muted mb-6">
              完整中文译文
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{localizeChineseContent(usableTranslation.title)}</h2>
            <ArticleBody segments={usableTranslation.segments} fallback={usableTranslation.text} locale={locale} translated figures={a.figures} tables={a.tables} />
          </div>
        )}
        {!displayPdf && locale === "zh-CN" && !usableTranslation && a.rawText && (
          <div className="mb-22">
            <div className="mono meta-muted mb-6">{nativeChinese ? "完整中文原文" : "完整英文原文"}</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} tables={a.tables} />
          </div>
        )}
      </section>

      {(keyArgs.length > 0 || risks.length > 0) && <section className="blk">
        <h2 className="section-t">{tr(locale, "AI analysis", "AI 分析")}</h2>
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

      {(articleTopics.length > 0 || primaryAssetView) && <section className="blk">
        <h2 className="section-t">{peerReports.length > 0
          ? tr(locale, `Cross-institution comparison · ${primaryTicker}`, `多机构观点对比 · ${primaryTicker}`)
          : tr(locale, `Single-institution view · ${primaryTicker ?? ""}`, `单机构观点 · ${primaryTicker ?? ""}`)}</h2>
        {articleTopics.length > 0 && <div className="tag-row" style={{ marginBottom: peerReports.length ? 14 : 0 }}>
          {articleTopics.map((topic) => (
            <Link className="chip gray" href={localePath(locale, topicHref(topic.key))} key={topic.key}>
              {topic.label} · {topic.views}
            </Link>
          ))}
        </div>}
        {primaryAssetView && <div className="tbl-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Institution / report", "机构 / 研报")}</th>
            <th>{tr(locale, "Published", "发布日期")}</th>
            <th>{tr(locale, "Direction", "方向")}</th>
            <th>{tr(locale, "Source-checked target", "原文已核目标价")}</th>
            <th>{tr(locale, "Horizon", "时间范围")}</th>
          </tr></thead>
          <tbody>
            <tr>
              <td><b>{institutionName(a.institution.name, locale)}</b><small>{heading}</small></td>
              <td>{date}</td>
              <td>{localizedDirection(primaryAssetView.direction, locale)}</td>
              <td className="mono-cell">{primarySafeForecast?.target != null && primarySafeForecast.timeHorizon ? `$${primarySafeForecast.target.toLocaleString()}` : "—"}</td>
              <td>{primarySafeForecast?.timeHorizon || tr(locale, "Not stated", "未明确")}</td>
            </tr>
            {peerReports.map((peer) => <tr key={peer.slug}>
              <td><Link href={localePath(locale, `/research/${peer.slug}`)}><b>{institutionName(peer.institution.name, locale)}</b></Link><small>{peer.title}</small></td>
              <td>{formatDate(peer.publishedAt, locale)}</td>
              <td>{localizedDirection(peer.direction, locale)}</td>
              <td className="mono-cell">{peer.target != null && peer.timeHorizon ? `$${peer.target.toLocaleString()}` : "—"}</td>
              <td>{peer.timeHorizon || tr(locale, "Not stated", "未明确")}</td>
            </tr>)}
          </tbody>
        </table></div>}
        {primaryAssetView && peerReports.length === 0 && <p className="mono meta-muted">{tr(locale, "Only one institution is available, so Tlines does not label this as market consensus.", "目前仅有一家机构数据，因此 Tlines 不将其称为市场共识。")}</p>}
      </section>}

      {redesigned && <NewsletterCTA locale={locale} source="article" />}

      <section className="blk">
        <h2 className="section-t">{tr(locale, "How this page was produced", "本页如何生成")}</h2>
        {/* The accountability entries in the page's own context rather than only in the footer:
            who wrote what, where the original is, when it was last touched, how to dispute it. */}
        <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: "72ch" }}>
          {tr(locale,
            `Tlines extracted the conclusion, arguments, numbers and risks above from the report published by ${a.institution.name} on ${date}, then structured them for comparison. The publisher's own wording is reachable through the source link on this page${displayPdf ? " and is displayed in full above" : ""}. Last updated ${formatDate(a.updatedAt, locale)}. `,
            `本页的结论、论点、数字与风险由 Tlines 从 ${a.institution.name} 于 ${date} 发布的研报中提取并结构化，用于横向比较。机构原文可通过本页来源链接访问${displayPdf ? "，并已在上方完整展示" : ""}。最后更新于 ${formatDate(a.updatedAt, locale)}。`)}
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "Methodology", "方法论")}</Link>{" · "}
          <Link href={localePath(locale, "/sources")}>{tr(locale, "Source policy", "来源政策")}</Link>{" · "}
          <Link href={localePath(locale, "/ai-usage")}>{tr(locale, "AI usage", "AI 使用说明")}</Link>{" · "}
          <Link href={localePath(locale, "/corrections")}>{tr(locale, "Request a correction", "申请更正")}</Link>
        </p>
      </section>
    </main>
  );
}
