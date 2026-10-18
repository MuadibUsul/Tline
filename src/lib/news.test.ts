import assert from "node:assert/strict";
import test from "node:test";
import { buildNewsSlug, newsAgo, newsCadenceLabel, newsDateLabel, newsDayKey, newsExcerpt, newsInlineMarkdownBlocks, newsLocales, newsParagraphRole, newsSources, newsTitle, splitNewsMarkdownBlocks, splitNewsParagraphs, validateNewsInput } from "./news";

const record = (overrides: Partial<Parameters<typeof newsTitle>[0]> = {}) => ({
  id: "p1", slug: "s", kind: "brief", titleZh: null, titleEn: null, bodyZh: null, bodyEn: null,
  sourceUrl: null, status: "published", pinned: false, publishedAt: new Date(), updatedAt: new Date(), ...overrides,
});

test("a slug is readable, transliterated when needed, and stable per id", () => {
  assert.match(buildNewsSlug("Fed holds rates, signals patience", "id-1"), /^fed-holds-rates-signals-patience-[0-9a-f]{6}$/);
  const zh = buildNewsSlug("美联储维持利率不变", "id-1");
  assert.match(zh, /^[a-z0-9-]+-[0-9a-f]{6}$/);
  assert.ok(zh.startsWith("mei-lian-chu"));
  // A Chinese headline carrying a date and numbers must still transliterate its subject;
  // "2026-10-17-315" is not a slug for a story about a drone attack.
  const dated = buildNewsSlug("俄乌战场简报 2026-10-17：俄315架无人机夜袭乌能源设施", "id-2");
  assert.ok(dated.startsWith("e-wu-zhan-chang"), dated);
  assert.ok(!dated.startsWith("2026"), dated);
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

test("the list excerpt hides Markdown syntax", () => {
  const post = record({
    kind: "article",
    bodyZh: "## 【价格】\n\n**CPI 3.4%**，==高于预期==。\n\n| a | b |\n|---|---|\n| 1 | 2 |",
  });
  assert.equal(newsExcerpt(post, "zh-CN"), "【价格】 CPI 3.4%，高于预期。");
});

test("Markdown blocks keep tables and fenced code intact", () => {
  assert.deepEqual(
    splitNewsMarkdownBlocks("第一段。\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nline one\n\nline two\n```"),
    ["第一段。", "| a | b |\n|---|---|\n| 1 | 2 |", "```\nline one\n\nline two\n```"],
  );
});

test("the stream carries flash and brief bodies in place, but not an article body", () => {
  const flash = record({ kind: "flash", bodyZh: "第一段。\n\n第二段。" });
  assert.deepEqual(newsInlineMarkdownBlocks(flash, "zh-CN"), ["第一段。", "第二段。"]);
  const brief = record({ kind: "brief", bodyEn: "First paragraph.\n\nSecond paragraph." });
  assert.deepEqual(newsInlineMarkdownBlocks(brief, "en"), ["First paragraph.", "Second paragraph."]);
  const article = record({ kind: "article", bodyZh: "长文第一段。\n\n长文第二段。" });
  assert.deepEqual(newsInlineMarkdownBlocks(article, "zh-CN"), []);
});

test("short numbered lines are section headings; the opening paragraph is not", () => {
  assert.equal(newsParagraphRole("二、战况"), "heading");
  assert.equal(newsParagraphRole("三、微观"), "heading");
  assert.equal(newsParagraphRole("一、 俄 315 架无人机+15 枚导弹夜袭乌能源设施（沃伦 37 万+断电、哈尔科夫 2 死 12 伤）"), "body");
  assert.equal(newsParagraphRole("普通正文。"), "body");
  // The English edition keeps the same structure, with the numeral in Latin form.
  assert.equal(newsParagraphRole("II. Combat Situation"), "heading");
  assert.equal(newsParagraphRole("IV. Diplomacy and sanctions"), "heading");
  assert.equal(newsParagraphRole("II. Combat Situation."), "body");
  assert.equal(newsParagraphRole("A long body paragraph that happens to begin with I. is not a heading."), "body");
  assert.equal(newsCadenceLabel("daily", "zh-CN"), "每日更新");
  assert.equal(newsCadenceLabel(null, "en"), "Ongoing");
  // The list excerpt must not splice "二、战况" into the prose it follows.
  const post = record({ bodyZh: "一、 一篇足够长的开场段落，说明今天最重要的变化。\n\n二、战况\n\n正文第一段。\n\n正文第二段。" });
  assert.equal(newsExcerpt(post, "zh-CN"), "一、 一篇足够长的开场段落，说明今天最重要的变化。 正文第一段。 正文第二段。");
});

test("the front-page rail counts minutes, then hours, then falls back to the date", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  assert.equal(newsAgo(ago(0), "zh-CN", now), "刚刚");
  assert.equal(newsAgo(ago(5), "zh-CN", now), "5 分钟前");
  assert.equal(newsAgo(ago(5), "en", now), "5 min ago");
  assert.equal(newsAgo(ago(3 * 60), "zh-CN", now), "3 小时前");
  assert.equal(newsAgo(ago(2 * 24 * 60), "en", now), newsDateLabel(ago(2 * 24 * 60), "en"));
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

test("a brief may cite several sources, and the same URL may recur across editions", () => {
  const codes = (input: Parameters<typeof validateNewsInput>[0]) => validateNewsInput(input).map((issue) => issue.code);
  assert.deepEqual(codes({ titleZh: "每日简报", sources: ["https://deepstatemap.live", "https://www.reuters.com"] }), []);
  assert.ok(codes({ titleZh: "每日简报", sources: ["http://example.com"] }).includes("sources.not_https"));
  assert.ok(codes({ titleZh: "每日简报", sources: ["nope"] }).includes("sources.invalid"));
  assert.ok(codes({ titleZh: "每日简报", sources: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`) }).includes("sources.too_many"));
  // Primary first, duplicates removed.
  assert.deepEqual(newsSources({ sourceUrl: "https://a.example", sources: [{ url: "https://a.example" }, { url: "https://b.example" }] }), ["https://a.example", "https://b.example"]);
});
