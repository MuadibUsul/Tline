import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { publicationReadyWhere } from "../src/lib/publication";

/**
 * Do the two editions carry the same content?
 *
 * The gate decides an article's language availability, and the newsroom decides a news
 * item's from its title columns. Both are allowed to differ while a translation is pending,
 * but after a completed pass they must describe one set. This prints the difference and,
 * with --strict, fails the process so a scheduled check can report it.
 */
async function ids(where: Prisma.ArticleWhereInput) {
  const rows = await prisma.article.findMany({ where, select: { id: true, title: true }, orderBy: { publishedAt: "desc" } });
  return rows;
}

async function main() {
  const [en, zh] = await Promise.all([
    ids(publicationReadyWhere(undefined, "en")),
    ids(publicationReadyWhere(undefined, "zh-CN")),
  ]);
  const enIds = new Set(en.map((row) => row.id));
  const zhIds = new Set(zh.map((row) => row.id));
  const onlyEn = en.filter((row) => !zhIds.has(row.id));
  const onlyZh = zh.filter((row) => !enIds.has(row.id));

  const news = await prisma.newsPost.findMany({
    where: { status: "published", publishedAt: { lte: new Date() } },
    select: { id: true, titleZh: true, titleEn: true, slug: true },
    orderBy: { publishedAt: "desc" },
  });
  const newsEn = news.filter((post) => Boolean(post.titleEn?.trim()));
  const newsZh = news.filter((post) => Boolean(post.titleZh?.trim()));
  const newsEnIds = new Set(newsEn.map((post) => post.id));
  const newsZhIds = new Set(newsZh.map((post) => post.id));
  const newsOnlyEn = newsEn.filter((post) => !newsZhIds.has(post.id));
  const newsOnlyZh = newsZh.filter((post) => !newsEnIds.has(post.id));

  const result = {
    research: {
      en: en.length,
      zh: zh.length,
      onlyEn: onlyEn.length,
      onlyZh: onlyZh.length,
      onlyEnSamples: onlyEn.slice(0, 10).map((row) => ({ id: row.id, title: row.title })),
      onlyZhSamples: onlyZh.slice(0, 10).map((row) => ({ id: row.id, title: row.title })),
    },
    news: {
      en: newsEn.length,
      zh: newsZh.length,
      onlyEn: newsOnlyEn.length,
      onlyZh: newsOnlyZh.length,
      onlyEnSamples: newsOnlyEn.slice(0, 10).map((post) => post.slug),
      onlyZhSamples: newsOnlyZh.slice(0, 10).map((post) => post.slug),
    },
  };
  console.log(JSON.stringify(result, null, 2));

  const mismatch = onlyEn.length + onlyZh.length + newsOnlyEn.length + newsOnlyZh.length;
  if (mismatch > 0) process.exitCode = process.argv.includes("--strict") ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
