import { prisma } from "../db";
import { urlHash, titleHash, contentHash } from "../hash";
import { isJunk, looksLikeArticle, type Segment } from "./extract";
import { ASSETS } from "../assets";

export interface RawArticle {
  title: string;
  text: string;
  sourceUrl: string;
  author?: string | null;
  publishedAt: Date;
  language?: string;
  segments?: Segment[];
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

export type PersistResult = "created" | "duplicate" | "empty";

export async function persistArticle(
  institutionId: string,
  raw: RawArticle,
): Promise<PersistResult> {
  const text = raw.text?.trim() || "";
  if (!raw.title || text.length < 120) return "empty";
  // Cleaning gate: reject nav/menu dumps always; enforce the full article
  // check for extracted HTML pages.
  if (isJunk(text)) return "empty";
  if (raw.strict && !looksLikeArticle(raw.title, text)) return "empty";

  const uHash = urlHash(raw.sourceUrl);
  const tHash = titleHash(raw.title);
  const cHash = contentHash(text);

  const dup = await prisma.article.findFirst({
    where: { OR: [{ urlHash: uHash }, { titleHash: tHash }, { contentHash: cHash }] },
    select: { id: true },
  });
  if (dup) return "duplicate";

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
      segments: {
        create: (raw.segments?.length ? raw.segments : [{ heading: null, text }]).map((segment, position) => ({
          position,
          heading: segment.heading,
          text: segment.text,
        })),
      },
    },
  });
  return "created";
}
