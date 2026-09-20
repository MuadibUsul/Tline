import assert from "node:assert/strict";
import test from "node:test";
import { can, effectiveRole } from "./permissions";

/** The allowlist is process-wide state; every case that touches it must put it back. */
function withOwners<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.ADMIN_EMAILS;
  if (value === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
}

test("core article and PDF access stays available before the tier matrix is defined", () => {
  assert.equal(can(null, "article.read.original"), true);
  assert.equal(can(null, "document.download.original"), true);
});

test("stateful user features still require a session", () => {
  assert.equal(can(null, "watchlist.manage"), false);
  assert.equal(can({ id: "u1", tier: "free" }, "watchlist.manage"), true);
  assert.equal(can({ id: "u1", tier: "free" }, "api.use"), false);
  assert.equal(can({ id: "u2", tier: "professional" }, "api.use"), true);
  assert.equal(can({ id: "u1", tier: "free" }, "dashboards.manage"), false);
  assert.equal(can({ id: "u2", tier: "professional" }, "dashboards.manage"), true);
  assert.equal(can({ id: "u3", tier: "enterprise" }, "dashboards.manage"), true);
});

test("a member never reaches the console", () => {
  withOwners("", () => {
    const member = { id: "u1", email: "member@example.com", tier: "professional", role: "member" };
    for (const action of ["admin.access", "admin.review", "admin.sources", "admin.users", "admin.api", "admin.audit", "admin.analytics"] as const) {
      assert.equal(can(member, action), false, action);
    }
  });
});

test("a reviewer gets editorial review and read-only analytics, nothing that changes access", () => {
  withOwners("", () => {
    const reviewer = { id: "u1", email: "reviewer@example.com", tier: "free", role: "reviewer" };
    assert.equal(can(reviewer, "admin.access"), true);
    assert.equal(can(reviewer, "admin.review"), true);
    assert.equal(can(reviewer, "admin.analytics"), true);
    assert.equal(can(reviewer, "admin.users"), false);
    assert.equal(can(reviewer, "admin.sources"), false);
    assert.equal(can(reviewer, "admin.api"), false);
    assert.equal(can(reviewer, "admin.audit"), false);
  });
});

test("the stored role now grants console access without an env change", () => {
  withOwners("owner@example.com", () => {
    const admin = { id: "u1", email: "other@example.com", tier: "free", role: "admin" };
    assert.equal(can(admin, "admin.users"), true);
    assert.equal(can(admin, "admin.api"), true);
  });
});

test("the owner allowlist outranks the stored role, so the last admin cannot be locked out", () => {
  withOwners("owner@example.com", () => {
    const owner = { id: "u2", email: "OWNER@example.com", tier: "free", role: "member" };
    assert.equal(effectiveRole(owner), "admin");
    assert.equal(can(owner, "admin.users"), true);
  });
});

test("an unrecognised role is read as the least privileged one", () => {
  withOwners("", () => {
    assert.equal(effectiveRole({ id: "u1", tier: "free", role: "superuser" }), "member");
    assert.equal(can({ id: "u1", tier: "free", role: "superuser" }, "admin.access"), false);
  });
});
