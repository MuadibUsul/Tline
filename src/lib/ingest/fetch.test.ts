import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, fetchPdf, fetchResource } from "./fetch";

test("outbound fetches reject private network destinations", async () => {
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/private"), /non-public/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::1]/private"), /non-public/);
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
