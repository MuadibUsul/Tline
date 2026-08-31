import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hasGarbledTitleDate, repairChineseTitleDate } from "../src/lib/translation/titleDates";

// One-off repair: rewrite garbled/foreign date fragments in stored zh-CN titles
// (e.g. "31年2026月") using the intact English source title. No LLM calls.
async function main() {
  const rows = await prisma.articleTranslation.findMany({
    where: { locale: "zh-CN" },
    select: { id: true, title: true, article: { select: { title: true } } },
  });
  let fixed = 0;
  for (const row of rows) {
    if (!hasGarbledTitleDate(row.title)) continue;
    const repaired = repairChineseTitleDate(row.title, row.article.title);
    if (repaired === row.title) {
      console.log(`  SKIP (unrecoverable) ${JSON.stringify(row.title)} · EN ${JSON.stringify(row.article.title)}`);
      continue;
    }
    await prisma.articleTranslation.update({ where: { id: row.id }, data: { title: repaired } });
    console.log(`  FIX  ${JSON.stringify(row.title)} -> ${JSON.stringify(repaired)}`);
    fixed++;
  }
  console.log(`Title-date repair complete: ${fixed} translation title(s) updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
