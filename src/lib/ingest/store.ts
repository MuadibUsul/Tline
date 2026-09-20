import { prisma } from "../db";
import { urlHash, titleHash, contentHash } from "../hash";
import { isJunk, looksLikeArticle, type Segment } from "./extract";
import { ASSETS } from "../assets";
import { partitionArticleSegments } from "../articleText";
import { buildResearchSlug } from "../researchPath";
import { classifyDeterministically } from "../classification/classifier";
import { discoverArticleClassification } from "../classification/discovery";
import { articleClassificationSourceFingerprint, persistDeterministicClassification } from "../classification/store";

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
  preferReplacement?: boolean; // publisher PDF supersedes an already stored HTML teaser
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

async function refreshClassification(articleId: string, cHash: string, tHash: string, title: string, text: string) {
  try {
    // Preserve human facets, but put them back in the review queue when their source changed.
    await prisma.contentClassification.updateMany({ where: { articleId, source: "MANUAL" }, data: { status: "REVIEW", fingerprint: null } });
    await persistDeterministicClassification({
      target: { kind: "ARTICLE", id: articleId },
      result: classifyDeterministically(discoverArticleClassification({ title, text })),
      sourceFingerprint: articleClassificationSourceFingerprint(cHash, tHash, []),
      apply: true,
    });
  } catch (error) {
    // Classification is downstream enrichment; it must not turn a stored article into an
    // ingest failure. The deterministic backfill can repair this row later.
    console.error(JSON.stringify({ event: "classification.ingest.failed", articleId, error: String(error).slice(0, 300) }));
  }
}

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
    select: { id: true, title: true, rawText: true, contentHash: true, disclaimerText: true, _count: { select: { segments: true } } },
  });
  if (sameUrl) {
    if (sameUrl.rawText === text) {
      const titleChanged = raw.title !== sameUrl.title;
      const disclaimerChanged = (raw.disclaimerText ?? partitioned.disclaimer) !== sameUrl.disclaimerText;
      const layoutImproved = partitioned.body.length > sameUrl._count.segments;
      if (titleChanged || disclaimerChanged || layoutImproved) {
        await prisma.$transaction(async (tx) => {
          if (titleChanged || layoutImproved) {
            await tx.articleTranslation.deleteMany({ where: { articleId: sameUrl.id } });
            await tx.articleDocument.deleteMany({ where: { articleId: sameUrl.id, kind: { not: "source_native" } } });
            // Title is part of every analysis/translation prompt. Keeping derived output
            // after correcting a truncated title leaves the article permanently attached
            // to the bad parse because routine processing only selects missing rows.
            await tx.analysis.deleteMany({ where: { articleId: sameUrl.id } });
            await tx.articleAsset.deleteMany({ where: { articleId: sameUrl.id } });
            await tx.atomicView.deleteMany({ where: { articleId: sameUrl.id } });
          }
          if (layoutImproved) await tx.articleSegment.deleteMany({ where: { articleId: sameUrl.id } });
          await tx.article.update({ where: { id: sameUrl.id }, data: {
            ...(titleChanged ? { title: raw.title, titleHash: tHash } : {}),
            disclaimerText: raw.disclaimerText ?? partitioned.disclaimer,
            ...(layoutImproved ? { segments: { create: partitioned.body.map((segment, position) => ({ position, heading: segment.heading, text: segment.text })) } } : {}),
          } });
        });
        if (titleChanged || layoutImproved) await refreshClassification(sameUrl.id, cHash, tHash, raw.title, text);
        return "updated";
      }
      return "duplicate";
    }
    const oldLength = sameUrl.rawText?.length ?? 0;
    const materiallyMoreComplete = text.length - oldLength >= Math.max(500, Math.round(oldLength * 0.1));
    if (!materiallyMoreComplete && !raw.preferReplacement) return "duplicate";
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
    await refreshClassification(sameUrl.id, cHash, tHash, raw.title, text);
    return "updated";
  }

  // Identical body text is a duplicate wherever it appears — the same report reachable at
  // two URLs.
  //
  // An identical TITLE is not. Research desks publish recurring columns: "FX Daily
  // Snapshot", "Asia FX Talk", "Economic Weekly". Matching on title alone, globally,
  // meant a publisher contributed exactly one article per column name and every later
  // edition was silently discarded as a duplicate. A repeated title is only evidence of
  // duplication when it is the same institution on the same day.
  const duplicateContent = await prisma.article.findFirst({
    where: {
      OR: [
        { contentHash: cHash },
        { titleHash: tHash, institutionId, publishedAt: raw.publishedAt },
      ],
    },
    select: { id: true },
  });
  if (duplicateContent) return "duplicate";

  const institution = await prisma.institution.findUniqueOrThrow({
    where: { id: institutionId },
    select: { name: true },
  });
  const created = await prisma.article.create({
    data: {
      slug: buildResearchSlug({ institution: institution.name, title: raw.title, fingerprint: uHash }),
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
  await refreshClassification(created.id, cHash, tHash, raw.title, text);
  return "created";
}
