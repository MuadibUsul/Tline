import assert from "node:assert/strict";
import test from "node:test";
import { articleBlocks } from "./articleText";

test("paragraphs separated by blank lines become separate blocks", () => {
  const blocks = articleBlocks("First paragraph.\n\nSecond paragraph.");
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "First paragraph." },
    { kind: "paragraph", text: "Second paragraph." },
  ]);
});

test("consecutive bullets collapse into one list", () => {
  const blocks = articleBlocks("Lead in.\n\n• First point\n\n• Second point\n\nAfter the list.");
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "Lead in." },
    { kind: "list", items: ["First point", "Second point"] },
    { kind: "paragraph", text: "After the list." },
  ]);
});

test("the markers publishers actually use are all recognised", () => {
  for (const marker of ["•", "·", "▪", "-", "–", "*"]) {
    const [block] = articleBlocks(`${marker} A point`);
    assert.deepEqual(block, { kind: "list", items: ["A point"] }, `${marker} should start a list`);
  }
});

test("a hyphenated word is not mistaken for a bullet", () => {
  // The marker needs the space after it; "risk-on" and a negative number are prose.
  assert.deepEqual(articleBlocks("risk-on sentiment returned"), [{ kind: "paragraph", text: "risk-on sentiment returned" }]);
  assert.deepEqual(articleBlocks("-0.7% in June"), [{ kind: "paragraph", text: "-0.7% in June" }]);
});

test("a list interrupted by prose starts again afterwards", () => {
  const blocks = articleBlocks("• One\n\nProse.\n\n• Two");
  assert.deepEqual(blocks.map((block) => block.kind), ["list", "paragraph", "list"]);
});

test("blank and whitespace-only lines are dropped", () => {
  assert.deepEqual(articleBlocks("\n\n   \n\nOnly this.\n\n  "), [{ kind: "paragraph", text: "Only this." }]);
});
