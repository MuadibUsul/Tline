import assert from "node:assert/strict";
import test from "node:test";
import { buildNewsSlug, newsDateLabel, newsDayKey, newsLocales, newsTitle, splitNewsParagraphs, validateNewsInput } from "./news";

const record = (overrides: Partial<Parameters<typeof newsTitle>[0]> = {}) => ({
  id: "p1", slug: "s", kind: "brief", titleZh: null, titleEn: null, bodyZh: null, bodyEn: null,
  sourceUrl: null, status: "published", pinned: false, publishedAt: new Date(), updatedAt: new Date(), ...overrides,
});

test("a slug is readable, transliterated when needed, and stable per id", () => {
  assert.match(buildNewsSlug("Fed holds rates, signals patience", "id-1"), /^fed-holds-rates-signals-patience-[0-9a-f]{6}$/);
  const zh = buildNewsSlug("美联储维持利率不变", "id-1");
  assert.match(zh, /^[a-z0-9-]+-[0-9a-f]{6}$/);
  assert.ok(zh.startsWith("mei-lian-chu"));
  // Same id, same suffix — the address cannot change when the title is edited afterwards.
  assert.equal(buildNewsSlug("美联储维持利率不变", "id-1"), buildNewsSlug("完全不同的标题", "id-1").replace(/^[a-z0-9-]+(?=-[0-9a-f]{6}$)/, zh.replace(/-[0-9a-f]{6}$/, "")));
  assert.notEqual(buildNewsSlug("同样的标题", "id-1").slice(-6), buildNewsSlug("同样的标题", "id-2").slice(-6));
});

test("an item is readable only in the languages it has titles for", () => {
  const zhOnly = record({ titleZh: "美联储维持利率不变" });
  assert.equal(newsTitle(zhOnly, "zh-CN"), "美联储维持利率不变");
  assert.equal(newsTitle(zhOnly, "en"), null);
  assert.deepEqual(newsLocales(zhOnly), ["zh-CN"]);
  const both = record({ titleZh: "美联储维持利率不变", titleEn: "Fed holds rates" });
  assert.deepEqual(newsLocales(both), ["en", "zh-CN"]);
});

test("bodies split on blank lines and drop empty runs", () => {
  assert.deepEqual(splitNewsParagraphs("第一段。\n\n第二段。\n\n\n\n第三段。"), ["第一段。", "第二段。", "第三段。"]);
  assert.deepEqual(splitNewsParagraphs(null), []);
});

test("the desk calendar is Beijing time, not UTC", () => {
  // 17:30 UTC is already 01:30 the next morning at the desk; grouping by the UTC date
  // would file the item under the previous day while the clock beside it reads 01:30.
  const at = new Date("2026-10-16T17:30:00.000Z");
  assert.equal(newsDayKey(at), "2026-10-17");
  assert.match(newsDateLabel(at, "zh-CN"), /2026.*10.*17/);
});

test("validation: at least one title, matching bodies, https sources", () => {
  const codes = (input: Parameters<typeof validateNewsInput>[0]) => validateNewsInput(input).map((issue) => issue.code);
  assert.deepEqual(codes({ titleZh: "美联储维持利率不变" }), []);
  assert.deepEqual(codes({ kind: "flash", titleZh: "快讯：金价突破3400美元" }), []);
  assert.ok(codes({}).includes("title.required"));
  assert.ok(codes({ titleZh: "美联储维持利率不变", bodyEn: "Body without an English title." }).includes("body.en_without_title"));
  assert.ok(codes({ titleZh: "美联储维持利率不变", sourceUrl: "http://example.com" }).includes("sourceUrl.not_https"));
  assert.ok(codes({ titleZh: "美联储维持利率不变", sourceUrl: "nope" }).includes("sourceUrl.invalid"));
  assert.ok(codes({ kind: "post", titleZh: "美联储维持利率不变" }).includes("kind.invalid"));
  assert.ok(codes({ titleZh: "美" }).includes("title.zh_short"));
});
