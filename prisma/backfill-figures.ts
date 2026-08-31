import "dotenv/config";
import { prisma } from "../src/lib/db";
import { extractArticle } from "../src/lib/ingest/extract";
import { fetchImage, fetchText, sleep } from "../src/lib/ingest/fetch";
import { persistArticleFigures } from "../src/lib/ingest/store";

// Backfill inline body figures for already-ingested HTML articles by re-fetching
// their source page and re-extracting images. Native-PDF articles are skipped
// (their downloadable PDFs already carry the original figures).
function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const ids = (arg("ids") || arg("id") || "").split(",").filter(Boolean);
  const limit = Math.max(1, Number(arg("limit") || 50));
  const delayMs = Math.max(500, Number(arg("delay") || 1200));
  const onlyMissing = process.argv.includes("--only-missing");

  const articles = await prisma.article.findMany({
    where: ids.length ? { id: { in: ids } } : {},
    select: { id: true, title: true, sourceUrl: true, _count: { select: { figures: true } } },
    orderBy: { publishedAt: "desc" },
    take: ids.length ? undefined : limit * 3,
  });

  let processed = 0, withFigures = 0, totalFigures = 0;
  for (const article of articles) {
    if (processed >= limit && !ids.length) break;
    if (onlyMissing && article._count.figures > 0) continue;
    if (/\.pdf(?:$|\?)/i.test(article.sourceUrl)) continue;
    processed++;
    try {
      const html = await fetchText(article.sourceUrl);
      if (!html) { console.log(`  MISS ${article.id} · no HTML`); continue; }
      const extracted = extractArticle(html, article.sourceUrl);
      if (extracted.figures.length === 0) { console.log(`  none ${article.title}`); continue; }
      const stored = await persistArticleFigures(article.id, extracted.figures, fetchImage, async () => { await sleep(delayMs); });
      if (stored > 0) { withFigures++; totalFigures += stored; console.log(`  +${stored} ${article.title}`); }
      else console.log(`  0    ${article.title} (images unreachable)`);
    } catch (error) {
      console.warn(`  FAIL ${article.id} · ${String(error)}`);
    }
    await sleep(delayMs);
  }
  console.log(`\nBackfill complete: ${processed} processed · ${withFigures} gained figures · ${totalFigures} images stored.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
