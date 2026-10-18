import { prisma } from "../db";
import { classify, type AgentInfo } from "./agent";
import { clientAddress, clientCountry, dayKey, readAnalyticsIdentity, visitorHash, type AnalyticsIdentity } from "./identity";
import { normalizePath, pageMeta } from "./path";

/**
 * Turning a beacon into a row.
 *
 * Everything a browser sends is attacker-controlled: the payload arrives from a public
 * endpoint that anyone can post to. So nothing here is trusted for its length, its shape
 * or its meaning — paths are normalised, referrers reduced to a host, strings truncated,
 * and unknown fields dropped rather than stored.
 */

export { normalizePath } from "./path";

export const VITALS = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export type Vital = (typeof VITALS)[number];

/** Column budgets. A generated URL can be arbitrarily long; a stored one cannot. */
const LIMITS = { path: 300, name: 80, host: 120, utm: 120, session: 64, metadata: 1000, label: 120, section: 160, view: 64 } as const;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function number(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function viewId(value: unknown): string | null {
  const candidate = text(value, LIMITS.view);
  return candidate && /^[A-Za-z0-9_-]{8,64}$/.test(candidate) ? candidate : null;
}

/** Just the host, and only for a referrer that is not this site itself. */
export function referrerHost(raw: unknown, self: string | null): string | null {
  const value = text(raw, 2000);
  if (!value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    const selfHost = self?.split(":")[0]?.replace(/^www\./, "");
    return !host || host === selfHost ? null : host.slice(0, LIMITS.host);
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
  exit?: unknown;
  durationMs?: unknown;
  visibleMs?: unknown;
  activeMs?: unknown;
  maxScrollPct?: unknown;
  lastScrollPct?: unknown;
  scrollStops?: unknown;
  stoppedSection?: unknown;
  exitSection?: unknown;
  clickCount?: unknown;
  sections?: unknown;
  viewId?: unknown;
  fromViewId?: unknown;
  toPath?: unknown;
  name?: unknown;
  value?: unknown;
  metadata?: unknown;
  metric?: unknown;
  rating?: unknown;
  utm?: unknown;
  signals?: unknown;
  clicks?: unknown;
}

export interface Visitor {
  visitorId: string;
  visitorKey: string | null;
  sessionId: string;
  userId: string | null;
  device: string;
  os: string;
  browser: string;
  country: string | null;
  trafficClass: string;
  trafficName: string | null;
  trafficConfidence: number;
  trafficSignals: string | null;
  consent: "granted" | "denied" | "unknown";
}

/** Everything about the caller that is derived on the server and never taken on trust. */
export function identify(
  headers: Headers,
  session: unknown,
  userId: string | null,
  identity: AnalyticsIdentity = readAnalyticsIdentity(headers),
  agent: AgentInfo = classify(headers.get("user-agent")),
  signals?: unknown,
): Visitor {
  return {
    visitorId: visitorHash(clientAddress(headers), headers.get("user-agent") ?? ""),
    visitorKey: identity.visitorKey,
    // A session identifier is a correlation handle inside one tab, so a made-up one is
    // harmless; it is still bounded so it cannot be used to store data in this column.
    sessionId: text(session, LIMITS.session) ?? "unknown",
    userId,
    device: agent.device,
    os: agent.os,
    browser: agent.browser,
    country: clientCountry(headers),
    trafficClass: agent.trafficClass,
    trafficName: agent.agentName,
    trafficConfidence: agent.confidence,
    trafficSignals: signals ? JSON.stringify(signals).slice(0, 600) : null,
    consent: identity.consent,
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

function scrollStopsOf(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const stops = raw.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const pct = number(value.pct, 0, 100);
    const ms = number(value.ms, 0, 4 * 60 * 60 * 1000);
    return pct === null || ms === null ? [] : [{ pct, ms }];
  });
  return stops.length ? JSON.stringify(stops).slice(0, 1200) : null;
}

function clickTarget(raw: unknown, selfHost: string | null): string | null {
  const value = text(raw, 2000);
  if (!value) return null;
  try {
    const url = new URL(value, "http://x");
    const self = selfHost?.split(":")[0]?.replace(/^www\./, "");
    if (url.hostname === "x" || url.hostname.replace(/^www\./, "") === self) {
      return normalizePath(url.pathname)?.path ?? null;
    }
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`.slice(0, LIMITS.path);
  } catch {
    return null;
  }
}

/** When a signed-in reader was anonymous earlier in this cookie's life, link that history. */
const linked = new Set<string>();
async function linkVisitorHistory(visitorKey: string, userId: string) {
  const key = `${visitorKey}:${userId}`;
  if (linked.has(key)) return;
  linked.add(key);
  if (linked.size > 5000) linked.clear();
  await prisma.$transaction([
    prisma.pageView.updateMany({ where: { visitorKey, userId: null }, data: { userId } }),
    prisma.analyticsEvent.updateMany({ where: { visitorKey, userId: null }, data: { userId } }),
    prisma.clickEvent.updateMany({ where: { visitorKey, userId: null }, data: { userId } }),
    prisma.sectionView.updateMany({ where: { visitorKey, userId: null }, data: { userId } }),
  ]);
}

export type BeaconOutcome = "pageview" | "duration" | "event" | "vital" | "click" | "transition" | "ignored";

/** Writes one beacon. Returns what it decided the beacon was, for the caller's own log. */
export async function record(beacon: Beacon, visitor: Visitor, headers: Headers): Promise<BeaconOutcome> {
  const day = dayKey();
  const type = text(beacon.type, 20) ?? "pageview";

  if (type === "transition") {
    const from = viewId(beacon.fromViewId);
    const to = normalizePath(beacon.toPath);
    if (!from || !to) return "ignored";
    await prisma.pageView.updateMany({ where: { viewId: from }, data: { nextPath: to.path } });
    return "transition";
  }

  if (type === "click") {
    const page = normalizePath(beacon.path);
    if (!page) return "ignored";
    const click = beacon.clicks && typeof beacon.clicks === "object" ? beacon.clicks as Record<string, unknown> : {};
    const targetType = text(click.targetType, 20) ?? "link";
    if (!["link", "nav", "cta", "outbound", "action"].includes(targetType)) return "ignored";
    const self = headers.get("host");
    await prisma.clickEvent.create({
      data: {
        day,
        viewId: viewId(beacon.viewId),
        visitorId: visitor.visitorId,
        visitorKey: visitor.visitorKey,
        sessionId: visitor.sessionId,
        userId: visitor.userId,
        path: page.path,
        section: text(click.section, LIMITS.section),
        targetPath: clickTarget(click.targetPath, self),
        targetLabel: text(click.targetLabel, LIMITS.label),
        targetType,
        xPct: number(click.xPct, 0, 100),
        yPct: number(click.yPct, 0, 100),
        scrollPct: number(click.scrollPct, 0, 100),
        trafficClass: visitor.trafficClass,
        consent: visitor.consent,
      },
    });
    const id = viewId(beacon.viewId);
    if (id) await prisma.pageView.updateMany({ where: { viewId: id }, data: { clickCount: { increment: 1 } } });
    return "click";
  }

  if (type === "duration") {
    // A page view already written, now told how long it lasted and where it stopped.
    const id = viewId(beacon.viewId);
    const page = normalizePath(beacon.path);
    const target = id
      ? await prisma.pageView.findFirst({ where: { viewId: id }, select: { id: true, clickCount: true } })
      : await prisma.pageView.findFirst({
        where: { sessionId: visitor.sessionId, path: page?.path ?? undefined },
        orderBy: { ts: "desc" },
        select: { id: true, clickCount: true },
      });
    const visibleMs = duration(beacon.visibleMs ?? beacon.durationMs);
    const maxScrollPct = number(beacon.maxScrollPct, 0, 100);
    const clickCount = number(beacon.clickCount, 0, 10000) ?? 0;
    if (!target || (visibleMs === null && maxScrollPct === null)) return "ignored";
    const activeMs = number(beacon.activeMs, 0, 4 * 60 * 60 * 1000);
    await prisma.pageView.update({
      where: { id: target.id },
      data: {
        visibleMs: visibleMs ?? undefined,
        activeMs: activeMs ?? undefined,
        durationMs: visibleMs ?? undefined,
        maxScrollPct: maxScrollPct ?? undefined,
        lastScrollPct: number(beacon.lastScrollPct, 0, 100) ?? undefined,
        scrollStops: scrollStopsOf(beacon.scrollStops) ?? undefined,
        stoppedSection: text(beacon.stoppedSection, LIMITS.section),
        exitSection: text(beacon.exitSection, LIMITS.section),
        clickCount: Math.max(clickCount, target.clickCount),
        isExit: beacon.exit === true,
        isGlance: (visibleMs ?? 0) < 5000 && (maxScrollPct ?? 0) < 20 && clickCount === 0,
        isRead: (visibleMs ?? 0) >= 15000 || (maxScrollPct ?? 0) >= 50,
      },
    });
    const sections = Array.isArray(beacon.sections) ? beacon.sections.slice(0, 60) : [];
    const sectionRows = sections.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const section = text(value.id, LIMITS.section);
      const visibleMs = number(value.visibleMs, 0, 4 * 60 * 60 * 1000) ?? 0;
      const maxVisiblePct = number(value.maxVisiblePct, 0, 100) ?? 0;
      if (!section || (visibleMs === 0 && maxVisiblePct === 0)) return [];
      return [{
        day,
        viewId: id,
        visitorId: visitor.visitorId,
        visitorKey: visitor.visitorKey,
        sessionId: visitor.sessionId,
        userId: visitor.userId,
        path: page?.path ?? "/",
        section,
        sectionTitle: text(value.title, LIMITS.section),
        visibleMs,
        maxVisiblePct,
        isExit: value.isExit === true,
        trafficClass: visitor.trafficClass,
        consent: visitor.consent,
      }];
    });
    if (sectionRows.length) await prisma.sectionView.createMany({ data: sectionRows });
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
        visitorKey: visitor.visitorKey,
        viewId: viewId(beacon.viewId),
        sessionId: visitor.sessionId,
        userId: visitor.userId,
        trafficClass: visitor.trafficClass,
        consent: visitor.consent,
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
        visitorKey: visitor.visitorKey,
        trafficClass: visitor.trafficClass,
      },
    });
    return "vital";
  }

  const page = normalizePath(beacon.path);
  if (!page) return "ignored";
  const meta = pageMeta(page.path);
  const created = await prisma.pageView.create({
    data: {
      day,
      path: page.path,
      locale: page.locale,
      visitorId: visitor.visitorId,
      visitorKey: visitor.visitorKey,
      viewId: viewId(beacon.viewId),
      sessionId: visitor.sessionId,
      userId: visitor.userId,
      isEntry: beacon.entry === true,
      referrerHost: referrerHost(beacon.referrer, headers.get("host")),
      ...utmOf(beacon.utm),
      country: visitor.country,
      device: visitor.device,
      os: visitor.os,
      browser: visitor.browser,
      template: meta.template,
      contentId: meta.contentId,
      trafficClass: visitor.trafficClass,
      trafficName: visitor.trafficName,
      trafficConfidence: visitor.trafficConfidence,
      trafficSignals: visitor.trafficSignals,
      consent: visitor.consent,
    },
    select: { id: true },
  });
  if (visitor.visitorKey && visitor.userId) {
    await linkVisitorHistory(visitor.visitorKey, visitor.userId).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: "analytics.link_failed", error: String(error).slice(0, 200) }));
    });
  }
  void created;
  return "pageview";
}
