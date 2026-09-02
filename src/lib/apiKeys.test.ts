import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_PREFIX,
  bearerToken,
  consumeRate,
  generateToken,
  hashToken,
  parseScopes,
  resetRateLimits,
  tokenPrefix,
} from "./apiKeys";

test("a generated token is prefixed and carries full entropy", () => {
  const token = generateToken();
  assert.ok(token.startsWith(`${API_KEY_PREFIX}_`));
  // 32 random bytes in base64url; anything shorter would mean the source was truncated.
  assert.ok(token.length - API_KEY_PREFIX.length - 1 >= 43);
  assert.notEqual(token, generateToken());
});

test("the stored prefix cannot authenticate on its own", () => {
  const token = generateToken();
  assert.ok(token.startsWith(tokenPrefix(token)));
  assert.ok(tokenPrefix(token).length < token.length);
});

test("the digest is stable and does not reveal the token", () => {
  const token = generateToken();
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(generateToken()));
  assert.ok(!hashToken(token).includes(token.slice(4)));
});

test("only recognised scopes survive parsing", () => {
  assert.deepEqual(parseScopes('["research:read","admin:everything"]'), ["research:read"]);
  assert.deepEqual(parseScopes("not json"), []);
  assert.deepEqual(parseScopes('{"scope":"research:read"}'), []);
});

test("a bearer header is read, and anything else is refused", () => {
  assert.equal(bearerToken("Bearer tli_abc"), "tli_abc");
  assert.equal(bearerToken("bearer   tli_abc  "), "tli_abc");
  assert.equal(bearerToken("Basic tli_abc"), null);
  assert.equal(bearerToken(null), null);
});

test("the rate limit allows exactly the configured budget, then refuses", () => {
  resetRateLimits();
  const results = Array.from({ length: 4 }, () => consumeRate("key", 3));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.equal(results[2].remaining, 0);
});

test("the budget is restored once the window has passed", () => {
  resetRateLimits();
  const start = 1_000_000;
  assert.equal(consumeRate("key", 1, start).allowed, true);
  assert.equal(consumeRate("key", 1, start + 59_000).allowed, false);
  assert.equal(consumeRate("key", 1, start + 61_000).allowed, true);
});

test("one key's usage does not consume another's budget", () => {
  resetRateLimits();
  assert.equal(consumeRate("a", 1).allowed, true);
  assert.equal(consumeRate("b", 1).allowed, true);
  assert.equal(consumeRate("a", 1).allowed, false);
});
