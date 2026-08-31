import { prisma } from "../db";
import { urlHash, titleHash, contentHash } from "../hash";
import { isJunk, looksLikeArticle, type Segment } from "./extract";
import { ASSETS } from "../assets";
import { partitionArticleSegments } from "../articleText";

export interface RawArticle {
  title: string;
  text: string;
  sourceUrl: string;
  author?: string | null;
  publishedAt: Date;
  language?: string;
  segments?: Segment[];
  disclaimerText?: string | null;
  strict?: boolean; // true for HTML-extracted pages → enforce the full article check
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
