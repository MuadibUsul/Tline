import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { prisma } from "./db";

/**
 * Outbound delivery for fired alerts.
 *
 * Destinations are user-supplied, so every POST leaves the server aimed at an address a
 * user chose. That is a server-side request forgery primitive unless it is fenced: HTTPS
 * only, public addresses only (checked after DNS resolution, not on the hostname), and no
 * redirect following, because a redirect is a second destination that was never checked.
 */
export type DeliveryVerdict = { ok: true } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);

/** Private, loopback, link-local and other non-routable space, for both IPv4 and IPv6. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(Number(address.split(".")[2]))))) return true;
    if (a === 169 && b === 254) return true; // link-local, covers cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && Number(address.split(".")[2]) === 100))) return true;
    if (a === 203 && b === 0 && Number(address.split(".")[2]) === 113) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (/^f[cd]/.test(normalized)) return true; // unique local
    if (/^fe[89ab]/.test(normalized)) return true; // link-local
    if (normalized.startsWith("ff") || normalized.startsWith("2001:db8")) return true;
    // IPv4-mapped addresses inherit the IPv4 rules.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/** Syntactic checks only; the DNS check lives in `assertDeliverable`. */
export function checkWebhookUrl(raw: string): DeliveryVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "must use https" };
  if (url.username || url.password) return { ok: false, reason: "must not embed credentials" };
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) return { ok: false, reason: "blocked host" };
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    return { ok: false, reason: "resolves to a private address" };
  }
  return { ok: true };
}

type ResolvedDeliveryVerdict = { ok: true; address: string; family: 4 | 6 } | { ok: false; reason: string };

async function assertDeliverable(raw: string): Promise<ResolvedDeliveryVerdict> {
  const syntax = checkWebhookUrl(raw);
  if (!syntax.ok) return syntax;
  const hostname = new URL(raw).hostname;
  const literalFamily = isIP(hostname);
  if (literalFamily) return { ok: true, address: hostname, family: literalFamily as 4 | 6 };
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length) return { ok: false, reason: "host does not resolve" };
    if (records.some((record) => isPrivateAddress(record.address))) {
      return { ok: false, reason: "resolves to a private address" };
    }
    return { ok: true, address: records[0].address, family: records[0].family as 4 | 6 };
  } catch {
    return { ok: false, reason: "host does not resolve" };
  }
}

function postWebhook(destination: string, payload: AlertPayload, address: string, family: 4 | 6): Promise<number> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(destination, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("delivery timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

export interface AlertPayload {
  event: "alert.fired";
  id: string;
  firedAt: string;
  rule: { id: string; name: string; type: string; scopeKind: string; scopeRef: string | null };
  message: string;
  assetTicker: string | null;
  score: number | null;
  targetId: string | null;
}

const MAX_ATTEMPTS = Math.max(1, Number(process.env.ALERT_DELIVERY_ATTEMPTS || 3));

/**
 * Deliver alerts that have not been sent yet.
 *
 * A rule whose owner configured no destination is marked `skipped`, not `failed`: nothing
 * went wrong, there is simply nowhere to send it. That distinction is what keeps the
 * failure count meaningful.
 */
export async function deliverPendingAlerts(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const fallback = process.env.ALERT_WEBHOOK_URL || null;
  const pending = await prisma.alertEvent.findMany({
    where: { deliveryStatus: "pending", deliveryAttempts: { lt: MAX_ATTEMPTS } },
    orderBy: { firedAt: "asc" },
    take: limit,
    include: {
      rule: {
        select: {
          id: true, name: true, type: true, scopeKind: true, scopeRef: true,
          user: { select: { alertWebhookUrl: true } },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of pending) {
    const destination = event.rule.user.alertWebhookUrl || fallback;
    if (!destination) {
      skipped += 1;
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: { deliveryStatus: "skipped", deliveryError: "no destination configured" },
      });
      continue;
    }

    const verdict = await assertDeliverable(destination);
    if (!verdict.ok) {
      failed += 1;
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: {
          deliveryStatus: "failed",
          deliveryAttempts: MAX_ATTEMPTS,
          deliveryError: `destination rejected: ${verdict.reason}`,
        },
      });
      continue;
    }

    const payload: AlertPayload = {
      event: "alert.fired",
      id: event.id,
      firedAt: event.firedAt.toISOString(),
      rule: {
        id: event.rule.id,
        name: event.rule.name,
        type: event.rule.type,
        scopeKind: event.rule.scopeKind,
        scopeRef: event.rule.scopeRef,
      },
      message: event.message,
      assetTicker: event.assetTicker,
      score: event.score,
      targetId: event.targetId,
    };

    const attempts = event.deliveryAttempts + 1;
    try {
      const status = await postWebhook(destination, payload, verdict.address, verdict.family);
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      sent += 1;
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: { deliveryStatus: "sent", deliveryAttempts: attempts, deliveredAt: new Date(), deliveryError: null },
      });
    } catch (error) {
      failed += 1;
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: {
          // Stays pending while attempts remain, so the next pass retries it.
          deliveryStatus: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          deliveryAttempts: attempts,
          deliveryError: String(error).slice(0, 300),
        },
      });
    }
  }

  return { sent, failed, skipped };
}
