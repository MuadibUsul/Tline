import assert from "node:assert/strict";
import test from "node:test";
import { fetchPdf } from "./fetch";

test("fetchPdf accepts Intesa's public document disclaimer once", async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    if (calls.length === 1) return {
      ok: true,
      status: 200,
      url: "https://group.intesasanpaolo.com/en/research/disclaimer/disclaimer?NEXT_URL=4b13438e-cb73-417c-ac6b-a593b88c89d3",
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: async () => Buffer.from("disclaimer"),
    } as unknown as Response;
    return {
      ok: true,
      status: 200,
      url: "https://group.intesasanpaolo.com/report.pdf",
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => Buffer.from("%PDF-1.7 report"),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    assert.ok(await fetchPdf("https://group.intesasanpaolo.com/report.pdf"));
    assert.equal((calls[1]?.headers as Record<string, string>).cookie, "4b13438e-cb73-417c-ac6b-a593b88c89d3=accepted");
  } finally {
    globalThis.fetch = original;
  }
});
