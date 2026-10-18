import assert from "node:assert/strict";
import test from "node:test";
import { isOperatorAccount } from "./operator";

test("console-access staff are not counted as readers", () => {
  const previous = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = "owner@example.com";
    assert.equal(isOperatorAccount({ id: "1", tier: "free", role: "admin", email: "admin@example.com" }), true);
    assert.equal(isOperatorAccount({ id: "2", tier: "free", role: "reviewer", email: "reviewer@example.com" }), true);
    assert.equal(isOperatorAccount({ id: "3", tier: "free", role: "member", email: "owner@example.com" }), true);
    assert.equal(isOperatorAccount({ id: "4", tier: "free", role: "member", email: "reader@example.com" }), false);
    assert.equal(isOperatorAccount(null), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});
