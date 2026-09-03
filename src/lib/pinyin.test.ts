import assert from "node:assert/strict";
import test from "node:test";
import { hasChinese, looksLikePinyinQuery, pinyinForms, scorePinyin } from "./pinyin";

test("Chinese is detected and other scripts are not", () => {
  assert.equal(hasChinese("黄金"), true);
  assert.equal(hasChinese("美联储FOMC"), true);
  assert.equal(hasChinese("Gold"), false);
  assert.equal(hasChinese(""), false);
});

test("both the full reading and the initials are produced", () => {
  assert.deepEqual(pinyinForms("黄金"), { full: "huangjin", initials: "hj" });
  assert.equal(pinyinForms("黄金四季度展望").full, "huangjinsijiduzhanwang");
  assert.equal(pinyinForms("黄金四季度展望").initials, "hjsjdzw");
});

test("a polyphone is read the way the word is actually said", () => {
  // 行 is "xing" alone but "hang" in 银行; a per-character table would get this wrong.
  assert.equal(pinyinForms("银行").full, "yinhang");
});

test("Latin runs inside Chinese text stay searchable", () => {
  assert.match(pinyinForms("美联储FOMC会议").full, /^meilianchu.*fomc.*huiyi$/);
});

test("text without Chinese produces nothing to match against", () => {
  assert.deepEqual(pinyinForms("Gold outlook"), { full: "", initials: "" });
});

test("only a plain run of letters is treated as possible pinyin", () => {
  assert.equal(looksLikePinyinQuery("huangjin"), true);
  assert.equal(looksLikePinyinQuery("huang jin"), true);
  assert.equal(looksLikePinyinQuery("h"), false);
  assert.equal(looksLikePinyinQuery("2026"), false);
  assert.equal(looksLikePinyinQuery("gold-2026"), false);
});

test("a closer pronunciation match scores higher", () => {
  const gold = pinyinForms("黄金");
  assert.ok(scorePinyin("huangjin", gold) > scorePinyin("huang", gold));
  assert.ok(scorePinyin("huang", gold) > scorePinyin("hj", gold));
  assert.equal(scorePinyin("xyz", gold), 0);
});

test("initials must match from the start, and a single letter never does", () => {
  const outlook = pinyinForms("黄金四季度展望");
  assert.ok(scorePinyin("hjsj", outlook) > 0);
  assert.equal(scorePinyin("sjdzw", outlook), 0, "matching from the middle is a collision, not a hit");
  assert.equal(scorePinyin("h", outlook), 0);
});

test("a short query is not allowed to match anywhere inside a long word", () => {
  // "jin" sits inside "huangjin"; matching it there would surface gold for half the
  // queries anyone types.
  assert.equal(scorePinyin("jin", pinyinForms("黄金")), 0);
});
