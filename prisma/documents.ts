import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateArticleDocuments } from "../src/lib/documents/pdf";
import { getDocumentStorage } from "../src/lib/documents/storage";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/**
 * Removes Chinese PDFs produced before they were discontinued.
 *
 * Runs as part of the ordinary pass rather than as a migration someone has to remember:
 * once none are left the query costs nothing, and until then every deployment cleans
 * itself up. Rows go first — a file without its row is invisible, whereas a row whose
 * file has gone is a download that fails.
 */
async function purgeTranslatedPdfs(limit: number) {
  const stale = await prisma.articleDocument.findMany({
    where: { kind: "translation_pdf" },
    select: { id: true, storageKey: true },
    take: limit,
  });
  if (stale.length === 0) return 0;

  await prisma.articleDocument.deleteMany({ where: { id: { in: stale.map((document) => document.id) } } });
  const storage = getDocumentStorage();
  for (const document of stale) {
    try {
      await storage.remove(document.storageKey);
    } catch (error) {
      console.warn(`  file left behind for removed document ${document.id}`, error);
    }
  }
  return stale.length;
}

async function main() {
  const articleId = arg("id");
  const limit = Math.max(1, Number(arg("limit") || 20));
  const articles = await prisma.article.findMany({
    where: articleId
      ? { id: articleId, rawText: { not: null } }
      : {
          rawText: { not: null },
          documents: { none: { kind: "original_pdf", locale: "en", status: "ready" } },
        },
    select: { id: true, title: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  const purged = await purgeTranslatedPdfs(200);
  if (purged) console.log(JSON.stringify({ event: "documents.translated.purged", count: purged }));

  let ready = 0;
  let failed = 0;
  for (const article of articles) {
    try {
      await generateArticleDocuments(article.id);
      ready++;
      console.log(`  OK   ${article.id} · EN · ${article.title}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL ${article.id} · ${article.title}`, error);
    }
  }
  console.log(`Documents complete: ${ready} ready · ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
