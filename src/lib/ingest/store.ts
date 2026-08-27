import { prisma } from "../db";
import { urlHash, titleHash, contentHash } from "../hash";
import { parseArticle } from "./parseLLM";
import { isJunk, looksLikeArticle, type Segment } from "./extract";
import { ASSETS } from "../assets";
import { syncForecastsForArticle } from "../forecast";

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

let tickerCache: Map<string, string> | null = null;

export async function assetIdMap(): Promise<Map<string, string>> {
  if (tickerCache) return tickerCache;
  const rows = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  tickerCache = new Map(rows.map((r) => [r.ticker, r.id]));
  return tickerCache;
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
  tickerCache = null;
}

export type PersistResult = "created" | "duplicate" | "empty";

export async function persistArticle(
  institutionId: string,
  institutionName: string,
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

  const parsed = await parseArticle({
    institution: institutionName,
    title: raw.title,
    text,
    publishedAt: raw.publishedAt.toISOString(),
  }, raw.segments);

  const tickers = await assetIdMap();

  const article = await prisma.article.create({
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
      analysis: {
        create: {
          summary: parsed.summary,
          summaryZh: parsed.summaryZh,
          keyArguments: JSON.stringify(parsed.keyArguments),
          keyArgumentsZh: JSON.stringify(parsed.keyArgumentsZh),
          keyNumbers: JSON.stringify(parsed.keyNumbers),
          keyNumbersZh: JSON.stringify(parsed.keyNumbersZh),
          risks: JSON.stringify(parsed.risks),
          risksZh: JSON.stringify(parsed.risksZh),
          interpretation: parsed.interpretation,
          interpretationZh: parsed.interpretationZh,
          importanceScore: parsed.importanceScore,
          confidence: parsed.confidence,
          provider: parsed.provider,
          model: parsed.model,
          promptVersion: parsed.promptVersion,
          reviewStatus: parsed.reviewStatus,
        },
      },
      segments: {
        create: (raw.segments?.length ? raw.segments : [{ heading: null, text }]).map((segment, position) => ({
          position,
          heading: segment.heading,
          text: segment.text,
        })),
      },
      articleAssets: {
        create: parsed.assets
          .filter((a) => tickers.has(a.ticker))
          .map((a) => ({
            assetId: tickers.get(a.ticker)!,
            direction: a.direction,
            target: a.target ?? null,
            previousTarget: a.previousTarget ?? null,
            timeHorizon: a.timeHorizon ?? null,
            confidence: a.confidence,
          })),
      },
      atomicViews: {
        create: parsed.atomicViews.map((view, position) => ({
          position,
          viewEn: view.viewEn,
          viewZh: view.viewZh,
          type: view.type,
          asset: view.asset,
          assetTicker: view.assetTicker,
          topic: view.topic,
          direction: view.direction,
          timeHorizon: view.timeHorizon,
          value: view.value,
          conditionEn: view.conditionEn,
          conditionZh: view.conditionZh,
          rationaleEn: view.rationaleEn,
          rationaleZh: view.rationaleZh,
          confidence: view.confidence,
          importance: view.importance,
          sourceQuote: view.sourceQuote,
          provider: parsed.provider,
          model: parsed.model,
          promptVersion: parsed.promptVersion,
          reviewStatus: parsed.reviewStatus,
        })),
      },
    },
  });
  await syncForecastsForArticle(article.id);
  return "created";
}
