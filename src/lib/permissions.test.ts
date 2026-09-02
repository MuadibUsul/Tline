import assert from "node:assert/strict";
import test from "node:test";
import { can } from "./permissions";

test("core article and PDF access stays available before the tier matrix is defined", () => {
  assert.equal(can(null, "article.read.original"), true);
  assert.equal(can(null, "document.download.original"), true);
});

test("stateful user features still require a session", () => {
  assert.equal(can(null, "watchlist.manage"), false);
  assert.equal(can({ id: "u1", tier: "free" }, "watchlist.manage"), true);
  assert.equal(can({ id: "u1", tier: "free" }, "api.use"), false);
  assert.equal(can({ id: "u2", tier: "professional" }, "api.use"), true);
});

test("operations access is restricted to the owner email allowlist", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "owner@example.com";
  assert.equal(can({ id: "u1", email: "other@example.com", tier: "professional", role: "admin" }, "admin.review"), false);
  assert.equal(can({ id: "u2", email: "owner@example.com", tier: "free", role: "member" }, "admin.review"), true);
  if (previous === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = previous;
});
