import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateFileSize, privateDownloadUrl, readPrivateFile, readPrivateFileRange } from "@/lib/documents/storage";
import { parseRangeHeader } from "@/lib/documents/range";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { trackServerEvent } from "@/lib/analytics/serverEvent";
import { DOCUMENT_ROBOTS } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_PREVIEW = "private, max-age=86400, stale-while-revalidate=604800";
const CACHE_DOWNLOAD = "private, max-age=3600";

/**
 * Previews are page interactions, not downloads: count one per document/reader per ten
 * minutes rather than once per byte range. pdf.js asks for many ranges, and an analytics
 * write behind each of them turned opening a report into a write storm.
 */
const recentPreviews = new Map<string, number>();
function trackPreview(document: { id: string; articleId: string; kind: string; locale: string }, request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anon";
  const key = `${document.id}:${forwarded}:${request.headers.get("user-agent") ?? ""}`;
  const now = Date.now();
  const last = recentPreviews.get(key);
  if (last && now - last < 10 * 60_000) return;
  recentPreviews.set(key, now);
  if (recentPreviews.size > 2000) recentPreviews.clear();
  trackServerEvent("document.preview", request.headers, {
    path: `/research/${document.articleId}`,
    metadata: { kind: document.kind, locale: document.locale },
  });
}

/**
 * The PDF is the report, and it is meant to be read on the page rather than found in a
 * search result in place of it. `noindex` says exactly that without forbidding the fetch.
 *
 * robots.txt used to ask the crawler not to fetch these at all, which Search Console
 * reported as blocked pages — one such link sits on every research page — and which also
 * kept the inline preview from rendering for a crawler, so the page it was meant to complete
 * arrived incomplete. The header is set on the redirect as well as on the streamed body: the
 * download path hands off to object storage, and the instruction has to travel with the
 * response the crawler first receives.
 */
function safeFilename(title: string, locale: string) {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return (clean || "research") + "-" + locale + ".pdf";
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const document = await prisma.articleDocument.findUnique({
    where: { id: params.id },
    include: { article: { select: { title: true } } },
  });
  if (!document || document.status !== "ready") {
    return new Response("Document not found.", { status: 404, headers: DOCUMENT_ROBOTS });
  }

  // Previewing asks for the same bytes shown in place rather than saved, so the only
  // difference is the disposition.
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  try {
    const filename = safeFilename(document.article.title, document.locale);
    const size = document.byteSize && document.byteSize > 0 ? document.byteSize : await privateFileSize(document.storageKey);
    const range = parseRangeHeader(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes", ...DOCUMENT_ROBOTS },
      });
    }
    const etag = `"${document.id}-${document.updatedAt.getTime()}"`;
    if (range === null && request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": inline ? CACHE_PREVIEW : CACHE_DOWNLOAD, ...DOCUMENT_ROBOTS },
      });
    }

    if (inline) {
      // A preview is public, and its bytes are the hot path: no session lookup and no
      // audit row before the first page can paint. Analytics still records the read.
      trackPreview(document, request);
    } else {
      const user = await getSessionUser();
      if (!can(user, "document.download.original")) return new Response("Forbidden.", { status: 403, headers: DOCUMENT_ROBOTS });
      trackServerEvent("document.download", request.headers, {
        userId: user?.id ?? null,
        path: `/research/${document.articleId}`,
        metadata: { kind: document.kind, locale: document.locale },
      });
      if (user) {
        await writeAudit({
          actorId: user.id,
          action: "document.download",
          targetType: document.kind,
          targetId: document.id,
          metadata: { articleId: document.articleId, locale: document.locale },
        });
      }
      // A signed URL always attaches; previewing is served from here so it can answer
      // range requests from the same private storage.
      const signedUrl = await privateDownloadUrl(document.storageKey, filename, document.mimeType);
      if (signedUrl) {
        return new Response(null, { status: 307, headers: { location: signedUrl, ...DOCUMENT_ROBOTS } });
      }
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const file = range
      ? await readPrivateFileRange(document.storageKey, start, end)
      : await readPrivateFile(document.storageKey);
    const headers: Record<string, string> = {
      "content-type": document.mimeType,
      "content-length": String(file.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "accept-ranges": "bytes",
      etag,
      "last-modified": document.updatedAt.toUTCString(),
      "cache-control": inline ? CACHE_PREVIEW : CACHE_DOWNLOAD,
      ...DOCUMENT_ROBOTS,
    };
    if (range) headers["content-range"] = `bytes ${start}-${start + file.byteLength - 1}/${size}`;
    return new Response(new Uint8Array(file), { status: range ? 206 : 200, headers });
  } catch {
    return new Response("Document file is unavailable.", { status: 404, headers: DOCUMENT_ROBOTS });
  }
}
