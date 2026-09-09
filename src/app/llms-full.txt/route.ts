import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = siteUrl();
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere(),
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 500,
    select: {
      id: true, title: true, sourceUrl: true, publishedAt: true,
      institution: { select: { name: true } },
      analysis: { select: { summary: true } },
    },
  });
  const entries = articles.map((article) => `## ${article.title}\n- Institution: ${article.institution.name}\n- Published: ${article.publishedAt.toISOString()}\n- Tlines page: ${base}/en/research/${article.id}\n- Original source: ${article.sourceUrl}\n- Structured conclusion: ${article.analysis?.summary ?? "Not available"}\n- Context: automated Tlines analysis of the cited public report; verify material decisions at the original source.`);
  const body = `# Tlines public research index\n\nGenerated from public research pages only. Private accounts, monitoring, admin and API-key content are excluded.\n\n${entries.join("\n\n") || "No public research is currently available."}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
