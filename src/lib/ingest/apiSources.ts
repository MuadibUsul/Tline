import { UA, sleep } from "./fetch";

/**
 * Publisher JSON APIs for sources whose listings are client-rendered only.
 *
 * These sites return a fixed SPA shell for every path, so neither the sitemap
 * nor HTML link extraction can see a single publication. The app's own public
 * (unauthenticated) API is the listing; we call it with the same bot UA and the
 * same politeness delay as any other request.
 */
export interface ApiCandidate {
  url: string;
  title: string;
  publishedAt: Date;
  author: string | null;
  /** Downloads the publication's native PDF, or null when it is not public. */
  pdf: () => Promise<Buffer | null>;
}

export interface ApiDiscoveryOptions {
  since: Date;
  limit: number;
  /** Politeness delay applied between API requests. */
  delayMs: number;
}

export interface ApiDiscoveryResult {
  candidates: ApiCandidate[];
  /** Set only when the API itself could not be reached — an empty window is not a failure. */
  unreachable?: string;
}

type ApiDiscovery = (options: ApiDiscoveryOptions) => Promise<ApiDiscoveryResult>;

// --- Natixis Research (research.natixis.com) ---------------------------------
// Angular SPA over /Site/api. Publications are listed per "universe"; each item
// carries a route token (the public article URL) and a pathFileId (the PDF).
const NATIXIS_API = "https://www.research.natixis.com/Site/api";
const NATIXIS_UNIVERSES = [
  "Economics", "FixedIncome", "Forex", "CrossAssetsEquityDerivatives", "Covered",
  "HighYield", "Hybrid", "BankInsurance", "EnergyNaturalResources", "Infrastructure",
  "RealEstateHospitality", "TechData", "Healthcare", "TransportationMobility", "Credit",
] as const;
const NATIXIS_PAGE_SIZE = 20;
const NATIXIS_MAX_PAGES = 5;

interface NatixisItem {
  publicationId: number;
  tokenId?: string | null;
  pathFileId?: number | null;
  title?: string | null;
  authorName?: string | null;
  publishedAt?: string | null;
  isPublic?: boolean;
}

interface NatixisPage {
  items?: NatixisItem[];
  hasMoreData?: boolean;
}

async function natixisPost(path: string, body: unknown, token?: string): Promise<NatixisPage | null> {
  const res = await fetch(`${NATIXIS_API}${path}`, {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": "application/json-patch+json",
      accept: "text/plain",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/** Anonymous "guest" session token; the file endpoint rejects unauthenticated reads with 418. */
async function natixisGuestToken(): Promise<string | null> {
  try {
    const res = await fetch(`${NATIXIS_API}/Authentication/guest`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

/** /api/File/{id} answers with a JSON-encoded base64 string, not a binary body. */
async function natixisPdf(pathFileId: number, token: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${NATIXIS_API}/File/${pathFileId}`, {
      headers: { "user-agent": UA, accept: "*/*", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const encoded = JSON.parse(await res.text());
    if (typeof encoded !== "string") return null;
    const buffer = Buffer.from(encoded, "base64");
    return buffer.subarray(0, 5).toString("latin1") === "%PDF-" ? buffer : null;
  } catch {
    return null;
  }
}

const discoverNatixis: ApiDiscovery = async ({ since, limit, delayMs }) => {
  const token = await natixisGuestToken();
  if (!token) return { candidates: [], unreachable: "publisher API refused a guest session" };
  const seen = new Set<number>();
  const candidates: ApiCandidate[] = [];
  let listed = 0;
  for (const universe of NATIXIS_UNIVERSES) {
    for (let pageNumber = 1; pageNumber <= NATIXIS_MAX_PAGES; pageNumber++) {
      if (candidates.length >= limit) return { candidates };
      await sleep(delayMs);
      const page = await natixisPost("/Publications", {
        universe,
        authorId: null,
        publicationTypeName: null,
        isPublic: true,
        pagination: { orderBy: "ByDateHighest", pageNumber, pageSize: NATIXIS_PAGE_SIZE },
        culture: "English",
      });
      const items: NatixisItem[] = Array.isArray(page?.items) ? page.items : [];
      listed += items.length;
      if (items.length === 0) break;
      let reachedWindowEnd = false;
      for (const item of items) {
        const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
        if (!publishedAt || isNaN(publishedAt.getTime())) continue;
        // Results are date-descending: the first item older than the window ends this universe.
        if (publishedAt < since) { reachedWindowEnd = true; break; }
        if (seen.has(item.publicationId)) continue;
        seen.add(item.publicationId);
        if (!item.tokenId || !item.pathFileId || item.isPublic === false) continue;
        candidates.push({
          url: `https://www.research.natixis.com/Site/en/publication/${encodeURIComponent(item.tokenId)}`,
          title: (item.title || "").trim(),
          publishedAt,
          author: item.authorName?.trim() || null,
          pdf: () => natixisPdf(item.pathFileId!, token),
        });
      }
      if (reachedWindowEnd || page?.hasMoreData === false) break;
    }
  }
  // Listing responses but nothing inside the window is a quiet month, not a block.
  return listed === 0
    ? { candidates, unreachable: "publisher API returned no publication listing" }
    : { candidates };
};

const API_SOURCES: Record<string, ApiDiscovery> = {
  natixis: discoverNatixis,
};

export function apiDiscoveryEnabled(slug: string): boolean {
  return slug in API_SOURCES;
}

export async function discoverFromApi(slug: string, options: ApiDiscoveryOptions): Promise<ApiDiscoveryResult> {
  const discover = API_SOURCES[slug];
  if (!discover) return { candidates: [] };
  try {
    return await discover(options);
  } catch (error) {
    return { candidates: [], unreachable: `publisher API request failed: ${String(error)}` };
  }
}
