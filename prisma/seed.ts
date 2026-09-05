import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { ensureAssets } from "../src/lib/ingest/store";

interface InstSeed {
  slug: string;
  name: string;
  researchUrl: string;
  rating: number;
  authorityScore: number;
  priority: number;
  updateFreq?: string;
  language: string;
  rssUrl?: string;
  sitemapUrl?: string;
  requiresRender?: boolean;
  crawlIntervalSec?: number;
}

interface Policy { policy: string; crawlDelay: number | null }

async function main() {
  const file = join(process.cwd(), "data", "institutions.json");
  const list: InstSeed[] = JSON.parse(readFileSync(file, "utf-8"));

  // Compliance policy from the robots audit (same source of truth as the Excel).
  let policies: Record<string, Policy> = {};
  try {
    policies = JSON.parse(readFileSync(join(process.cwd(), "data", "crawl_policy.json"), "utf-8"));
  } catch {
    console.warn("  (no crawl_policy.json — defaulting all to 'allowed'; run scripts/robots_audit.py)");
  }

  for (const i of list) {
    const pol = policies[i.slug];
    const crawlPolicy = pol?.policy ?? "allowed";
    const crawlDelay = pol?.crawlDelay ?? null;
    await prisma.institution.upsert({
      where: { slug: i.slug },
      create: {
        slug: i.slug,
        name: i.name,
        researchUrl: i.researchUrl,
        rating: i.rating,
        authorityScore: i.authorityScore,
        priority: i.priority,
        updateFreq: i.updateFreq ?? null,
        language: i.language,
        rssUrl: i.rssUrl ?? null,
        sitemapUrl: i.sitemapUrl ?? null,
        requiresRender: i.requiresRender ?? false,
        crawlIntervalSec: i.crawlIntervalSec ?? null,
        crawlPolicy,
        crawlDelay,
      },
      update: {
        name: i.name,
        researchUrl: i.researchUrl,
        rating: i.rating,
        authorityScore: i.authorityScore,
        priority: i.priority,
        rssUrl: i.rssUrl ?? null,
        sitemapUrl: i.sitemapUrl ?? null,
        requiresRender: i.requiresRender ?? false,
        crawlIntervalSec: i.crawlIntervalSec ?? null,
        crawlPolicy,
        crawlDelay,
      },
    });
  }
  await ensureAssets();

  const nInst = await prisma.institution.count();
  const nAsset = await prisma.asset.count();
  console.log(`Seeded ${nInst} institutions · ${nAsset} assets.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
