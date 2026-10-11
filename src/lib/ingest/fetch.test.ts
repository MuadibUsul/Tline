import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, fetchPdf, fetchResource, retryDelayMs } from "./fetch";

test("a 429/503 retry waits out the publisher's Retry-After, capped", () => {
  // The old cap was 10 s: a source answering "come back in 60 s" got a 10 s wait, a
  // wasted request, and a whole round lost to source-level backoff. The named interval
  // is honoured now — only shorter than the cap.
  assert.equal(retryDelayMs("60", 2000), 60_000);
  assert.equal(retryDelayMs("3600", 2000), 120_000);
  assert.equal(retryDelayMs("0.2", 2000), 200);
  // An HTTP-date or a missing header falls back, it does not explode.
  assert.equal(retryDelayMs("Wed, 21 Oct 2015 07:28:00 GMT", 2000), 2000);
  assert.equal(retryDelayMs(null, 2000), 2000);
});

test("outbound fetches reject private network destinations", async () => {
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::1]/private"), /non-public/);
  // The rest of the IPv6 ranges a literal can name, none of which needs a resolver to judge.
  // The bracketed loopback above is the case that broke: `url.hostname` keeps the brackets, so
  // `isIP` said "not an address" and the check asked DNS about a literal — which on a host
  // without IPv6 resolution fails with ENOTFOUND instead of refusing the address.
  await assert.rejects(() => assertPublicHttpUrl("http://[fc00::1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[fe80::1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[2001:db8::1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/"), /non-public/);
  // The IPv4-mapped spellings. The URL parser normalises `[::ffff:127.0.0.1]` to the hex
  // `[::ffff:7f00:1]`, so a check that only knew the dotted spelling let the mapped form of
  // every private address through — including the cloud metadata address.
  await assert.rejects(() => assertPublicHttpUrl("http://[::ffff:127.0.0.1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::ffff:169.254.169.254]/latest/meta-data/"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[0:0:0:0:0:ffff:10.0.0.1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::ffff:7f00:1]/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/"), /non-public/);
  // A public literal is still allowed, so the guard is a range check and not a blanket ban.
  assert.equal((await assertPublicHttpUrl("https://8.8.8.8/report.pdf")).hostname, "8.8.8.8");
  // …and a mapped address that embeds a public IPv4 address is still reachable.
  assert.equal((await assertPublicHttpUrl("https://[::ffff:8.8.8.8]/report.pdf")).hostname, "[::ffff:808:808]");
});

test("fetchResource stops before buffering an oversized response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    url: "https://8.8.8.8/report.pdf",
    headers: new Headers({ "content-type": "application/pdf", "content-length": "101" }),
    arrayBuffer: async () => Buffer.alloc(101),
  }) as unknown as Response) as typeof fetch;
  try {
    const result = await fetchResource("https://8.8.8.8/report.pdf", 1000, undefined, undefined, 100);
    assert.equal(result.ok, false);
    assert.match(result.finalUrl, /8\.8\.8\.8/);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchPdf accepts Intesa's public document disclaimer once", async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    if (calls.length === 1) return {
      ok: true,
      status: 200,
      url: "https://8.8.8.8/en/research/disclaimer/disclaimer?NEXT_URL=4b13438e-cb73-417c-ac6b-a593b88c89d3",
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: async () => Buffer.from("disclaimer"),
    } as unknown as Response;
    return {
      ok: true,
      status: 200,
      url: "https://8.8.8.8/report.pdf",
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => Buffer.from("%PDF-1.7 report"),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    assert.ok(await fetchPdf("https://8.8.8.8/report.pdf"));
    assert.equal((calls[1]?.headers as Record<string, string>).cookie, "4b13438e-cb73-417c-ac6b-a593b88c89d3=accepted");
  } finally {
    globalThis.fetch = original;
  }
});
