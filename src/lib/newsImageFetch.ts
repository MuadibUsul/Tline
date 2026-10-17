import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { checkWebhookUrl, isPrivateAddress } from "./alertDelivery";

/**
 * Fetch an image from a URL the agent supplied, for storage with a news item.
 *
 * This is the same SSRF fence the alert webhooks use: HTTPS only, no credentials, no
 * private/link-local/loopback address after DNS resolution, no redirects (a redirect is a
 * destination nobody checked), a byte cap and an image signature check. The bytes are
 * stored in NewsImage; the remote URL is not hotlinked.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type ImageFetchResult =
  | { ok: true; data: Buffer; mimeType: string }
  | { ok: false; message: string };

/** The format the bytes actually are, not what the server said they were. */
export function imageMimeFromBytes(data: Uint8Array): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "GIF8") return "image/gif";
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function fetchPublicImage(raw: string): Promise<ImageFetchResult> {
  const syntax = checkWebhookUrl(raw);
  if (!syntax.ok) return { ok: false, message: `Image URL refused: ${syntax.reason}.` };
  const url = new URL(raw);
  let address: string;
  let family: 4 | 6;
  try {
    const records = await lookup(url.hostname, { all: true });
    if (!records.length) return { ok: false, message: "Image host does not resolve." };
    const record = records.find((candidate) => !isPrivateAddress(candidate.address));
    if (!record) return { ok: false, message: "Image host resolves to a private address." };
    address = record.address;
    family = record.family as 4 | 6;
  } catch {
    return { ok: false, message: "Image host does not resolve." };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ImageFetchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = httpsRequest(url, {
      method: "GET",
      headers: { accept: "image/*", "user-agent": "Tlines newsroom image fetcher" },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      timeout: TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status !== 200) {
        response.resume();
        finish({ ok: false, message: `Image host answered HTTP ${status}.` });
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED.has(contentType)) {
        response.resume();
        finish({ ok: false, message: "That URL is not a PNG, JPEG, WebP or GIF image." });
        return;
      }
      const length = Number(response.headers["content-length"] ?? 0);
      if (length > MAX_BYTES) {
        response.resume();
        finish({ ok: false, message: "Image is larger than 8MB." });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          request.destroy();
          finish({ ok: false, message: "Image is larger than 8MB." });
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const data = Buffer.concat(chunks);
        const mimeType = imageMimeFromBytes(data);
        if (!mimeType || !ALLOWED.has(mimeType)) {
          finish({ ok: false, message: "The file is not a valid PNG, JPEG, WebP or GIF image." });
          return;
        }
        finish({ ok: true, data, mimeType });
      });
      response.on("error", () => finish({ ok: false, message: "The image download failed." }));
    });
    request.on("timeout", () => {
      request.destroy();
      finish({ ok: false, message: "The image download timed out." });
    });
    request.on("error", () => finish({ ok: false, message: "The image download failed." }));
    request.end();
  });
}
