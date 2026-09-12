import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { MACHINE_PATH, middleware } from "./middleware";

test("machine-readable endpoints bypass locale middleware", () => {
  for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap/0.xml", "/sitemap/12.xml", "/llms.txt", "/llms-full.txt", "/rss.xml", "/feed.xml"]) assert.equal(MACHINE_PATH.test(path), true, path);
  assert.equal(MACHINE_PATH.test("/research"), false);
  assert.equal(MACHINE_PATH.test("/sitemaps-of-the-world"), false);
});

test("unprefixed public pages permanently redirect to a canonical locale", () => {
  const response = middleware(new NextRequest("https://tlines.tech/research", { headers: { "accept-language": "en" } }));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://tlines.tech/en/research");
});

test("both explicit language prefixes serve the requested locale", () => {
  for (const segment of ["en", "zh"]) {
    const response = middleware(new NextRequest(`https://tlines.tech/${segment}/research/example`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "https://tlines.tech/research/example");
  }
});
