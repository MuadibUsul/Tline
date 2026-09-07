import type { MetadataRoute } from "next";
import { CRAWLER_DISALLOW, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const disallow = CRAWLER_DISALLOW.flatMap((route) => [route, `${route}/`]);
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot"].map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow,
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
