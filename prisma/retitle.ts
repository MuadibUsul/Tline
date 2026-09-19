import "dotenv/config";
import { prisma } from "../src/lib/db";
import { readPrivateFile } from "../src/lib/documents/storage";
import { extractPdf } from "../src/lib/documents/extractPdf";
import { isCallToActionOnly, resolveDocumentTitle } from "../src/lib/ingest/documentTitle";
import { isNoiseTitle } from "../src/lib/contentQuality";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { completeJSON } from "../src/lib/llm/provider";
import { protectTitleDates, restoreTitleDates } from "../src/lib/translation/titleDates";
import { buildTaskContext, CONTEXT_BUILDER_VERSION } from "../src/lib/llm/context-builder";
import { decideAiExecution, recordAiExecutionEvent } from "../src/lib/llm/execution-policy";
import { controlledGateAllowsSkip, runRoutingShadow } from "../src/lib/decision/routing";

const RETITLE_PROMPT_VERSION = "retitle-v2";

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
  // The same predicate the index gate withholds on. Two definitions of "this title is a
  // label" meant the repair could never reach twenty-four of the pages the gate had taken
  // out of the index, and nothing said so. One definition, used by both.
  if (isNoiseTitle(title)) return true;
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

async function translateTitle(english: string, contentId: string, contentHash: string): Promise<{ title: string | null; gated: boolean }> {
  const provider = await resolveLLMProvider("retitle");
  if (!provider) return { title: null, gated: false };
  // Dates are placed before translation and restored after, so a model cannot reformat
  // "2 September 2026" into something that no longer reads as that day.
  const dates: string[] = [];
  const protectedTitle = protectTitleDates(english, dates);
  const context = buildTaskContext("retitle", { title: english, text: protectedTitle });
  const policy = decideAiExecution({
    taskType: "retitle", contentId, contentHash,
    promptVersion: RETITLE_PROMPT_VERSION, contextBuilderVersion: CONTEXT_BUILDER_VERSION,
    requestedOutput: "retitle", route: { provider: provider.name, model: provider.model },
  });
  const routing = await runRoutingShadow({ task: "retitle", contentId, title: english, excerpt: protectedTitle, policy });
  if (controlledGateAllowsSkip("retitle", routing)) {
    await recordAiExecutionEvent({
      task: "retitle", contentId,
      policy: { ...policy, executionLevel: "LEVEL_1", requiresLLM: false, reasonCodes: ["DECISION_ONLY"] },
      cacheStatus: "NOT_APPLICABLE", attribution: "JEV_GATE",
      originalEstimatedTokens: context.originalEstimatedTokens, optimizedEstimatedTokens: 0,
    });
    return { title: null, gated: true };
  }
  try {
    const response = await completeJSON<{ title?: string }>(provider, {
      system:
        "Translate the title of an institutional research report from English into professional Simplified Chinese. " +
        "Keep tickers, numbers and placeholder tokens exactly as they appear. Return ONLY JSON: {\"title\":string}.",
      user: JSON.stringify({ title: context.selectedText }),
      maxTokens: 200,
      audit: {
        contentId, requestFingerprint: policy.fingerprint, promptVersion: RETITLE_PROMPT_VERSION,
        executionLevel: policy.executionLevel, contextStrategy: context.strategy, cacheStatus: "MISS",
        reasonCodes: [...policy.reasonCodes, ...context.reasonCodes],
        originalEstimatedTokens: context.originalEstimatedTokens, optimizedEstimatedTokens: context.estimatedTokens,
      },
    });
    await recordAiExecutionEvent({
      task: "retitle", contentId, policy: { ...policy, contextStrategy: context.strategy }, cacheStatus: "MISS",
      originalEstimatedTokens: context.originalEstimatedTokens, optimizedEstimatedTokens: context.estimatedTokens,
    });
    const translated = response.value.title?.trim();
    return { title: translated ? restoreTitleDates(translated, dates) : null, gated: false };
  } catch {
    return { title: null, gated: false };
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

  // Pass one: read the documents and collect proposals. Nothing is written yet, because a
  // recovered title is only trustworthy once it can be compared with the other proposals.
  const proposals: Array<{ id: string; before: string; recovered: string; translation?: { id: string; title: string } }> = [];
  let skipped = 0;
  for (const article of candidates) {
    if (proposals.length >= limit) break;
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
    proposals.push({ id: article.id, before: article.title, recovered, translation: article.translations[0] });
  }

  /**
   * A title that several reports recover is a template, not a title.
   *
   * A recurring daily publication — thirteen ingestions of one "Morning Report" PDF — all
   * read their heading off the page as the same string. Writing it would give thirteen pages
   * the identical title, which is the duplicate-title problem this command exists downstream
   * of, and would put a generic label in the index where there had been nothing. A recovery
   * unique to one report is trusted; a shared one is left for a person.
   */
  const claims = new Map<string, number>();
  for (const proposal of proposals) claims.set(proposal.recovered, (claims.get(proposal.recovered) ?? 0) + 1);
  const existing = new Set((await prisma.article.findMany({ select: { title: true } })).map((row) => row.title.trim().toLowerCase()));

  let repaired = 0;
  for (const proposal of proposals) {
    const shared = (claims.get(proposal.recovered) ?? 0) > 1;
    const collides = existing.has(proposal.recovered.trim().toLowerCase());
    if (shared || collides) {
      console.log(`  KEEP ${proposal.id} · recovered title is ${shared ? `shared by ${claims.get(proposal.recovered)} reports` : "already another report's title"}: "${proposal.recovered}"`);
      skipped++;
      continue;
    }

    const article = candidates.find((candidate) => candidate.id === proposal.id);
    const translated = dryRun || !proposal.translation || !article
      ? { title: null, gated: false }
      : await translateTitle(proposal.recovered, proposal.id, article.contentHash);
    const zh = translated.title;
    console.log(`  ${dryRun ? "WOULD" : "FIX  "} ${proposal.id}`);
    console.log(`        ${proposal.before}  ->  ${proposal.recovered}`);
    if (proposal.translation) console.log(`        ${proposal.translation.title}  ->  ${zh ?? "(译文未变更)"}`);

    if (!dryRun) {
      await prisma.article.update({ where: { id: proposal.id }, data: { title: proposal.recovered } });
      if (proposal.translation && zh) {
        await prisma.articleTranslation.update({ where: { id: proposal.translation.id }, data: { title: zh } });
      } else if (proposal.translation) {
        // The English title changed but no replacement translation was produced. Keep the
        // old text visible only as a review item, never as a silently "reviewed" artifact.
        await prisma.articleTranslation.update({ where: { id: proposal.translation.id }, data: { status: "needs_review" } });
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
