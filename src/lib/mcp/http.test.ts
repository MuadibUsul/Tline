import assert from "node:assert/strict";
import test from "node:test";
import { mcpRoute } from "./http";
import { createUserServer } from "./userServer";

/**
 * The HTTP boundary of the MCP endpoints, exercised with plain Web Requests: the
 * refusals a crawler or a misconfigured host hits before any tool exists, and the
 * hardening headers that must be on every answer including the refusals. Cases that
 * would need a database (a well-formed but unknown key) are covered by the auth tests
 * at the entitlement level instead.
 */

const handler = mcpRoute("user", () => createUserServer());

test("no token is a 401 with a challenge and the hardening headers", async () => {
  const response = await handler(new Request("https://tlines.tech/api/mcp/user", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /tline-user-mcp/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { jsonrpc: string; error: { code: number; message: string } };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32001);
});

test("a malformed bearer token is a 401, not a tool error", async () => {
  const response = await handler(new Request("https://tlines.tech/api/mcp/user", { method: "POST", headers: { authorization: "Bearer not-a-tline-key" }, body: "{}" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="tline-user-mcp"');
});

test("GET is answered 405 with the MCP-shaped body: the server is stateless", async () => {
  const response = await handler(new Request("https://tlines.tech/api/mcp/user", { method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  const body = await response.json() as { error: { code: number } };
  assert.equal(body.error.code, -32000);
});

test("the publisher endpoint challenges with its own realm", async () => {
  const publisher = mcpRoute("publisher", () => createUserServer());
  const response = await publisher(new Request("https://tlines.tech/api/mcp/publisher", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="tline-publisher-mcp"');
});
