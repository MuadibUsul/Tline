import assert from "node:assert/strict";
import test from "node:test";
import { refuseRoleChange, statusOf, userOrderBy, userWhere } from "./adminUsers";

test("an unrecognised filter value is dropped rather than passed to the database", () => {
  assert.deepEqual(userWhere({ role: "superuser", tier: "platinum", status: "banned" }), {});
});

test("status maps onto the columns that actually record it", () => {
  assert.deepEqual(userWhere({ status: "suspended" }), { suspendedAt: { not: null } });
  assert.deepEqual(userWhere({ status: "active" }), { suspendedAt: null });
  assert.deepEqual(userWhere({ status: "invited" }), { suspendedAt: null, passwordHash: null });
});

test("search covers email and name, and blank input is not a filter", () => {
  assert.deepEqual(userWhere({ q: "  " }), {});
  assert.deepEqual(userWhere({ q: "acme" }), { OR: [{ email: { contains: "acme" } }, { name: { contains: "acme" } }] });
});

test("sorting falls back to newest first for anything it does not know", () => {
  assert.deepEqual(userOrderBy("email"), [{ email: "asc" }]);
  assert.deepEqual(userOrderBy("nonsense"), [{ createdAt: "desc" }]);
  assert.deepEqual(userOrderBy(undefined), [{ createdAt: "desc" }]);
});

test("an account with no password is invited, not active", () => {
  assert.equal(statusOf({ suspendedAt: null, passwordHash: null }), "invited");
  assert.equal(statusOf({ suspendedAt: null, passwordHash: "x" }), "active");
  assert.equal(statusOf({ suspendedAt: new Date(), passwordHash: "x" }), "suspended");
});

test("an operator cannot demote themselves out of the console", () => {
  assert.equal(
    refuseRoleChange({ actorId: "u1", targetId: "u1", nextRole: "member", currentRole: "admin", adminCount: 5 }),
    "self_demotion",
  );
});

test("the last admin cannot be demoted by anyone", () => {
  assert.equal(
    refuseRoleChange({ actorId: "u2", targetId: "u1", nextRole: "reviewer", currentRole: "admin", adminCount: 1 }),
    "last_admin",
  );
  assert.equal(
    refuseRoleChange({ actorId: "u2", targetId: "u1", nextRole: "reviewer", currentRole: "admin", adminCount: 2 }),
    null,
  );
});

test("promotions and no-op changes are always allowed", () => {
  assert.equal(refuseRoleChange({ actorId: "u1", targetId: "u2", nextRole: "admin", currentRole: "member", adminCount: 1 }), null);
  assert.equal(refuseRoleChange({ actorId: "u1", targetId: "u1", nextRole: "admin", currentRole: "admin", adminCount: 1 }), null);
});

test("a role the code does not define is refused before it reaches the database", () => {
  assert.equal(
    refuseRoleChange({ actorId: "u1", targetId: "u2", nextRole: "root", currentRole: "member", adminCount: 3 }),
    "unknown_role",
  );
});
