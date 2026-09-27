import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";
import { researchPath } from "@/lib/researchPath";

export const dynamic = "force-dynamic";
const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export async function GET() {
  const base = siteUrl();
  // Select, not include. On the root model `include` returns every Article column, so the feed
  // carried fifty complete English bodies — `rawText` and `disclaimerText` — to render five
  // fields per item and throw the rest away. A feed reader polls this on its own schedule.
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere(),
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: {
      slug: true,
      title: true,
      publishedAt: true,
      sourceUrl: true,
      institution: { select: { name: true } },
      analysis: { select: { summary: true } },
    },
  });
  const items = articles.map((article) => { const url = `${base}/en${researchPath(article)}`; return `<item><title>${xml(article.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${article.publishedAt.toUTCString()}</pubDate><dc:creator>${xml(article.institution.name)}</dc:creator><description>${xml(article.analysis?.summary ?? article.title)}</description><source url="${xml(article.sourceUrl)}">${xml(article.institution.name)}</source></item>`; }).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Tlines Institutional Intelligence</title><link>${base}/en</link><description>Verified public institutional research transformed into traceable signals.</description><language>en</language>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
