import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateDownloadUrl, readPrivateFile } from "@/lib/documents/storage";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { trackServerEvent } from "@/lib/analytics/serverEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
const DOCUMENT_ROBOTS = { "x-robots-tag": "noindex, nofollow" };

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
    return new Response("Document not found.", { status: 404 });
  }
  const user = await getSessionUser();
  if (!can(user, "document.download.original")) return new Response("Forbidden.", { status: 403 });

  // Previewing asks for the same bytes shown in place rather than saved, so the only
  // difference is the disposition.
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  try {
    const filename = safeFilename(document.article.title, document.locale);
    // Counted for everyone, signed in or not: the audit log records who acted, this
    // records that the document was wanted.
    trackServerEvent(inline ? "document.preview" : "document.download", request.headers, {
      userId: user?.id ?? null,
      path: `/research/${document.articleId}`,
      metadata: { kind: document.kind, locale: document.locale },
    });
    if (user) {
      await writeAudit({
        actorId: user.id,
        action: inline ? "document.preview" : "document.download",
        targetType: document.kind,
        targetId: document.id,
        metadata: { articleId: document.articleId, locale: document.locale },
      });
    }
    // A signed URL always attaches; previewing has to be served from here instead.
    const signedUrl = inline ? null : await privateDownloadUrl(document.storageKey, filename, document.mimeType);
    if (signedUrl) {
      return new Response(null, { status: 307, headers: { location: signedUrl, ...DOCUMENT_ROBOTS } });
    }
    const file = await readPrivateFile(document.storageKey);
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(file.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "private, no-store",
        ...DOCUMENT_ROBOTS,
      },
    });
  } catch {
    return new Response("Document file is unavailable.", { status: 404 });
  }
}
