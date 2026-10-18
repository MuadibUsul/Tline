import { getSessionUser } from "@/lib/auth";
import { classifyWithSignals } from "@/lib/analytics/agent";
import { recordBotHit } from "@/lib/analytics/botHits";
import { identify, record, type Beacon } from "@/lib/analytics/collect";
import { clientAddress, readAnalyticsIdentity } from "@/lib/analytics/identity";
import { isOperatorAccount } from "@/lib/analytics/operator";
import { rateLimit } from "@/lib/rateLimit";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The one endpoint the analytics beacon posts to.
 *
 * It always answers 204 and it always answers immediately. A reader's browser has nothing
 * useful to do with an analytics error, and a page that waits on this call to finish has
 * been made slower by the thing measuring how fast it is.
 */

const LIMIT = Number(process.env.ANALYTICS_RATE_LIMIT || 120); // beacons per minute per address
const MAX_BODY = 12_000; // page-end payloads now carry section attention and scroll stops

function enabled() {
  return process.env.ANALYTICS_ENABLED !== "false";
}

function accepted() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Only this site's own pages may report. Not a security boundary — a filter for noise. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // sendBeacon on some browsers omits it
  try {
    return new URL(origin).host === new URL(siteUrl()).host || new URL(origin).hostname === "localhost";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!enabled() || !sameOrigin(request)) return accepted();

  // Do-Not-Track is a request, not a requirement, and honouring it costs a fraction of a
  // percent of the numbers. Left configurable so a deployment can decide for its region.
  if (process.env.ANALYTICS_RESPECT_DNT === "true" && (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1")) {
    return accepted();
  }
  if (!rateLimit(`analytics:${clientAddress(request.headers)}`, LIMIT, 60_000).allowed) return accepted();

  // sendBeacon posts text/plain, so the body is read as text and parsed here rather than
  // relying on a content type the browser chooses.
  let beacon: Beacon;
  try {
    const body = await request.text();
    if (!body || body.length > MAX_BODY) return accepted();
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return accepted();
    beacon = parsed as Beacon;
  } catch {
    return accepted();
  }

  const userAgent = request.headers.get("user-agent");
  const agent = classifyWithSignals(userAgent, beacon.signals as Parameters<typeof classifyWithSignals>[1]);
  if (agent.trafficClass !== "human") {
    // A JS-capable crawler/agent is still not an audience. Keep it in the bot/agent table,
    // and only count the pageview beacon once (duration/vital beacons would multiply it).
    if ((beacon.type ?? "pageview") === "pageview") {
      await recordBotHit({
        path: beacon.path,
        trafficClass: agent.trafficClass,
        agentName: agent.agentName,
        source: "beacon",
      }).catch(() => {});
    }
    return accepted();
  }

  const identity = readAnalyticsIdentity(request.headers);
  const user = await getSessionUser().catch(() => null);
  // The operator signed in to run the site, not to be counted as a reader.
  if (isOperatorAccount(user)) return accepted();
  const visitor = identify(request.headers, beacon.session, user?.id ?? null, identity, agent, beacon.signals);
  await record(beacon, visitor, request.headers).catch((error: unknown) => {
    console.warn(JSON.stringify({ event: "analytics.write_failed", error: String(error).slice(0, 300) }));
  });
  return accepted();
}
