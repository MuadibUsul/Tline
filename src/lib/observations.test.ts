import assert from "node:assert/strict";
import test from "node:test";
import { selectDiverseObservations } from "./observations";

const row = (id: string, institutionId: string, viewZh: string) => ({ id, institutionId, viewEn: viewZh, viewZh });

test("one row per institution, newest first, skipping repeats", () => {
  const rows = [
    row("a1", "scotia", "我们预计加拿大央行将在10月降息25个基点，加元短线承压。"),
    row("a2", "scotia", "全国销售与新增挂牌量比率从8月的49.1%小幅回落到9月的48.8%。"),
    row("b1", "ing", "我们维持对黄金的看多观点，年底目标价3,400美元。"),
    row("c1", "ubs", "美股盈利预期仍有上修空间，维持超配。"),
  ];
  const picked = selectDiverseObservations(rows, { take: 5, zh: true });
  assert.deepEqual(picked.map((item) => item.id), ["a1", "b1", "c1"]);
  // The same house's second view never appears.
  assert.ok(!picked.some((item) => item.id === "a2"));
});

test("fragments do not occupy a slot", () => {
  const rows = [
    row("junk", "scotia", "Johns）63.2 10.0 3.0 1.1 卖家 9.1 5.1 3.7 7.0 -8.1 1.7"),
    row("good", "ing", "我们维持对黄金的看多观点，年底目标价3,400美元。"),
  ];
  const picked = selectDiverseObservations(rows, { take: 5, zh: true });
  assert.deepEqual(picked.map((item) => item.id), ["good"]);
});

test("takes at most the requested number of houses", () => {
  const rows = Array.from({ length: 8 }, (_, index) => row(`v${index}`, `inst-${index}`, "我们维持该资产的看多观点，并上调目标价。"));
  assert.equal(selectDiverseObservations(rows, { take: 5, zh: true }).length, 5);
});

test("a prolific house cannot occupy the whole window", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => row(`a${index}`, "prolific", "我们维持该资产的看多观点，并上调目标价。")),
    ...["b", "c", "d", "e", "f"].map((id) => row(id, id, "我们预计该资产在未来十二个月仍有上行空间。")),
  ];
  const picked = selectDiverseObservations(rows, { take: 5, zh: true });
  assert.equal(picked.length, 5);
  assert.equal(new Set(picked.map((item) => item.institutionId)).size, 5);
  assert.equal(picked[0].institutionId, "prolific");
});

test("a Chinese page never falls back to an English-only view", () => {
  const rows = [
    { id: "a", institutionId: "a", viewEn: "The deal is expected to close in 2028.", viewZh: "" },
    { id: "b", institutionId: "b", viewEn: "English only", viewZh: "我们维持对黄金的看多观点，年底目标价3,400美元。" },
  ];
  const picked = selectDiverseObservations(rows, { take: 5, zh: true });
  assert.deepEqual(picked.map((item) => item.id), ["b"]);
});

test("an English page never falls back to a Chinese-only view", () => {
  const rows = [
    { id: "a", institutionId: "a", viewEn: "", viewZh: "我们维持对黄金的看多观点，年底目标价3,400美元。" },
    { id: "b", institutionId: "b", viewEn: "We stay overweight equities into year-end.", viewZh: "" },
  ];
  assert.deepEqual(selectDiverseObservations(rows, { take: 5, zh: false }).map((item) => item.id), ["b"]);
});

test("an English page judges the English text", () => {
  const rows = [{ id: "x", institutionId: "i1", viewEn: "Table 1 62.3 10.0 3.0 1.1 9.1 5.1", viewZh: "我们维持对黄金的看多观点，年底目标价3,400美元。" }];
  assert.equal(selectDiverseObservations(rows, { take: 5, zh: false }).length, 0);
  assert.equal(selectDiverseObservations(rows, { take: 5, zh: true }).length, 1);
});
