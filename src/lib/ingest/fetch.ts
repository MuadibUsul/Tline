import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

export const UA =
  "InstitutionalIntelligenceBot/0.1 (+respectful research aggregator; contact: ops@globalintel.io)";
const textCacheDir = path.resolve(process.env.HTTP_CACHE_ROOT || path.join(process.cwd(), "data", "cache", "http"));
const lastStatuses = new Map<string, number>();
const lastReasons = new Map<string, string>();
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal"]);
let lastCachePrune = 0;

async function pruneTextCache() {
  if (Date.now() - lastCachePrune < 60 * 60_000) return;
  lastCachePrune = Date.now();
  const files = await readdir(textCacheDir).catch(() => []);
  const rows = await Promise.all(files.map(async (name) => {
    const file = path.join(textCacheDir, name);
    const info = await stat(file).catch(() => null);
    return info?.isFile() ? { file, mtimeMs: info.mtimeMs } : null;
  }));
  const ordered = rows.filter((row): row is { file: string; mtimeMs: number } => Boolean(row)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = Date.now() - 30 * 864e5;
  await Promise.all(ordered.filter((row, index) => index >= 2_000 || row.mtimeMs < cutoff).map((row) => unlink(row.file).catch(() => undefined)));
}

/** The eight hextets of an IPv6 address, or null when it is not one this can read. */
function hextets(address: string): number[] | null {
  if (address.includes(".") || address.split("::").length > 2) return null;
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = [...left, ...Array(address.includes("::") ? fill : 0).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const values = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return values.some((value) => Number.isNaN(value)) ? null : values;
}

function privateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const groups = hextets(value);
    /**
     * An address that embeds an IPv4 address is that IPv4 address, and is judged as one.
     *
     * `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same address, and the URL parser returns
     * the *hex* one: `new URL("http://[::ffff:127.0.0.1]/")` normalises its host to
     * `[::ffff:7f00:1]`. The dotted-spelling match below therefore cannot fire on a hostname
     * that came from a URL at all, so `http://[::ffff:169.254.169.254]/latest/meta-data/` was
     * classified as public while the comment above it claimed the mapped form was handled.
     * Reading the last two hextets covers both spellings, and requiring the leading hextets to
     * be zero covers the deprecated `::a.b.c.d` form with the same rule.
     */
    const embedded = groups && groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0 || groups[5] === 0xffff)
      ? `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
      : null;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return value === "::" || value === "::1" || /^f[cd]/.test(value)
      || /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8")
      || Boolean(mapped && privateAddress(mapped[1]))
      || Boolean(embedded && privateAddress(embedded));
  }
  return true;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("blocked outbound URL");
  }
  /**
   * A literal address is classified as an address, never resolved.
   *
   * `url.hostname` keeps the brackets on an IPv6 literal, so `isIP("[::1]")` is 0 and every
   * IPv6 literal fell through to the resolver instead — pointless, since there is nothing to
   * resolve, and wrong in the one place it matters: whether a literal private address is
   * refused must not depend on the host having IPv6 name resolution. On the Linux runner it
   * does not, so `http://[::1]/` answered `ENOTFOUND` instead of "non-public"; on Windows the
   * resolver accepts the bracketed form and the check ran, which is why the test passed for
   * as long as it never ran anywhere else.
   */
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!records.length || records.some(({ address }) => privateAddress(address))) throw new Error("outbound URL resolves to a non-public address");
  return url;
}

async function readBody(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
  if (!res.body) {
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return body;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

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
  finalUrl: string;
}

export async function fetchResource(
  url: string,
  timeoutMs = 15000,
  conditional?: { etag?: string | null; lastModified?: string | null },
  extraHeaders?: Record<string, string>,
  maxBytes = MAX_TEXT_BYTES,
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*",
      ...extraHeaders,
    };
    if (conditional?.etag) headers["if-none-match"] = conditional.etag;
    if (conditional?.lastModified) headers["if-modified-since"] = conditional.lastModified;
    let current = (await assertPublicHttpUrl(url)).toString();
    let res: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects++) {
      res = await fetch(current, { headers, signal: ctrl.signal, redirect: "manual" });
      const location = res.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(res.status) || !location) break;
      current = (await assertPublicHttpUrl(new URL(location, current).toString())).toString();
    }
    if (!res) throw new Error("no response");
    await assertPublicHttpUrl(res.url || current);
    lastStatuses.set(url, res.status);
    return {
      ok: res.ok || res.status === 304,
      status: res.status,
      body: res.status === 304 ? null : await readBody(res, maxBytes),
      contentType: res.headers.get("content-type") || "",
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      retryAfter: res.headers.get("retry-after"),
      finalUrl: res.url,
    };
  } catch (error) {
    lastStatuses.set(url, 0);
    lastReasons.set(url, error instanceof Error ? error.message : String(error));
    return { ok: false, status: 0, body: null, contentType: "", etag: null, lastModified: null, retryAfter: null, finalUrl: url };
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
  try {
    const requested = new URL(url);
    const final = new URL(result.finalUrl);
    if (requested.pathname.replace(/\/$/, "") && !final.pathname.replace(/^\/(?:index\.[a-z0-9]+)?\/?$/i, "")) {
      lastReasons.set(url, `redirected to site root: ${result.finalUrl}`);
      return null;
    }
  } catch { /* URL validation already happens at fetch */ }
  if (!result.ok || !result.body || !/text|html|xml|rss|json/i.test(result.contentType)) return null;
  const body = result.body.toString("utf8");
  await mkdir(textCacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({
    url,
    body,
    etag: result.etag,
    lastModified: result.lastModified,
  }), "utf8");
  void pruneTextCache();
  return body;
}

export async function fetchPdf(url: string, timeoutMs = 30000): Promise<Buffer | null> {
  lastReasons.delete(url);
  let result = await fetchResource(url, timeoutMs, undefined, undefined, MAX_PDF_BYTES);
  // Intesa's public PDFs redirect once through a disclaimer. The publisher's own
  // acceptance flow records the document id as an "accepted" cookie.
  try {
    const final = new URL(result.finalUrl);
    const documentId = final.pathname.includes("/research/disclaimer/") && final.searchParams.get("NEXT_URL");
    if (documentId && /^[\da-f-]{36}$/i.test(documentId)) {
      result = await fetchResource(url, timeoutMs, undefined, {
        accept: "application/pdf,*/*",
        cookie: `${documentId}=accepted`,
      }, MAX_PDF_BYTES);
    }
  } catch { /* keep the original response */ }
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
