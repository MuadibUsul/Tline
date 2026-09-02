import type { MetadataRoute } from "next";
import { PRIVATE_ROUTES, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_ROUTES.map((route) => `${route}/`) }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
