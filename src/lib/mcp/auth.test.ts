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

test("the User MCP is open to every registered account, not a tier", () => {
  // Registration is the gate (owner decision 2026-10-17): a free member may issue a
  // read-only MCP key from /mcp. Paid tiers and operations roles are not required.
  assert.equal(entitlementRefusal(owner({ tier: "free" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ tier: "professional" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ tier: "founding" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ tier: "enterprise" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ role: "reviewer" }), "user"), null);
  assert.equal(entitlementRefusal(owner({ role: "admin" }), "user"), null);
  // Suspension and an unbound key still close the door.
  assert.equal(entitlementRefusal(owner({ tier: "free", suspendedAt: new Date() }), "user")?.code, "account_suspended");
  assert.equal(entitlementRefusal(null, "user")?.code, "unbound_key");
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
