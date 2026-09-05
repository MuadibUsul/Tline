import assert from "node:assert/strict";
import test from "node:test";
import robots from "./robots";

process.env.SITE_URL = "https://tlines.tech";

test("robots uses production identity and explicit search/AI crawler policies", () => {
  const result = robots();
  assert.equal(result.host, "https://tlines.tech");
  assert.equal(result.sitemap, "https://tlines.tech/sitemap.xml");
  const agents = (Array.isArray(result.rules) ? result.rules : [result.rules]).flatMap((rule) => Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]);
  for (const agent of ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot"]) assert.ok(agents.includes(agent));
});
