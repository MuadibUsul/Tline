import Link from "next/link";
import LiveFeed from "./LiveFeed";
import NewsletterCTA from "./NewsletterCTA";
import { Byline, cleanDisplayTitle } from "./editorial";
import { assetPath } from "@/lib/assetPath";
import { newsAgo, newsImageAlt, newsTitle, type NewsRecord } from "@/lib/news";
import { domainTerm, institutionName, localePath, tr, type Locale } from "@/lib/i18n";
import { researchPath } from "@/lib/researchPath";
import { topicPath, type TopicStat } from "@/lib/topics";
import { JsonLd, organizationJsonLd, siteJsonLd } from "@/lib/seo";
import type { FeedPulse, featuredFeed } from "@/lib/queries";
import { Icon } from "./Icon";

/**
 * The editorial front page (PRD P01): what is worth reading today, where to verify it, and
 * what the institutions changed their minds about — no marketing hero, every item
 * traceable. All rows arrive already filtered by the publication gate; this component
 * only lays them out.
 */

type FeedRow = Awaited<ReturnType<typeof featuredFeed>>[number];

export interface FrontTheme {
  key: string;
  titleEn: string;
  titleZh: string;
  direction: string;
  institutionCount: number;
  viewCount: number;
}

export interface FrontWatchRow {
  id: string;
  view: string;
  /** True when a Chinese page had to fall back to the English view text. */
  viewIsFallback: boolean;
  assetTicker: string | null;
  institution: string;
  institutionSlug: string;
  slug: string;
  publishedAt: string;
}

export interface FrontFigure {
  id: string;
  caption: string | null;
  slug: string;
  title: string;
}

