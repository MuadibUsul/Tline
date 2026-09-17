import "dotenv/config";
import { prisma } from "../src/lib/db";
import { readPrivateFile } from "../src/lib/documents/storage";
import { extractPdf } from "../src/lib/documents/extractPdf";
import { isCallToActionOnly, resolveDocumentTitle } from "../src/lib/ingest/documentTitle";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { completeJSON } from "../src/lib/llm/provider";
import { protectTitleDates, restoreTitleDates } from "../src/lib/translation/titleDates";

/**
 * Recovers titles for reports already stored under a button label or a filename.
 *
 *   npm run retitle -- --dry-run     inspect what would change
 *   npm run retitle
 *
 * Ingest now reads a title from the document itself, but that only helps what it fetches
 * next. These reports are already here, and their PDFs are already stored, so the title
 * can be recovered without going back to the publisher or re-running any analysis.
 *
 * The Chinese title is translated on its own rather than by re-translating the report:
 * the body is unaffected by the correction, and re-running it would spend the model on
 * work already done.
 */

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/**
 * A stored title that names nothing: a button, a section label, or a bare slug.
 *
 * Deliberately narrow. The filename test used at ingest treats any run of digits as
 * meaningless, which is right for "daily08032026" and wrong for "US Rates Weekly
 * 20260821" — a real title that happens to carry a date. Here the question is only
 * whether anything descriptive survives once the numbers are set aside.
 */
function unusable(title: string) {
  if (isCallToActionOnly(title)) return true;
  if (/[一-鿿]/.test(title)) return false;
  // A publisher that wrapped the real title inside the instruction — which is how
  // `Download the PDF "Ongoing Developments Part 1"` went live, indexed under the label
  // while its subject sat in the quotes. The instruction is stripped on the way in, but
  // only for pages fetched after that rule existed, so a stored title still carrying a
  // quoted phrase of three words or more is a wrapper that needs unwrapping. One word in
  // quotes is a normal headline quoting a term, and is left alone.
  const quoted = /["“”「『]\s*([^"“”「」『』]{6,180}?)\s*["”」』]/.exec(title);
  if (quoted && quoted[1].trim().split(/\s+/).length >= 3) return true;
  // Two descriptive words is the bar. Set the digits aside first: a date in the title is
  // not what makes it uninformative.
  const words = title.replace(/[0-9]+/g, " ").split(/[\s·|:–—-]+/).filter((word) => /[a-z]/i.test(word) && word.length > 1);
  return words.length < 2;
}

async function translateTitle(english: string): Promise<string | null> {
  const provider = await resolveLLMProvider("retitle");
  if (!provider) return null;
  // Dates are placed before translation and restored after, so a model cannot reformat
  // "2 September 2026" into something that no longer reads as that day.
  const dates: string[] = [];
  const protectedTitle = protectTitleDates(english, dates);
  try {
    const response = await completeJSON<{ title?: string }>(provider, {
      system:
        "Translate the title of an institutional research report from English into professional Simplified Chinese. " +
        "Keep tickers, numbers and placeholder tokens exactly as they appear. Return ONLY JSON: {\"title\":string}.",
      user: JSON.stringify({ title: protectedTitle }),
      maxTokens: 200,
    });
    const translated = response.value.title?.trim();
    return translated ? restoreTitleDates(translated, dates) : null;
  } catch {
    return null;
  }
}

async function main() {
  const limit = Math.max(1, Number(arg("limit") || 100));
  const dryRun = flag("dry-run");

  const candidates = await prisma.article.findMany({
    where: { documents: { some: { kind: "source_native", status: "ready" } } },
    include: {
      documents: { where: { kind: "source_native", status: "ready" }, take: 1 },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { id: true, title: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 1000,
  });

  let repaired = 0;
  let skipped = 0;
  for (const article of candidates) {
    if (repaired >= limit) break;
    if (!unusable(article.title)) continue;
    const document = article.documents[0];
    if (!document) continue;

    let recovered = "";
    try {
      const extracted = await extractPdf(await readPrivateFile(document.storageKey));
      const filename = decodeURIComponent(new URL(document.sourceUrl ?? "https://x/y.pdf").pathname.split("/").pop() || "")
        .replace(/\.pdf$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      // The stored title is what is being replaced, so it is not offered as a source.
      recovered = resolveDocumentTitle({ blocks: extracted.blocks, filename });
    } catch (error) {
      console.warn(`  SKIP ${article.id} · ${String(error).slice(0, 80)}`);
      skipped++;
      continue;
    }

    if (!recovered || recovered === article.title || unusable(recovered)) {
      skipped++;
      continue;
    }

    const translation = article.translations[0];
    const zh = dryRun || !translation ? null : await translateTitle(recovered);

    console.log(`  ${dryRun ? "WOULD" : "FIX  "} ${article.id}`);
    console.log(`        ${article.title}  ->  ${recovered}`);
    if (translation) console.log(`        ${translation.title}  ->  ${zh ?? "(译文未变更)"}`);

    if (!dryRun) {
      await prisma.article.update({ where: { id: article.id }, data: { title: recovered } });
      if (translation && zh) {
        await prisma.articleTranslation.update({ where: { id: translation.id }, data: { title: zh } });
      }
    }
    repaired++;
  }

  console.log(JSON.stringify({ event: "retitle.complete", repaired, skipped, dryRun }));
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
