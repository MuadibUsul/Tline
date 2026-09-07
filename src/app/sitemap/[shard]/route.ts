import {
  SITEMAP_CACHE_CONTROL,
  buildPagesShard,
  buildResearchShard,
  renderUrlset,
  researchShardCount,
} from "@/lib/sitemap";

// See /sitemap.xml: the production image is built without a database, so these cannot be
// prerendered. Caching happens at the edge instead.
export const dynamic = "force-dynamic";

/** `/sitemap/0.xml` is the site's own pages; `/sitemap/1.xml` onwards is research. */
export async function GET(_request: Request, context: { params: Promise<{ shard: string }> }) {
  const { shard } = await context.params;
  const match = /^(\d+)\.xml$/.exec(shard);
  if (!match) return new Response("Not Found", { status: 404 });

  const index = Number(match[1]);
  if (index > 0 && index > (await researchShardCount())) return new Response("Not Found", { status: 404 });

  const entries = index === 0 ? await buildPagesShard() : await buildResearchShard(index);
  return new Response(renderUrlset(entries), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": SITEMAP_CACHE_CONTROL },
  });
}
