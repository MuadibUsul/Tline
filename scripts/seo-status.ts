import "dotenv/config";
import { prisma } from "../src/lib/db";
import { publicationReadyWhere } from "../src/lib/publication";
import { contentQuality } from "../src/lib/contentQuality";
import { LOCALES } from "../src/lib/i18n";
import { listIndexableTopics } from "../src/lib/topics";

/**
 * What the index actually holds, and what it is withholding.
 *
 *   npm run seo:status               summary by reason
 *   npm run seo:status -- --list     the same, plus every withheld article
 *
 * This exists because a rule that withholds pages is invisible until something measures it.
 * One added rule took a sixth of the report corpus out of the index and nothing in the
 * product said so; the count below is what says so. It reads the same `contentQuality` the
 * sitemap and the page robots tags read, so this is the site's own verdict, not a second
 * opinion that can drift from it.
 */

const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere(),
    select: {
      id: true,
      slug: true,
      title: true,
      rawText: true,
      sourceUrl: true,
      language: true,
      publishedAt: true,
      institution: { select: { name: true } },
      analysis: {
        select: {
          summary: true, summaryZh: true, reviewStatus: true,
          keyArguments: true, keyNumbers: true, risks: true, interpretation: true,
        },
      },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const totals = LOCALES.map((locale) => {
    const reasons = new Map<string, number>();
    const withheld: Array<{ id: string; title: string; institution: string; reasons: string[] }> = [];
    let indexable = 0;
    for (const article of articles) {
      const quality = contentQuality(article, locale);
      if (quality.eligibility === "INDEX") { indexable++; continue; }
      for (const issue of quality.issues) reasons.set(issue, (reasons.get(issue) ?? 0) + 1);
      if (quality.eligibility === "NOINDEX_FOLLOW") {
        withheld.push({ id: article.id, title: article.title, institution: article.institution.name, reasons: quality.issues });
      }
    }
    return { locale, indexable, withheld, reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]) };
  });

  const [topics, assetPages, institutions] = await Promise.all([
    listIndexableTopics(),
    prisma.asset.count({ where: { articleAssets: { some: { article: publicationReadyWhere() } } } }),
    prisma.institution.count({ where: { articles: { some: publicationReadyWhere() } } }),
  ]);

  for (const total of totals) {
    console.log(`${total.locale}: ${total.indexable}/${articles.length} reports indexable, ${total.withheld.length} withheld (crawlable, out of the index)`);
    console.log(`  reasons: ${total.reasons.map(([issue, count]) => `${issue}=${count}`).join(" ") || "none"}`);
  }
  console.log(`pages: ${institutions} institution pages, ${assetPages} asset pages, ${topics.length} topics that clear the threshold`);

  if (flag("list")) {
    for (const total of totals) {
      if (!total.withheld.length) continue;
      console.log(`\n${total.locale} withheld:`);
      for (const item of total.withheld) {
        console.log(`  ${item.id} | ${item.institution} | ${item.title.slice(0, 70)} | ${item.reasons.join(",")}`);
      }
    }
  }

  console.log(JSON.stringify({
    event: "seo.status",
    reports: articles.length,
    indexable: Object.fromEntries(totals.map((total) => [total.locale, total.indexable])),
    withheld: Object.fromEntries(totals.map((total) => [total.locale, total.withheld.length])),
    topics: topics.length,
  }));
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
