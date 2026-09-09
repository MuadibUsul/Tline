import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateArticleDocuments } from "../src/lib/documents/pdf";
import { extractPdf } from "../src/lib/documents/extractPdf";
import { getDocumentStorage } from "../src/lib/documents/storage";
import { isAccessGateText } from "../src/lib/ingest/extract";

const OBSCURED_ARTICLE_IDS = [
  "cmtrisals0013t3h5yyy6rlh1",
  "cmtrihzsy000x7h7xlmxoi9f8",
  "cmtr781es000murz6175y314v",
  "cmttbd7gm000m5wo2xdhi6sym",
];

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

/** Remove reported gate screenshots once their readable English PDF exists. */
async function purgeObscuredNativePdfs() {
  const documents = await prisma.articleDocument.findMany({
    where: {
      articleId: { in: OBSCURED_ARTICLE_IDS },
      kind: "source_native",
      article: { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
    },
    select: { id: true, storageKey: true },
  });
  const storage = getDocumentStorage();
  let purged = 0;
  for (const document of documents) {
    try {
      const extracted = await extractPdf(await storage.get(document.storageKey));
      if (!isAccessGateText(extracted.text)) continue;
      await prisma.articleDocument.delete({ where: { id: document.id } });
      await storage.remove(document.storageKey);
      purged++;
    } catch (error) {
      console.warn(`  obscured PDF audit failed for ${document.id}`, error);
    }
  }
  return purged;
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
  const obscured = await purgeObscuredNativePdfs();
  if (obscured) console.log(JSON.stringify({ event: "documents.obscured.purged", count: obscured }));
  console.log(`Documents complete: ${ready} ready · ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
