import { prisma } from "../db";
import { stripLocale, localeFromPath } from "../i18n";
import { classify } from "./agent";
import { clientAddress, clientCountry, dayKey, visitorHash } from "./identity";

/**
 * Turning a beacon into a row.
 *
 * Everything a browser sends is attacker-controlled: the payload arrives from a public
 * endpoint that anyone can post to. So nothing here is trusted for its length, its shape
 * or its meaning — paths are normalised, referrers reduced to a host, strings truncated,
 * and unknown fields dropped rather than stored.
 */

export const VITALS = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export type Vital = (typeof VITALS)[number];

/** Column budgets. A generated URL can be arbitrarily long; a stored one cannot. */
const LIMITS = { path: 300, name: 80, host: 120, utm: 120, session: 64, metadata: 1000 } as const;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The address, reduced to the page it names.
 *
 * The query string goes: it is the one part of a URL that routinely carries a search
 * term, an email address or a token, and none of that belongs in an analytics table. The
 * language prefix goes too, so `/en/research` and `/zh/research` aggregate as one page
 * with the language recorded separately.
 */
export function normalizePath(raw: unknown): { path: string; locale: string } | null {
  const value = text(raw, 2000);
  if (!value) return null;
  let pathname: string;
  try {
    // Relative to a fixed base so an absolute URL pointing elsewhere still yields only
    // its path, and a caller cannot smuggle a host in through this field.
    pathname = new URL(value, "http://x").pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith("/")) return null;
  const locale = localeFromPath(pathname) ?? "en";
  const path = stripLocale(pathname).replace(/\/+$/, "") || "/";
  return { path: path.slice(0, LIMITS.path), locale };
}

/** Just the host, and only for a referrer that is not this site itself. */
export function referrerHost(raw: unknown, self: string | null): string | null {
  const value = text(raw, 2000);
  if (!value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return !host || host === self?.replace(/^www\./, "") ? null : host.slice(0, LIMITS.host);
  } catch {
    return null;
  }
}

export interface Beacon {
  type?: unknown;
  path?: unknown;
  referrer?: unknown;
  session?: unknown;
  entry?: unknown;
  durationMs?: unknown;
  name?: unknown;
  value?: unknown;
  metadata?: unknown;
  metric?: unknown;
  rating?: unknown;
  utm?: unknown;
}

export interface Visitor {
  visitorId: string;
  sessionId: string;
  userId: string | null;
  device: string;
  os: string;
  browser: string;
  country: string | null;
}

/** Everything about the caller that is derived on the server and never taken on trust. */
export function identify(headers: Headers, session: unknown, userId: string | null): Visitor {
  const userAgent = headers.get("user-agent") ?? "";
  const agent = classify(userAgent);
  return {
    visitorId: visitorHash(clientAddress(headers), userAgent),
    // A session identifier is a correlation handle inside one tab, so a made-up one is
    // harmless; it is still bounded so it cannot be used to store data in this column.
    sessionId: text(session, LIMITS.session) ?? "unknown",
    userId,
    device: agent.device,
    os: agent.os,
    browser: agent.browser,
    country: clientCountry(headers),
  };
}

function utmOf(raw: unknown) {
  const utm = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    utmSource: text(utm.source, LIMITS.utm),
    utmMedium: text(utm.medium, LIMITS.utm),
    utmCampaign: text(utm.campaign, LIMITS.utm),
  };
}

/** Non-negative, bounded at four hours: a tab left open overnight is not a reading session. */
function duration(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(Math.round(value), 4 * 60 * 60 * 1000);
}

export type BeaconOutcome = "pageview" | "duration" | "event" | "vital" | "ignored";

/**
 * Writes one beacon. Returns what it decided the beacon was, for the caller's own log.
 *
 * A malformed payload is ignored rather than rejected: the sender is a browser that
 * cannot act on an error, and a failed analytics write must never surface to a reader.
 */
export async function record(beacon: Beacon, visitor: Visitor, headers: Headers): Promise<BeaconOutcome> {
  const day = dayKey();
  const type = text(beacon.type, 20) ?? "pageview";

  if (type === "duration") {
    // A view already written, now told how long it lasted. Matching on the newest row
    // for this session and path avoids an id round-trip through the browser.
    const target = await prisma.pageView.findFirst({
      where: { sessionId: visitor.sessionId, path: normalizePath(beacon.path)?.path ?? undefined },
      orderBy: { ts: "desc" },
      select: { id: true, durationMs: true },
    });
    const ms = duration(beacon.durationMs);
    if (!target || ms === null) return "ignored";
    // Only ever grows: a tab revisited and closed again reports the longer total, and a
    // late-arriving smaller number must not erase what was already known.
    if (target.durationMs !== null && target.durationMs >= ms) return "ignored";
    await prisma.pageView.update({ where: { id: target.id }, data: { durationMs: ms } });
    return "duration";
  }

  if (type === "event") {
    const name = text(beacon.name, LIMITS.name);
    if (!name) return "ignored";
    const value = Number(beacon.value);
    await prisma.analyticsEvent.create({
      data: {
        day,
        name,
        path: normalizePath(beacon.path)?.path ?? null,
        visitorId: visitor.visitorId,
        sessionId: visitor.sessionId,
        userId: visitor.userId,
        value: Number.isFinite(value) ? value : null,
        metadata: JSON.stringify(beacon.metadata ?? {}).slice(0, LIMITS.metadata),
      },
    });
    return "event";
  }

  if (type === "vital") {
    const metric = text(beacon.metric, 10);
    const value = Number(beacon.value);
    const page = normalizePath(beacon.path);
    if (!metric || !(VITALS as readonly string[]).includes(metric) || !Number.isFinite(value) || !page) return "ignored";
    await prisma.webVital.create({
      data: {
        day,
        metric,
        value,
        rating: text(beacon.rating, 20) ?? "unknown",
        path: page.path,
        device: visitor.device,
      },
    });
    return "vital";
  }

  const page = normalizePath(beacon.path);
  if (!page) return "ignored";
  await prisma.pageView.create({
    data: {
      day,
      path: page.path,
      locale: page.locale,
      visitorId: visitor.visitorId,
      sessionId: visitor.sessionId,
      userId: visitor.userId,
      isEntry: beacon.entry === true,
      referrerHost: referrerHost(beacon.referrer, headers.get("host")),
      ...utmOf(beacon.utm),
      country: visitor.country,
      device: visitor.device,
      os: visitor.os,
      browser: visitor.browser,
    },
  });
  return "pageview";
}
