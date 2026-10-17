import {
  SITEMAP_CACHE_CONTROL,
  buildSitemap,
  newsShardCount,
  parseSitemapShard,
  renderUrlset,
  researchShardCount,
  sitemapPath,
} from "@/lib/sitemap";
import { siteUrl } from "@/lib/site";

// See /sitemap.xml: the production image is built without a database, so these cannot be
// prerendered. Caching happens at the edge instead.
export const dynamic = "force-dynamic";

/** Named maps are canonical; old numeric map URLs retain a single permanent hop. */
export async function GET(request: Request, context: { params: Promise<{ shard: string }> }) {
  const { shard } = await context.params;
  const legacy = /^(\d+)\.xml$/.exec(shard);
  if (legacy) {
    const index = Number(legacy[1]);
    const replacement = index === 0
      ? { kind: "pages" as const, locale: "en" as const, index: 1 }
      : { kind: "research" as const, locale: "en" as const, index };
    // The base is the configured site origin, not `request.url`: behind the reverse proxy the
    // request address is the internal listener, and the redirect once handed Googlebot
    // `https://localhost:3000/sitemap/pages-en.xml` — a location that resolves nowhere. Every
    // other absolute URL this site emits goes through siteUrl(); this one now does too.
    return Response.redirect(new URL(sitemapPath(replacement), siteUrl()), 308);
  }

  const sitemap = parseSitemapShard(shard);
  if (!sitemap) return new Response("Not Found", { status: 404 });
  if (sitemap.kind === "research" && sitemap.index > await researchShardCount(sitemap.locale)) return new Response("Not Found", { status: 404 });
  if (sitemap.kind === "news" && sitemap.index > await newsShardCount(sitemap.locale)) return new Response("Not Found", { status: 404 });

  const entries = await buildSitemap(sitemap);
  return new Response(renderUrlset(entries), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": SITEMAP_CACHE_CONTROL },
  });
}
