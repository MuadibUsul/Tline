import assert from "node:assert/strict";
import test from "node:test";
import { can } from "./permissions";
import { FOUNDING_MEMBERSHIP_LIMIT, nextFoundingSeat } from "./membership";

test("seats are handed out in order and the hundredth is the last one", () => {
  assert.equal(nextFoundingSeat([]), 1);
  assert.equal(nextFoundingSeat([1, 2, 3]), 4);
  // A gap left by a deleted account is offered again rather than wasting the seat.
  assert.equal(nextFoundingSeat([1, 3]), 2);
  const hundred = Array.from({ length: FOUNDING_MEMBERSHIP_LIMIT }, (_, index) => index + 1);
  assert.equal(nextFoundingSeat(hundred), null);
  // Seats beyond the limit are not seats: they neither fill the house nor block a free one.
  assert.equal(nextFoundingSeat([...hundred, 101, 250]), null);
  assert.equal(nextFoundingSeat([101, 102]), 1);
});

test("the limit is a hundred unless the deployment says otherwise", () => {
  assert.equal(FOUNDING_MEMBERSHIP_LIMIT, 100);
  assert.equal(nextFoundingSeat([1, 2], 3), 3);
});

test("founding membership clears every commercial gate", () => {
  const founding = { id: "u1", tier: "founding" };
  const free = { id: "u2", tier: "free" };
  assert.equal(can(founding, "api.use"), true);
  assert.equal(can(founding, "dashboards.manage"), true);
  assert.equal(can(founding, "dashboards.alerts"), true);
  assert.equal(can(free, "api.use"), false);
  assert.equal(can(free, "dashboards.manage"), true);
  assert.equal(can(free, "dashboards.alerts"), false);
  // The content gates are open to everyone today; the membership must not be the reason
  // they close for anyone else.
  for (const action of ["article.read.original", "article.read.translation", "document.download.original"] as const) {
    assert.equal(can(founding, action), true);
    assert.equal(can(null, action), true);
  }
});
