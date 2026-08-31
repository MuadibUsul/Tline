import { prisma } from "../db";
import { urlHash, titleHash, contentHash } from "../hash";
import { isJunk, looksLikeArticle, type ExtractedFigure, type Segment } from "./extract";
import { ASSETS } from "../assets";
import { partitionArticleSegments } from "../articleText";
import { writePrivateFile } from "../documents/storage";

export interface RawArticle {
  title: string;
  text: string;
  sourceUrl: string;
  author?: string | null;
  publishedAt: Date;
  language?: string;
  segments?: Segment[];
  figures?: ExtractedFigure[];
  disclaimerText?: string | null;
  strict?: boolean; // true for HTML-extracted pages → enforce the full article check
}

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

/**
 * Download an article's inline figures and replace its stored figure rows.
 * Network is injected (fetchImage) so this module stays dependency-light; figures
 * are anchored by body-segment index, identical for the English and Chinese renders.
 */
export async function persistArticleFigures(
  articleId: string,
  figures: ExtractedFigure[],
  fetchImage: (url: string) => Promise<{ buffer: Buffer; mimeType: string } | null>,
  onFetch?: () => Promise<void>,
): Promise<number> {
  const stored: Array<{ afterSegmentPosition: number; ordinal: number; storageKey: string; mimeType: string; sourceUrl: string; alt: string | null; caption: string | null; byteSize: number }> = [];
  const ordinals = new Map<number, number>();
  let index = 0;
  for (const figure of figures) {
    if (onFetch) await onFetch();
    const image = await fetchImage(figure.url);
    if (!image) continue;
    const ext = MIME_EXT[image.mimeType] ?? "img";
    const storageKey = `figures/${articleId}/${index++}.${ext}`;
    await writePrivateFile(storageKey, image.buffer);
    const ordinal = ordinals.get(figure.afterSegmentPosition) ?? 0;
    ordinals.set(figure.afterSegmentPosition, ordinal + 1);
    stored.push({
      afterSegmentPosition: figure.afterSegmentPosition,
      ordinal,
      storageKey,
      mimeType: image.mimeType,
      sourceUrl: figure.url,
      alt: figure.alt,
      caption: figure.caption,
      byteSize: image.buffer.byteLength,
    });
  }
  await prisma.$transaction([
    prisma.articleFigure.deleteMany({ where: { articleId } }),
    ...(stored.length ? [prisma.articleFigure.createMany({ data: stored.map((figure) => ({ articleId, ...figure })) })] : []),
  ]);
  return stored.length;
}

/** Idempotent seed of the asset dictionary. */
export async function ensureAssets() {
  for (const a of ASSETS) {
    await prisma.asset.upsert({
      where: { ticker: a.ticker },
      create: { ticker: a.ticker, name: a.name, assetClass: a.assetClass, aliases: JSON.stringify(a.aliases) },
      update: { name: a.name, assetClass: a.assetClass, aliases: JSON.stringify(a.aliases) },
    });
  }
}

export type PersistResult = "created" | "updated" | "duplicate" | "empty";

export async function persistArticle(
  institutionId: string,
  raw: RawArticle,
): Promise<PersistResult> {
  const partitioned = partitionArticleSegments(raw.segments?.length ? raw.segments : [{ heading: null, text: raw.text }]);
  const text = partitioned.body.map((segment) => segment.text).join("\n\n").trim();
  if (!raw.title || text.length < 120) return "empty";
  // Cleaning gate: reject nav/menu dumps always; enforce the full article
  // check for extracted HTML pages.
  if (isJunk(text)) return "empty";
  if (raw.strict && !looksLikeArticle(raw.title, text)) return "empty";

  const uHash = urlHash(raw.sourceUrl);
  const tHash = titleHash(raw.title);
  const cHash = contentHash(text);

  const sameUrl = await prisma.article.findUnique({
    where: { urlHash: uHash },
    select: { id: true, title: true, rawText: true, contentHash: true, disclaimerText: true },
  });
  if (sameUrl) {
    if (sameUrl.rawText === text) {
      const titleChanged = raw.title !== sameUrl.title;
      const disclaimerChanged = (raw.disclaimerText ?? partitioned.disclaimer) !== sameUrl.disclaimerText;
      if (titleChanged || disclaimerChanged) {
        await prisma.$transaction(async (tx) => {
          if (titleChanged) {
            await tx.articleTranslation.deleteMany({ where: { articleId: sameUrl.id } });
            await tx.articleDocument.deleteMany({ where: { articleId: sameUrl.id, kind: { not: "source_native" } } });
          }
          await tx.article.update({ where: { id: sameUrl.id }, data: {
            ...(titleChanged ? { title: raw.title, titleHash: tHash } : {}),
            disclaimerText: raw.disclaimerText ?? partitioned.disclaimer,
          } });
        });
        return "updated";
      }
      return "duplicate";
    }
    const oldLength = sameUrl.rawText?.length ?? 0;
    const materiallyMoreComplete = text.length - oldLength >= Math.max(500, Math.round(oldLength * 0.1));
    if (!materiallyMoreComplete) return "duplicate";
    await prisma.$transaction(async (tx) => {
      await tx.articleTranslation.deleteMany({ where: { articleId: sameUrl.id } });
      await tx.articleDocument.deleteMany({ where: { articleId: sameUrl.id, kind: { not: "source_native" } } });
      await tx.analysis.deleteMany({ where: { articleId: sameUrl.id } });
      await tx.articleAsset.deleteMany({ where: { articleId: sameUrl.id } });
      await tx.atomicView.deleteMany({ where: { articleId: sameUrl.id } });
      await tx.articleSegment.deleteMany({ where: { articleId: sameUrl.id } });
      await tx.article.update({
        where: { id: sameUrl.id },
        data: {
          title: raw.title,
          author: raw.author ?? null,
          publishedAt: raw.publishedAt,
          titleHash: tHash,
          contentHash: cHash,
          rawText: text,
          disclaimerText: raw.disclaimerText ?? partitioned.disclaimer,
          segments: { create: partitioned.body.map((segment, position) => ({ position, heading: segment.heading, text: segment.text })) },
        },
      });
    });
    return "updated";
  }

  const duplicateContent = await prisma.article.findFirst({
    where: { OR: [{ titleHash: tHash }, { contentHash: cHash }] },
    select: { id: true },
  });
  if (duplicateContent) return "duplicate";

  await prisma.article.create({
    data: {
      institutionId,
      title: raw.title,
      author: raw.author ?? null,
      publishedAt: raw.publishedAt,
      sourceUrl: raw.sourceUrl,
      language: raw.language ?? "en",
      urlHash: uHash,
      titleHash: tHash,
      contentHash: cHash,
      rawText: text,
      disclaimerText: raw.disclaimerText ?? partitioned.disclaimer,
      segments: {
        create: partitioned.body.map((segment, position) => ({
          position,
          heading: segment.heading,
          text: segment.text,
        })),
      },
    },
  });
  return "created";
}
