import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getLLMProvider } from "../src/lib/llm/provider";
import { translateAndPersist } from "../src/lib/translation/translate";
import { generateArticleDocuments } from "../src/lib/documents/pdf";
import { translateNativeDocument } from "../src/lib/documents/extractPdf";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const provider = getLLMProvider(process.env.TRANSLATION_PROVIDER);
  if (!provider) {
    console.log("No translation provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    return;
  }
  const articleId = arg("id");
  const limit = Math.max(1, Number(arg("limit") || 20));
  const rows = await prisma.article.findMany({
    where: articleId ? { id: articleId, rawText: { not: null } } : { rawText: { not: null } },
    select: {
      id: true,
      title: true,
      translations: { where: { locale: "zh-CN" }, select: { status: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
  const candidates = rows
    .filter((article) => flag("all") || article.translations.length === 0 || article.translations[0].status === "needs_review")
    .slice(0, limit);

  let translated = 0;
  let needsReview = 0;
  let failed = 0;
  let nativeLayouts = 0;
  let nativeFallbacks = 0;
  for (const article of candidates) {
    try {
      const result = await translateAndPersist(article.id, provider);
      await generateArticleDocuments(article.id);
      if (result.translation.status === "reviewed") {
        const native = await prisma.articleDocument.findFirst({
          where: { articleId: article.id, kind: "source_native", status: "ready" },
          select: { id: true },
        });
        if (native) {
          try {
            await translateNativeDocument(article.id, result.translation.id, native.id, provider);
            nativeLayouts++;
          } catch (error) {
            nativeFallbacks++;
            console.warn(`  LAYOUT FALLBACK ${article.id} · standard Chinese PDF retained`, error);
          }
        }
      }
      if (result.translation.status === "reviewed") translated++;
      else needsReview++;
      console.log(`  ${result.translation.status === "reviewed" ? "OK  " : "HOLD"} ${article.id} · ${article.title}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL ${article.id} · ${article.title}`, error);
    }
  }
  console.log(`Translation complete: ${translated} reviewed · ${needsReview} needs review · ${failed} failed · ${nativeLayouts} native layouts · ${nativeFallbacks} layout fallbacks.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
