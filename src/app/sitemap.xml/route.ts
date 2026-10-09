import {
  SITEMAP_CACHE_CONTROL,
  buildSitemapIndex,
  renderSitemapIndex,
} from "@/lib/sitemap";

// Rendered per request like every other route: the production image is built without a
// database, so prerendering this at build time cannot reach Prisma. The cache header, not
// the build, is what keeps a crawler from recomputing it on every fetch.
export const dynamic = "force-dynamic";

/**
 * The index is split by page type and language. Building it performs only two indexed count
 * queries; it does not scan the corpus merely to compute optional index-level lastmod values.
 */
export async function GET() {
  const shards = await buildSitemapIndex();
  return new Response(renderSitemapIndex(shards), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": SITEMAP_CACHE_CONTROL },
  });
}
