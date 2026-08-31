import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateDownloadUrl, readPrivateFile } from "@/lib/documents/storage";
import { can, type PermissionAction } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(title: string, locale: string) {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return (clean || "research") + "-" + locale + ".pdf";
}

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const document = await prisma.articleDocument.findUnique({
    where: { id: params.id },
    include: { article: { select: { title: true } } },
  });
  if (!document || document.status !== "ready") {
    return new Response("Document not found.", { status: 404 });
  }
  const action: PermissionAction = document.kind === "translation_pdf"
    ? "document.download.translation"
    : "document.download.original";
  const user = await getSessionUser();
  if (!can(user, action)) return new Response("Forbidden.", { status: 403 });

  try {
    const filename = safeFilename(document.article.title, document.locale);
    if (user) {
      await writeAudit({
        actorId: user.id,
        action: "document.download",
        targetType: document.kind,
        targetId: document.id,
        metadata: { articleId: document.articleId, locale: document.locale },
      });
    }
    const signedUrl = await privateDownloadUrl(document.storageKey, filename, document.mimeType);
    if (signedUrl) {
      return Response.redirect(signedUrl, 307);
    }
    const file = await readPrivateFile(document.storageKey);
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(file.byteLength),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("Document file is unavailable.", { status: 404 });
  }
}
