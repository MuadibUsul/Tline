import { prisma } from "@/lib/db";
import { readPrivateFile } from "@/lib/documents/storage";
import { publicationReadyWhere } from "@/lib/publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve an article's inline figure image. Visible only when its article is
// publication-ready — the same gate the article body uses.
export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const figure = await prisma.articleFigure.findUnique({
    where: { id: params.id },
    select: { storageKey: true, mimeType: true, articleId: true },
  });
  if (!figure) return new Response("Not found.", { status: 404 });

  const article = await prisma.article.findFirst({
    where: publicationReadyWhere({ id: figure.articleId }),
    select: { id: true },
  });
  if (!article) return new Response("Not found.", { status: 404 });

  try {
    const file = await readPrivateFile(figure.storageKey);
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": figure.mimeType,
        "content-length": String(file.byteLength),
        "cache-control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Image unavailable.", { status: 404 });
  }
}
