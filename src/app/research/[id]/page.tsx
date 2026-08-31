import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearchView } from "@/lib/queries";
import { formatDate, getLocale, institutionName, localizeChineseContent, tr, type Locale } from "@/lib/i18n";
import { stripTrailingDisclaimer, stripTrailingDisclaimerSegments } from "@/lib/articleText";

export const dynamic = "force-dynamic";

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
          <div className="article-body">{display(segment.text)}</div>
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

      <section className="blk">
        <div className="section-t">{tr(locale, "Complete Research", "完整研报正文")}</div>
        {locale === "en" && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {locale === "zh-CN" && translation && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              完整中文译文
            </div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{localizeChineseContent(translation.title)}</h2>
            <ArticleBody segments={translation.segments} fallback={translation.text} locale={locale} translated figures={a.figures} />
          </div>
        )}
        {locale === "zh-CN" && !translation && a.rawText && (
          <div style={{ marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Complete English original</div>
            <ArticleBody segments={a.segments} fallback={a.rawText} locale={locale} figures={a.figures} />
          </div>
        )}
        {locale === "zh-CN" && translation && a.rawText && (
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
        <div className="act">
          {a.documents.map((document) => (
            <a key={document.id} href={`/api/documents/${document.id}`} className={`minibtn ${document.kind === "translation_pdf" ? "p" : ""}`}>
              {document.kind === "translation_pdf" ? tr(locale, "Download Chinese PDF", "下载中文 PDF") : document.kind === "source_native" ? tr(locale, "Download institution PDF", "下载机构原始 PDF") : tr(locale, "Download English PDF", "下载英文 PDF")}
            </a>
          ))}
        </div>
      </section>

      {(keyArgs.length > 0 || risks.length > 0) && <section className="blk">
        <div className="section-t">{tr(locale, "Optional analysis", "按需分析")}</div>
        {keyArgs.length > 0 && <details className="article-original"><summary>{tr(locale, "Key arguments", "关键论点")}</summary><ul className="prose">{keyArgs.map((item, index) => <li key={index}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul></details>}
        {risks.length > 0 && <details className="article-original"><summary>{tr(locale, "Risks", "风险")}</summary><ul className="prose">{risks.map((item, index) => <li key={index}>{locale === "zh-CN" ? localizeChineseContent(item) : item}</li>)}</ul></details>}
      </section>}
    </main>
  );
}
