import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, fetchPdf, fetchResource } from "./fetch";

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
  // A public literal is still allowed, so the guard is a range check and not a blanket ban.
  assert.equal((await assertPublicHttpUrl("https://8.8.8.8/report.pdf")).hostname, "8.8.8.8");
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
