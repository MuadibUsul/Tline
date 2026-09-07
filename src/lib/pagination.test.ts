import assert from "node:assert/strict";
import test from "node:test";
import { paginationWindow } from "./pagination";

test("a short listing links every page and skips nothing", () => {
  assert.deepEqual(paginationWindow(1, 5), [1, 2, 3, 4, 5]);
});

test("a single page is just itself", () => {
  assert.deepEqual(paginationWindow(1, 1), [1]);
});

test("the first and last page are always reachable", () => {
  for (const current of [1, 7, 120, 249, 250]) {
    const window = paginationWindow(current, 250);
    assert.ok(window.includes(1), `page 1 missing from ${current}`);
    assert.ok(window.includes(250), `page 250 missing from ${current}`);
    assert.ok(window.includes(current), `current page missing from ${current}`);
  }
});

test("gaps are marked once, never doubled or trailing", () => {
  const window = paginationWindow(120, 250);
  assert.ok(!window.some((page, index) => page === null && window[index + 1] === null));
  assert.notEqual(window.at(0), null);
  assert.notEqual(window.at(-1), null);
});

test("the link count stays bounded as the corpus grows", () => {
  // The point of the anchors is a short path, not a long list: a hundred thousand articles
  // must not put a hundred thousand links on the page.
  for (const pages of [250, 2_500, 25_000]) {
    assert.ok(paginationWindow(1, pages).filter((page) => page !== null).length <= 24, `too many links at ${pages}`);
  }
});

test("any page is a few clicks from the front", () => {
  // Walk from page 1 towards a distant target, always taking the closest offered page.
  const pages = 250;
  for (const target of [37, 118, 199, 244]) {
    let at = 1;
    let clicks = 0;
    while (at !== target) {
      const options = paginationWindow(at, pages).filter((page): page is number => page !== null);
      const next = options.reduce((best, page) => (Math.abs(page - target) < Math.abs(best - target) ? page : best), at);
      assert.notEqual(next, at, `stuck at ${at} heading for ${target}`);
      at = next;
      clicks += 1;
      assert.ok(clicks < 10, `took ${clicks} clicks to reach ${target}`);
    }
    assert.ok(clicks <= 5, `reaching ${target} took ${clicks} clicks`);
  }
});
