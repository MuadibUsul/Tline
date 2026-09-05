import { prisma } from "@/lib/db";
import { contentQuality } from "@/lib/contentQuality";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = siteUrl();
  const articles = await prisma.article.findMany({
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 500,
    select: {
      id: true, title: true, rawText: true, sourceUrl: true, language: true, publishedAt: true,
      institution: { select: { name: true } },
      analysis: { select: { summary: true, summaryZh: true, reviewStatus: true } },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true } },
      documents: { where: { kind: "original_pdf", locale: "en", status: "ready" }, take: 1, select: { id: true } },
    },
  });
  const ready = articles.filter((article) => article.documents.length && contentQuality(article, "en").indexable);
  const entries = ready.map((article) => `## ${article.title}\n- Institution: ${article.institution.name}\n- Published: ${article.publishedAt.toISOString()}\n- Tlines page: ${base}/en/research/${article.id}\n- Original source: ${article.sourceUrl}\n- Structured conclusion: ${article.analysis!.summary}\n- Context: automated Tlines analysis of the cited public report; verify material decisions at the original source.`);
  const body = `# Tlines public research index\n\nGenerated from indexable public pages only. Private accounts, monitoring, admin and API-key content are excluded.\n\n${entries.join("\n\n") || "No research currently passes the public indexing quality gate."}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
