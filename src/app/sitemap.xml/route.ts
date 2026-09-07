import { siteUrl } from "@/lib/site";
import {
  SITEMAP_CACHE_CONTROL,
  renderSitemapIndex,
  researchShardLastModified,
  buildPagesShard,
} from "@/lib/sitemap";

// Rendered per request like every other route: the production image is built without a
// database, so prerendering this at build time cannot reach Prisma. The cache header, not
// the build, is what keeps a crawler from recomputing it on every fetch.
export const dynamic = "force-dynamic";

/**
 * The index. Shard 0 is the site's own pages, 1..N the research corpus.
 *
 * This replaced a single map with a hard `take: 5000` on it. That cap was a silent one:
 * past it the oldest articles simply stopped being advertised, and with /research reachable
 * only by clicking Next, being dropped from the map left them with no route in at all.
 */
export async function GET() {
  const base = siteUrl();
  const [pages, researchLastModified] = await Promise.all([
    buildPagesShard(),
    researchShardLastModified(),
  ]);
  const pagesLastModified = pages.reduce(
    (latest, page) => (page.lastModified > latest ? page.lastModified : latest),
    new Date(0),
  );
  const shards = [
    { url: `${base}/sitemap/0.xml`, lastModified: pagesLastModified },
    // An empty corpus still gets one research shard, so the index is never a bare document.
    ...(researchLastModified.length ? researchLastModified : [new Date(0)]).map((lastModified, index) => ({
      url: `${base}/sitemap/${index + 1}.xml`,
      lastModified,
    })),
  ];
  return new Response(renderSitemapIndex(shards), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": SITEMAP_CACHE_CONTROL },
  });
}
