import assert from "node:assert/strict";
import test from "node:test";
import { robotsAllows, robotsCrawlDelay, robotsSitemaps } from "./robots";

const ROBOTS = `
User-agent: *
Disallow: /private/
Allow: /private/public-report
Crawl-delay: 5
Sitemap: https://example.com/sitemap.xml
`;

test("robots applies longest-match allow rules and crawl delay", () => {
  assert.equal(robotsAllows(ROBOTS, "InstitutionalIntelligenceBot", "/private/client"), false);
  assert.equal(robotsAllows(ROBOTS, "InstitutionalIntelligenceBot", "/private/public-report"), true);
  assert.equal(robotsCrawlDelay(ROBOTS, "InstitutionalIntelligenceBot"), 5);
});

test("robots exposes declared sitemap URLs", () => {
  assert.deepEqual(robotsSitemaps(ROBOTS), ["https://example.com/sitemap.xml"]);
});
