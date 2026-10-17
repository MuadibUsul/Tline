import assert from "node:assert/strict";
import test from "node:test";
import { entitlementRefusal } from "./auth";
import { API_SCOPES, MCP_SCOPES, PUBLISHER_SCOPES, parseScopes } from "../apiKeys";

const owner = (overrides: Record<string, unknown> = {}) => ({ id: "u1", email: "a@b.c", tier: "free", role: "member", suspendedAt: null, ...overrides });

test("a key with no bound account is refused on both MCP servers", () => {
  assert.equal(entitlementRefusal(null, "user")?.code, "unbound_key");
  assert.equal(entitlementRefusal(null, "publisher")?.code, "unbound_key");
});

test("a suspended account loses its MCP keys immediately", () => {
  assert.equal(entitlementRefusal(owner({ tier: "professional", suspendedAt: new Date() }), "user")?.code, "account_suspended");
  assert.equal(entitlementRefusal(owner({ role: "admin", suspendedAt: new Date() }), "publisher")?.code, "account_suspended");
});

test("the User MCP follows the permission matrix: paid entitlement or operations role", () => {
  assert.equal(entitlementRefusal(owner({ tier: "free" }), "user")?.code, "plan_required");
  assert.equal(entitlementRefusal(owner({ tier: "professional" }), "user"), null);
  // Founding holds the highest entitlement: every commercial gate clears for them, including one added later.
  assert.equal(entitlementRefusal(owner({ tier: "founding" }), "user"), null);
  // Reviewer and admin are admitted through the operations door, not the commercial one.
  assert.equal(entitlementRefusal(owner({ role: "reviewer" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ role: "admin" }), "user"), null);
  // Enterprise is a dashboard tier, not an API entitlement — same rule the site applies.
  assert.equal(entitlementRefusal(owner({ tier: "enterprise" }), "user")?.code, "plan_required");
});

test("the Publisher MCP requires the editorial role itself", () => {
  assert.equal(entitlementRefusal(owner({ tier: "professional" }), "publisher")?.code, "role_required");
  assert.equal(entitlementRefusal(owner({ role: "member" }), "publisher")?.code, "role_required");
  assert.equal(entitlementRefusal(owner({ role: "reviewer" }), "publisher"), null);
  assert.equal(entitlementRefusal(owner({ role: "admin" }), "publisher"), null);
});

test("the MCP scopes exist, stay listed, and parse off a stored key", () => {
  assert.ok(API_SCOPES.includes("mcp:user"));
  assert.ok(API_SCOPES.includes("publisher:draft"));
  assert.ok(API_SCOPES.includes("publisher:publish"));
  assert.ok(API_SCOPES.includes("admin:manage"));
  assert.deepEqual(MCP_SCOPES, ["mcp:user", "publisher:draft", "publisher:publish", "admin:manage"]);
  // The two publisher scopes may share one key; the user scope may share with neither.
  assert.deepEqual(PUBLISHER_SCOPES, ["publisher:draft", "publisher:publish"]);
  assert.deepEqual(parseScopes(JSON.stringify(["mcp:user"])), ["mcp:user"]);
  assert.deepEqual(parseScopes(JSON.stringify(["publisher:draft", "publisher:publish"])), ["publisher:draft", "publisher:publish"]);
  assert.deepEqual(parseScopes(JSON.stringify(["publisher:draft", "admin:manage"])), ["publisher:draft", "admin:manage"]);
  // An unknown scope in a stored row is dropped, not fatal.
  assert.deepEqual(parseScopes(JSON.stringify(["mcp:user", "mcp:admin"])), ["mcp:user"]);
});
