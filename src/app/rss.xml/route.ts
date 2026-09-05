import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";
import { contentQuality } from "@/lib/contentQuality";

export const dynamic = "force-dynamic";
const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export async function GET() {
  const base = siteUrl();
  const articles = await prisma.article.findMany({ where: publicationReadyWhere(), orderBy: { publishedAt: "desc" }, take: 100, include: { institution: true, analysis: true, translations: { where: { locale: "zh-CN" }, take: 1 } } });
  const items = articles.filter((article) => contentQuality(article, "en").indexable).slice(0, 50).map((article) => `<item><title>${xml(article.title)}</title><link>${base}/en/research/${article.id}</link><guid isPermaLink="true">${base}/en/research/${article.id}</guid><pubDate>${article.publishedAt.toUTCString()}</pubDate><dc:creator>${xml(article.institution.name)}</dc:creator><description>${xml(article.analysis!.summary)}</description><source url="${xml(article.sourceUrl)}">${xml(article.institution.name)}</source></item>`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Tlines Institutional Intelligence</title><link>${base}/en</link><description>Verified public institutional research transformed into traceable signals.</description><language>en</language>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
