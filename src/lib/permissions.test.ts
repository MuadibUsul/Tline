import assert from "node:assert/strict";
import test from "node:test";
import { can } from "./permissions";

test("core article and PDF access stays available before the tier matrix is defined", () => {
  assert.equal(can(null, "article.read.original"), true);
  assert.equal(can(null, "document.download.original"), true);
  assert.equal(can(null, "document.download.translation"), true);
});

test("stateful user features still require a session", () => {
  assert.equal(can(null, "watchlist.manage"), false);
  assert.equal(can({ id: "u1", tier: "free" }, "watchlist.manage"), true);
  assert.equal(can({ id: "u1", tier: "free" }, "api.use"), false);
  assert.equal(can({ id: "u2", tier: "professional" }, "api.use"), true);
});

test("review roles are independent from commercial tiers", () => {
  assert.equal(can({ id: "u1", tier: "professional", role: "member" }, "admin.review"), false);
  assert.equal(can({ id: "u2", tier: "free", role: "reviewer" }, "admin.review"), true);
  assert.equal(can({ id: "u3", tier: "free", role: "admin" }, "admin.review"), true);
});
