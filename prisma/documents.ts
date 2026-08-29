import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateArticleDocuments } from "../src/lib/documents/pdf";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const articleId = arg("id");
  const limit = Math.max(1, Number(arg("limit") || 20));
  const articles = await prisma.article.findMany({
    where: articleId
      ? { id: articleId, rawText: { not: null } }
      : {
          rawText: { not: null },
          OR: [
            { documents: { none: { kind: "original_pdf", locale: "en", status: "ready" } } },
            {
              translations: { some: { locale: "zh-CN", status: "reviewed" } },
              documents: { none: { kind: "translation_pdf", locale: "zh-CN", status: "ready" } },
            },
          ],
        },
    select: { id: true, title: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  let ready = 0;
  let failed = 0;
  for (const article of articles) {
    try {
      const result = await generateArticleDocuments(article.id);
      ready += result.translated ? 2 : 1;
      console.log(`  OK   ${article.id} · EN${result.translated ? " + ZH" : ""} · ${article.title}`);
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
