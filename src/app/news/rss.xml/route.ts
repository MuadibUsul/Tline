import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { localePath } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

/** The newsroom feed: every published item, newest first, in the language it has. */
export async function GET() {
  const base = siteUrl();
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
    const zh = Boolean(post.titleZh);
    const locale = zh ? "zh-CN" : "en";
    const title = (zh ? post.titleZh : post.titleEn) ?? "";
    const body = (zh ? post.bodyZh : post.bodyEn) ?? "";
    const url = `${base}${localePath(locale, `/news/${post.slug}`)}`;
    const description = body.replace(/\s+/g, " ").trim().slice(0, 300);
    const column = post.column ? (zh ? post.column.nameZh : post.column.nameEn ?? post.column.nameZh) : "";
    return `<item><title>${xml(title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${(post.publishedAt ?? new Date()).toUTCString()}</pubDate><category>${xml(post.kind)}</category>${column ? `<category>${xml(column)}</category>` : ""}${post.sourceUrl ? `<source url="${xml(post.sourceUrl)}">source</source>` : ""}<description>${xml(description || title)}</description></item>`;
  }).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Tlines 新鲜事 · Newsroom</title><link>${base}/zh/news</link><description>Original briefs, flashes and articles from the Tlines newsroom.</description><language>zh-CN</language><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${base}/news/rss.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
