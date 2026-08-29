import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const UA =
  "InstitutionalIntelligenceBot/0.1 (+respectful research aggregator; contact: ops@globalintel.io)";
const textCacheDir = path.resolve(process.env.HTTP_CACHE_ROOT || path.join(process.cwd(), "data", "cache", "http"));
const lastStatuses = new Map<string, number>();
const lastReasons = new Map<string, string>();

export function lastFetchStatus(url: string): number | undefined {
  return lastStatuses.get(url);
}

export function lastFetchReason(url: string): string | undefined {
  return lastReasons.get(url);
}

export interface FetchResult {
  ok: boolean;
  status: number;
  body: Buffer | null;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  retryAfter: string | null;
}

export async function fetchResource(
  url: string,
  timeoutMs = 15000,
  conditional?: { etag?: string | null; lastModified?: string | null },
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*",
    };
    if (conditional?.etag) headers["if-none-match"] = conditional.etag;
    if (conditional?.lastModified) headers["if-modified-since"] = conditional.lastModified;
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal,
      redirect: "follow",
    });
    lastStatuses.set(url, res.status);
    return {
      ok: res.ok || res.status === 304,
      status: res.status,
      body: res.status === 304 ? null : Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") || "",
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      retryAfter: res.headers.get("retry-after"),
    };
  } catch {
    lastStatuses.set(url, 0);
    return { ok: false, status: 0, body: null, contentType: "", etag: null, lastModified: null, retryAfter: null };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  const key = createHash("sha256").update(url).digest("hex");
  const cacheFile = path.join(textCacheDir, key + ".json");
  let cached: { url: string; body: string; etag: string | null; lastModified: string | null } | null = null;
  try {
    const value = JSON.parse(await readFile(cacheFile, "utf8"));
    if (value.url === url && typeof value.body === "string") cached = value;
  } catch {
    cached = null;
  }

  let result = await fetchResource(url, timeoutMs, cached ?? undefined);
  if (!result.ok && [429, 503].includes(result.status)) {
    const seconds = Number(result.retryAfter);
    await sleep(Number.isFinite(seconds) ? Math.min(seconds * 1000, 10000) : 1000);
    result = await fetchResource(url, timeoutMs, cached ?? undefined);
  }
  if (result.status === 304 && cached) return cached.body;
  if (!result.ok || !result.body || !/text|html|xml|rss|json/i.test(result.contentType)) return null;
  const body = result.body.toString("utf8");
  await mkdir(textCacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({
    url,
    body,
    etag: result.etag,
    lastModified: result.lastModified,
  }), "utf8");
  return body;
}

export async function fetchPdf(url: string, timeoutMs = 30000): Promise<Buffer | null> {
  lastReasons.delete(url);
  const result = await fetchResource(url, timeoutMs);
  if (!result.ok || !result.body || result.body.byteLength > 50 * 1024 * 1024) return null;
  if (!/pdf/i.test(result.contentType) && !result.body.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    if (/html/i.test(result.contentType)) lastReasons.set(url, "PDF request returned an HTML access or disclaimer page");
    return null;
  }
  return result.body;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
