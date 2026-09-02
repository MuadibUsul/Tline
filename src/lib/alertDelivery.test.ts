import test from "node:test";
import assert from "node:assert/strict";
import { checkWebhookUrl, isPrivateAddress } from "./alertDelivery";

test("plain http is refused", () => {
  assert.deepEqual(checkWebhookUrl("http://example.com/hook"), { ok: false, reason: "must use https" });
});

test("a public https destination is accepted", () => {
  assert.deepEqual(checkWebhookUrl("https://hooks.example.com/services/abc"), { ok: true });
});

test("embedded credentials are refused", () => {
  const verdict = checkWebhookUrl("https://user:pass@example.com/hook");
  assert.equal(verdict.ok, false);
});

test("localhost and cloud metadata hostnames are refused", () => {
  assert.equal(checkWebhookUrl("https://localhost/hook").ok, false);
  assert.equal(checkWebhookUrl("https://metadata.google.internal/computeMetadata/v1/").ok, false);
});

test("literal private addresses are refused", () => {
  for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254"]) {
    assert.equal(checkWebhookUrl(`https://${host}/hook`).ok, false, host);
  }
});

test("the cloud metadata address is classified private", () => {
  // 169.254.169.254 is the single most valuable SSRF target on every major cloud.
  assert.equal(isPrivateAddress("169.254.169.254"), true);
});

test("IPv4 ranges are classified correctly", () => {
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("172.32.0.1"), false); // just outside 172.16/12
  assert.equal(isPrivateAddress("172.31.255.255"), true);
  assert.equal(isPrivateAddress("100.64.0.1"), true); // carrier-grade NAT
  assert.equal(isPrivateAddress("224.0.0.1"), true); // multicast
});

test("IPv6 loopback, unique-local and link-local are private", () => {
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("fd00::1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});

test("IPv4-mapped IPv6 does not smuggle a private address through", () => {
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
});

test("a non-address string is treated as private rather than trusted", () => {
  assert.equal(isPrivateAddress("not-an-ip"), true);
});

test("malformed input is refused", () => {
  assert.equal(checkWebhookUrl("notaurl").ok, false);
});
