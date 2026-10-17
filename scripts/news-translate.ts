import "dotenv/config";
import { prisma } from "../src/lib/db";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { missingNewsTranslation, newsImagesNeedTranslation, translateNewsPost } from "../src/lib/translation/news";

/**
 * Fill the edition that a published news item is missing.
 *
 * News is written at the desk in whichever language the editor used; the other edition must
 * carry the same item or the two front pages diverge. This command is safe to run on every
 * scheduler tick: it only selects posts that still lack a title or body, and a post with
 * both languages is invisible to it.
 */
function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const provider = await resolveLLMProvider("translation");
  if (!provider) {
    console.log("No translation provider is configured, or the translation task is switched off. Nothing to do.");
    return;
  }
  const limit = Math.max(1, Number(arg("limit") || 20));
  const concurrency = Math.min(4, Math.max(1, Number(arg("concurrency") || 2)));
  const ids = (arg("ids") || arg("id") || "").split(",").filter(Boolean);

  const candidates = await prisma.newsPost.findMany({
    where: {
      status: "published",
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    select: {
      id: true, titleZh: true, titleEn: true, bodyZh: true, bodyEn: true, publishedAt: true,
      images: { select: { id: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true } },
    },
    // The newsroom is small (a few items a day), so filter the complete set rather than a
    // sample of the newest rows: a run of bilingual posts must not hide an older item that
    // still lacks one edition.
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
  });
  const work = candidates
    .filter((post) => missingNewsTranslation(post) || newsImagesNeedTranslation(post.images))
    .slice(0, limit);

  let translated = 0;
  let failed = 0;
  for (let offset = 0; offset < work.length; offset += concurrency) {
    await Promise.all(work.slice(offset, offset + concurrency).map(async (post) => {
      try {
        const result = await translateNewsPost(post.id, provider);
        if (result) {
          translated++;
          console.log(`  OK   ${post.id} → ${result.target}`);
        }
      } catch (error) {
        failed++;
        console.error(`  FAIL ${post.id}`, error);
      }
    }));
  }
  console.log(JSON.stringify({
    event: "news.translate.done",
    candidates: candidates.length,
    selected: work.length,
    translated,
    failed,
  }));
  if (failed > 0 && translated === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
