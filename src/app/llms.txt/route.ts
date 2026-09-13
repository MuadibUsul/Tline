import { siteUrl } from "@/lib/site";

export const revalidate = 3600;

export function GET() {
  const base = siteUrl();
  const body = `# Tlines Institutional Intelligence

> Institutional Research, Consensus & Market Signals. Public institutional research is structured into traceable, searchable market views.

## Public sections
- [English home](${base}/en)
- [中文首页](${base}/zh)
- [Markets](${base}/en/markets)
- [Research](${base}/en/research)
- [Institutions](${base}/en/institutions)
- [Economic data](${base}/en/macro)
- [Market themes](${base}/en/watchlist)
- [Methodology](${base}/en/methodology)
- [Editorial policy](${base}/en/editorial-policy)
- [AI usage](${base}/en/ai-usage)
- [Sources](${base}/en/sources)
- [Corrections](${base}/en/corrections)
- [Financial disclaimer](${base}/en/financial-disclaimer)

## Interpretation
Tlines structures public institutional research; it does not republish private research or claim that automated analysis is the institution's own wording. Each research page identifies the original institution, publication date, source URL, AI-generated analysis, risks and verification path. Financial information is not investment advice.

## Expanded index
- [llms-full.txt](${base}/llms-full.txt)
- [RSS](${base}/rss.xml)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
