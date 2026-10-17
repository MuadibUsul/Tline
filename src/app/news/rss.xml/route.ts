import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { getLocale, localePath } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

/** The newsroom feed: every published item, newest first, in the edition requested. */
export async function GET() {
  const base = siteUrl();
  const locale = await getLocale();
  const zh = locale === "zh-CN";
  const posts = await prisma.newsPost.findMany({
    where: { status: "published", publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: {
      slug: true, kind: true, titleZh: true, titleEn: true, bodyZh: true, bodyEn: true,
      sourceUrl: true, publishedAt: true,
      column: { select: { slug: true, nameZh: true, nameEn: true } },
    },
  });
  const items = posts.map((post) => {
    const title = (zh ? post.titleZh ?? post.titleEn : post.titleEn ?? post.titleZh) ?? "";
    const body = (zh ? post.bodyZh ?? post.bodyEn : post.bodyEn ?? post.bodyZh) ?? "";
    const url = `${base}${localePath(locale, `/news/${post.slug}`)}`;
    const description = body.replace(/\s+/g, " ").trim().slice(0, 300);
    const column = post.column ? (zh ? post.column.nameZh : post.column.nameEn ?? post.column.nameZh) : "";
    return `<item><title>${xml(title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${(post.publishedAt ?? new Date()).toUTCString()}</pubDate><category>${xml(post.kind)}</category>${column ? `<category>${xml(column)}</category>` : ""}${post.sourceUrl ? `<source url="${xml(post.sourceUrl)}">source</source>` : ""}<description>${xml(description || title)}</description></item>`;
  }).join("");
  const channelTitle = zh ? "Tlines 新鲜事 · 新闻编辑部" : "Tlines Newsroom";
  const channelDescription = zh
    ? "来自 Tlines 新闻编辑部的原创快讯、短讯与文章。"
    : "Original flashes, briefs and articles from the Tlines newsroom.";
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(channelTitle)}</title><link>${base}${localePath(locale, "/news")}</link><description>${xml(channelDescription)}</description><language>${locale}</language><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${base}${localePath(locale, "/news/rss.xml")}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