export default function HomeFront({
  locale,
  pulse,
  lead,
  secondary,
  watch,
  topics,
  themes,
  figure,
  assets,
  news,
}: {
  locale: Locale;
  pulse: FeedPulse;
  lead: FeedRow[];
  secondary: FeedRow[];
  watch: FrontWatchRow[];
  topics: TopicStat[];
  themes: FrontTheme[];
  figure: FrontFigure | null;
  assets: Array<{ ticker: string; name: string }>;
  news: NewsRecord[];
}) {
  const zh = locale === "zh-CN";
  const [top, ...restLeads] = lead;
  const secondaryRows = [...restLeads, ...secondary].slice(0, 4);

  return (
    <main className="wrap home">
      <JsonLd data={organizationJsonLd(locale)} />
      <JsonLd data={siteJsonLd(locale, tr(locale, "Institutional research turned into comparable, traceable market signals.", "把机构研报转换为可比较、可追踪的市场信号。"))} />
      <LiveFeed
        initial={pulse}
        label={tr(locale, "New research", "有新研报")}
        ariaLabel={tr(locale, "Load newly published research", "载入新发布的研报")}
      />

      {/* The page opens on content: the masthead that used to sit here (statement, search,
          coverage numbers) was removed 2026-10-17. Search lives in the header; the numbers
          moved to the About page. */}

      {/* The editorial cover: one lead story, the rest of the picks beside it. */}
      <div className="front-section-head">
        <div><span className="eyebrow">{tr(locale, "Editorial desk", "编辑台")}</span><h1>{tr(locale, "What matters now", "此刻值得关注")}</h1></div>
        <Link href={localePath(locale, "/research")}>{tr(locale, "Browse all research", "浏览全部研报")} <Icon name="arrow-right" /></Link>
      </div>
      <section className="front-grid" aria-label={tr(locale, "Today's cover", "今日封面")} data-track-section="home-cover" data-track-title={tr(locale, "Today's cover", "今日封面")}>
        {top ? (
          <article className="ed-feature">
            <Byline locale={locale} institution={top.institution.name} institutionSlug={top.institution.slug} publishedAt={top.publishedAt} />
            <h2>
              <Link href={localePath(locale, researchPath(top))}>
                {cleanDisplayTitle(zh && top.translations?.[0]?.title ? top.translations[0].title : top.title, top.institution.name)}
              </Link>
            </h2>
            {(zh ? top.analysis?.summaryZh : top.analysis?.summary)
              ? <p className="sub">{zh ? top.analysis?.summaryZh : top.analysis?.summary}</p>
              : null}
            <p className="ed-actions">
              <Link className="minibtn p" href={localePath(locale, researchPath(top))}>
                {tr(locale, "Read the analysis", "阅读深度分析")} <Icon name="arrow-right" />
              </Link>
            </p>
          </article>
        ) : (
          <div className="empty-state">{tr(locale, "No report is published yet.", "暂无已发布研报。")}</div>
        )}
        <div className="front-lead-links">
          {secondaryRows.map((row) => (
            <Link key={row.id} href={localePath(locale, researchPath(row))}>
              <h3>{cleanDisplayTitle(zh && row.translations?.[0]?.title ? row.translations[0].title : row.title, row.institution.name)}</h3>
              <p className="sub mono">{institutionName(row.institution.name, locale)} · {new Date(row.publishedAt).toISOString().slice(0, 10)}</p>
            </Link>
          ))}
          <Link className="front-more" href={localePath(locale, "/research")}>{tr(locale, "All research", "全部研报")} →</Link>
        </div>
      </section>

      {/* Institutions changed their minds about…, with the newsroom's latest beside them. */}
      {(watch.length > 0 || news.length > 0) && (
        <section className="blk front-observations" aria-label={tr(locale, "Today's institutional observations", "今日机构观察")} data-track-section="home-observations" data-track-title={tr(locale, "Institutional observations", "机构观察")}>
          <div className={`front-ob-grid${watch.length === 0 ? " solo-news" : ""}`}>
            {watch.length > 0 && (
              <div className="front-ob-main">
                <div className="section-t">
                  <span>{tr(locale, "Today's institutional observations", "今日机构观察")}</span>
                  <Link className="chip gray" href={localePath(locale, "/institutions")}>{tr(locale, "All views", "更多观点")} →</Link>
                </div>
                <div className="front-watch">
                  {watch.map((row) => (
                    <div className="r" key={row.id}>
                      <span className="who">
                        <Link href={localePath(locale, `/institution/${row.institutionSlug}`)}>{institutionName(row.institution, locale)}</Link>
                        {row.viewIsFallback ? <span className="lang-tag" title={tr(locale, "No Chinese summary for this view yet; showing the English extraction.", "该观点暂无中文摘要,显示英文提取结果。")}>EN</span> : null}
                      </span>
                      <span className="what">
                        <Link href={localePath(locale, `/research/${row.slug}`)}>{row.view}</Link>
                      </span>
                      <span className="meta">
                        <time dateTime={row.publishedAt}>{new Date(row.publishedAt).toISOString().slice(0, 10)}</time>
                        {row.assetTicker ? <Link className="chip acc" href={localePath(locale, assetPath(row.assetTicker))}>{row.assetTicker}</Link> : null}
                        <Link className="source-link" href={localePath(locale, `/research/${row.slug}`)}>{tr(locale, "source report", "原始研报")} →</Link>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {news.length > 0 && (
              <aside className="front-news-rail" aria-label={tr(locale, "Latest news", "最新新鲜事")} data-track-section="home-news" data-track-title={tr(locale, "Newsroom", "新鲜事")}>
                <div className="front-news-head">
                  <span className="section-t newsroom-head">{tr(locale, "Newsroom", "新鲜事")}</span>
                  <Link className="chip gray" href={localePath(locale, "/news")}>{tr(locale, "All", "全部")} →</Link>
                </div>
                <div className="front-news-list">
                  {news.map((post) => {
                    const headline = newsTitle(post, locale);
                    if (!headline) return null;
                    const cover = post.images?.[0] ?? null;
                    return (
                      <Link className={`front-news-item${cover ? " has-image" : ""}`} key={post.id} href={localePath(locale, `/news/${post.slug}`)}>
                        <time dateTime={post.publishedAt?.toISOString()}>{post.publishedAt ? newsAgo(post.publishedAt, locale) : ""}</time>
                        <span className="headline">{headline}</span>
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element -- stored in the news image table
                          <img className="front-news-thumb" src={`/api/news-images/${cover.id}?variant=thumb`} alt={newsImageAlt(cover, locale)} loading="lazy" />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </aside>
            )}
          </div>
        </section>
      )}

      {/* Three ongoing desks side by side: market narratives, the subjects institutions
          keep returning to, and the weekly letter. Every row/ chip links to its page. */}
      <section className="front-band front-triptych" aria-label={tr(locale, "Ongoing desks", "常设栏目")} data-track-section="home-desks" data-track-title={tr(locale, "Ongoing desks", "常设栏目")}>
        <div className="blk">
          <div className="section-t"><span>{tr(locale, "Themes in motion", "交易主线")}</span><Link className="chip gray" href={localePath(locale, "/market-themes")}>{tr(locale, "All", "全部")} →</Link></div>
          {themes.length > 0 ? (
            <div className="front-watch">
              {themes.slice(0, 3).map((theme) => (
                <Link className="r" key={theme.key} href={`${localePath(locale, "/market-themes")}#${encodeURIComponent(theme.key)}`}>
                  <span className="who">
                    <span className={`chip ${theme.direction === "bullish" ? "bull" : theme.direction === "bearish" ? "bear" : "neu"}`}>
                      {theme.direction === "bullish" ? tr(locale, "Bullish", "看多") : theme.direction === "bearish" ? tr(locale, "Bearish", "看跌") : tr(locale, "Neutral", "中性")}
                    </span>
                  </span>
                  <span className="what">{zh ? theme.titleZh : theme.titleEn}</span>
                  <span className="meta">{theme.institutionCount} {tr(locale, "institutions", "家机构")} · {theme.viewCount} {tr(locale, "views", "条观点")}</span>
                </Link>
              ))}
            </div>
          ) : <p className="sub empty-copy">{tr(locale, "No active theme at the moment.", "当前暂无活跃主线。")}</p>}
        </div>

        <div className="blk">
          <div className="section-t"><span>{tr(locale, "Institutional interests", "机构兴趣")}</span><Link className="chip gray" href={localePath(locale, "/topics")}>{tr(locale, "All", "全部")} →</Link></div>
          {topics.length > 0 ? (
            <div className="tag-row">
              {topics.slice(0, 8).map((topic) => (
                <Link key={topic.key} href={localePath(locale, topicPath(topic.key))} className="chip gray">
                  {zh ? topic.labelZh : topic.labelEn}
                </Link>
              ))}
            </div>
          ) : <p className="sub empty-copy">{tr(locale, "No subject has enough coverage yet.", "暂无达到覆盖门槛的主题。")}</p>}
        </div>

        <NewsletterCTA locale={locale} source="home" variant="column" />
      </section>

      {/* One figure worth reading. */}
      {figure && (
        <section className="blk" aria-label={tr(locale, "Chart of the day", "一张值得读的图")} data-track-section="home-chart" data-track-title={tr(locale, "Chart of the day", "一张值得读的图")}>
          <div className="section-t">{tr(locale, "A figure worth reading", "一张值得读的图")}</div>
          <figure className="ed-figure front-figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the private figure store, not a static asset */}
            <img src={`/api/figures/${figure.id}`} alt={figure.caption ?? figure.title} loading="lazy" />
            <figcaption>
              <span>{figure.caption ?? figure.title}</span>
              <Link href={localePath(locale, `/research/${figure.slug}`)}>{tr(locale, "From the report", "出自研报")}：{figure.title} →</Link>
            </figcaption>
          </figure>
        </section>
      )}

      <section className="home-verification">
        <div><span><Icon name="check" /></span><p><strong>{tr(locale, "Built to be checked", "经得起核对")}</strong>{tr(locale, "Every view links back to its original report. Our extraction rules, accepted sources, AI use and correction process are public.", "每条观点都链接回原始研报；提取规则、来源标准、AI 使用方式与纠错流程全部公开。")}</p></div>
        <nav aria-label={tr(locale, "Verification policies", "验证与政策")}>
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "Methodology", "方法论")}</Link>
          <Link href={localePath(locale, "/sources")}>{tr(locale, "Sources", "来源政策")}</Link>
          <Link href={localePath(locale, "/ai-usage")}>{tr(locale, "AI usage", "AI 使用说明")}</Link>
          <Link href={localePath(locale, "/corrections")}>{tr(locale, "Corrections", "更正机制")}</Link>
        </nav>
      </section>

      {assets.length > 0 && (
        <div className="home-asset-line">
          <span>{tr(locale, "Popular coverage", "热门覆盖")}</span>
          <div>{assets.slice(0, 12).map((asset) => <Link key={asset.ticker} href={localePath(locale, assetPath(asset.ticker))}>{domainTerm(asset.name, locale)}</Link>)}</div>
        </div>
      )}
    </main>
  );
}
