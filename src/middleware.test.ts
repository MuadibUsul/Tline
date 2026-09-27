import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { MACHINE_PATH, middleware } from "./middleware";

test("machine-readable endpoints bypass locale middleware", () => {
  for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap/0.xml", "/sitemap/12.xml", "/llms.txt", "/llms-full.txt", "/rss.xml", "/feed.xml"]) assert.equal(MACHINE_PATH.test(path), true, path);
  assert.equal(MACHINE_PATH.test("/research"), false);
  assert.equal(MACHINE_PATH.test("/sitemaps-of-the-world"), false);
});

test("a machine endpoint under a language prefix collapses to its one address", () => {
  // The feed answered at /rss.xml, /en/rss.xml and /zh/rss.xml — three addresses for the same
  // bytes, and the prefixed two were served as pages, under the page cache policy that does not
  // know a feed never changes between requests. A machine endpoint has no language, so the
  // prefixed form redirects to the one address the site advertises.
  const cases: Array<[string, string]> = [
    ["/en/rss.xml", "/rss.xml"],
    ["/zh/rss.xml", "/rss.xml"],
    ["/en/feed.xml", "/feed.xml"],
    ["/en/sitemap.xml", "/sitemap.xml"],
    ["/zh/sitemap/1.xml", "/sitemap/1.xml"],
    ["/en/llms.txt", "/llms.txt"],
    ["/zh/robots.txt", "/robots.txt"],
  ];
  for (const [path, target] of cases) {
    const response = middleware(new NextRequest(`https://tlines.tech${path}`));
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get("location"), `https://tlines.tech${target}`, path);
  }
  // The canonical addresses are untouched: still served, not redirected.
  assert.equal(middleware(new NextRequest("https://tlines.tech/rss.xml")).status, 200);
  assert.equal(middleware(new NextRequest("https://tlines.tech/sitemap.xml")).status, 200);
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

test("viewing a prefixed page persists the language so the switch sticks", () => {
  const zh = middleware(new NextRequest("https://tlines.tech/zh/research"));
  assert.equal(zh.cookies.get("tline_locale")?.value, "zh-CN");
  const en = middleware(new NextRequest("https://tlines.tech/en/research"));
  assert.equal(en.cookies.get("tline_locale")?.value, "en");
  // Already-correct cookie is left alone, so the response stays cacheable.
  const unchanged = middleware(new NextRequest("https://tlines.tech/en/research", { headers: { cookie: "tline_locale=en" } }));
  assert.equal(unchanged.cookies.get("tline_locale"), undefined);
});

test("the persisted language wins the unprefixed redirect over Accept-Language", () => {
  const response = middleware(new NextRequest("https://tlines.tech/research", { headers: { "accept-language": "en", cookie: "tline_locale=zh-CN" } }));
  assert.equal(response.headers.get("location"), "https://tlines.tech/zh/research");
});

test("legacy asset URLs permanently redirect to the readable market canonical", () => {
  const response = middleware(new NextRequest("https://tlines.tech/zh/asset/XAUUSD"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://tlines.tech/zh/markets/gold");
});

test("a retired topic resolves to its replacement in one redirect, not two", () => {
  // Both were live and both were two hops: the middleware added the language, then the route
  // answered a second 308 to the facet that replaced the topic. A crawler working through the
  // addresses the site had before it split by language paid a second fetch for every one.
  const unprefixed = middleware(new NextRequest("https://tlines.tech/topics/us-10y-treasury", { headers: { "accept-language": "en" } }));
  assert.equal(unprefixed.status, 308);
  assert.equal(unprefixed.headers.get("location"), "https://tlines.tech/en/markets/us-10-year-treasury");

  // A language already in the address keeps it, and an asset alias goes straight to the
  // institution that owns the policy rather than through a market page that is not one.
  assert.equal(
    middleware(new NextRequest("https://tlines.tech/zh/topics/fed-policy")).headers.get("location"),
    "https://tlines.tech/zh/institution/federal-reserve",
  );
  assert.equal(
    middleware(new NextRequest("https://tlines.tech/asset/FED", { headers: { "accept-language": "en" } })).headers.get("location"),
    "https://tlines.tech/en/institution/federal-reserve",
  );
});

test("a topic that still stands is served, not redirected", () => {
  const response = middleware(new NextRequest("https://tlines.tech/en/topics/inflation"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-rewrite"), "https://tlines.tech/topics/inflation");
  // The facet resolution must not swallow a topic whose key merely looks like an alias.
  const other = middleware(new NextRequest("https://tlines.tech/en/topics/inflation-targets"));
  assert.equal(other.status, 200);
});
