import { siteUrl } from "@/lib/site";

export const revalidate = 3600;

export function GET() {
  const base = siteUrl();
  const body = `# Tlines Institutional Intelligence\n\n> Public institutional-research intelligence: comparable, traceable and searchable market views, consensus and signals.\n\n## Public sections\n- [English home](${base}/en)\n- [中文首页](${base}/zh)\n- [Research](${base}/en/research)\n- [Institutions](${base}/en/institutions)\n- [Assets and markets](${base}/en/markets)\n- [Consensus](${base}/en/consensus)\n- [Methodology](${base}/en/methodology)\n- [Editorial policy](${base}/en/editorial-policy)\n- [AI usage](${base}/en/ai-usage)\n- [Sources](${base}/en/sources)\n- [Corrections](${base}/en/corrections)\n\n## Interpretation\nTlines structures public institutional research; it does not republish private research or claim that automated analysis is the institution's own wording. Each research page identifies the original institution, publication date, source URL, AI-generated analysis, risks and verification path. Financial information is not investment advice.\n\n## Expanded index\n- [llms-full.txt](${base}/llms-full.txt)\n- [RSS](${base}/rss.xml)\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
