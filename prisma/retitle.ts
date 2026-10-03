import "dotenv/config";
import { refreshGate } from "../src/lib/gate";
import { prisma } from "../src/lib/db";
import { readPrivateFile } from "../src/lib/documents/storage";
import { extractPdf } from "../src/lib/documents/extractPdf";
import { isCallToActionOnly, resolveDocumentTitle, unwrapCallToActionTitle } from "../src/lib/ingest/documentTitle";
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

  /**
   * Every report whose stored title is a label, not only those with a stored PDF.
   *
   * The document used to be the only source a title could be recovered from, so the query
   * asked for one. The analysis is a second source: it writes `seoTitle`, the headline the
   * report page already shows a search engine, and for twelve Westpac and BNP reports that
   * were headed "Pdf File Morning Report PDF" it holds a distinct, accurate subject —
   * "Brent Crude at $108.5 as Saudi Pipeline Shutdown Lifts Oil", "WTI Falls 4.9% to $95 as
   * Saudi Exports Rise". Requiring a PDF left those twelve withheld for no reason, because
   * three of the reports have no stored native PDF at all.
   */
  const candidates = await prisma.article.findMany({
    include: {
      documents: { where: { kind: "source_native", status: "ready" }, take: 1 },
      analysis: { select: { seoTitle: true } },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { id: true, title: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 2000,
  });

  // Pass one: recover what can be recovered and collect proposals. Nothing is written yet,
  // because a recovered title is only trustworthy once it can be compared with the others.
  //
  // Two sources are offered per report rather than one, because the choice between them is
  // not knowable until the claims are counted. The document's running head is the better
  // wording, but a recurring daily publication reads the same head off every issue — which
  // is exactly what happens to nineteen Westpac morning reports — and only then is the
  // analysis' article-specific headline the one to use. Deciding that here, before the
  // count, meant the fallback was never reached for the reports that needed it most.
  const proposals: Array<{ id: string; before: string; recovered?: string; source?: "document" | "analysis"; options: Array<{ value: string; source: "document" | "analysis" }>; translation?: { id: string; title: string } }> = [];
  let skipped = 0;
  for (const article of candidates) {
    if (proposals.length >= limit) break;
    if (!unusable(article.title)) continue;

    const viable = (value: string | null | undefined) =>
      Boolean(value && value.trim() && value.trim() !== article.title.trim() && !unusable(value.trim()));

    const options: Array<{ value: string; source: "document" | "analysis" }> = [];
    const document = article.documents[0];
    if (document) {
      try {
        const extracted = await extractPdf(await readPrivateFile(document.storageKey));
        const filename = decodeURIComponent(new URL(document.sourceUrl ?? "https://x/y.pdf").pathname.split("/").pop() || "")
          .replace(/\.pdf$/i, "")
          .replace(/[-_]+/g, " ")
          .trim();
        // The stored title is what is being replaced, so it is not offered as a source.
        const recovered = resolveDocumentTitle({ blocks: extracted.blocks, filename });
        if (viable(recovered)) options.push({ value: recovered.trim(), source: "document" });
      } catch (error) {
        console.warn(`  SKIP-PDF ${article.id} · ${String(error).slice(0, 80)}`);
      }
    }
    // The publisher's own words, where the instruction they were wrapped in is still on the
    // front: `Download the PDF “Fueling Resilience”` is a real headline behind a button.
    //
    // The instruction has to be the whole of what precedes the quote. A headline is allowed
    // to quote a term — “Will bond market concerns about “responsible proactive fiscal
    // policy” fade over time?” — and reading the quoted words out of that replaced a
    // finished headline with the phrase it was about, which is the opposite of a repair.
    const wrapped = unwrapCallToActionTitle(article.title);
    if (wrapped && viable(wrapped)) options.push({ value: wrapped, source: "document" });
    // What the analysis read out of the report. It is already what the page shows a search
    // engine, so promoting it to the page's own title is what makes the two agree.
    const fromAnalysis = article.analysis?.seoTitle;
    if (viable(fromAnalysis)) options.push({ value: fromAnalysis!.trim(), source: "analysis" });
    if (!options.length) {
      skipped++;
      continue;
    }
    proposals.push({ id: article.id, before: article.title, options, translation: article.translations[0] });
  }

  /**
   * A title that several reports recover is a template, not a title.
   *
   * A recurring daily publication — thirteen ingestions of one "Morning Report" PDF — all
   * read their heading off the page as the same string. Writing it would give thirteen pages
   * the identical title, which is the duplicate-title problem this command exists downstream
   * of, and would put a generic label in the index where there had been nothing. A recovery
   * unique to one report is trusted; a shared one falls through to the next source.
   */
  const claims = new Map<string, number>();
  for (const proposal of proposals) for (const option of proposal.options) claims.set(option.value, (claims.get(option.value) ?? 0) + 1);
  const existing = new Set((await prisma.article.findMany({ select: { title: true } })).map((row) => row.title.trim().toLowerCase()));

  let repaired = 0;
  for (const proposal of proposals) {
    const chosen: { value: string; source: "document" | "analysis" } | undefined = proposal.options.find((option) =>
      (claims.get(option.value) ?? 0) <= 1 && !existing.has(option.value.toLowerCase()));
    if (!chosen) {
      const best = proposal.options[0];
      const shared = (claims.get(best.value) ?? 0) > 1;
      console.log(`  KEEP ${proposal.id} · recovered title is ${shared ? `shared by ${claims.get(best.value)} reports` : "already another report's title"}: "${best.value}"`);
      skipped++;
      continue;
    }
    proposal.recovered = chosen.value;
    proposal.source = chosen.source;

    const recovered = proposal.recovered!;
    const article = candidates.find((candidate) => candidate.id === proposal.id);
    const translated = dryRun || !proposal.translation || !article
      ? { title: null, gated: false }
      : await translateTitle(recovered, proposal.id, article.contentHash);
    const zh = translated.title;
    console.log(`  ${dryRun ? "WOULD" : "FIX  "} ${proposal.id} · recovered from the ${proposal.source}`);
    console.log(`        ${proposal.before}  ->  ${recovered}`);
    if (proposal.translation) console.log(`        ${proposal.translation.title}  ->  ${zh ?? "(译文未变更)"}`);

    if (!dryRun) {
      await prisma.article.update({ where: { id: proposal.id }, data: { title: recovered } });
      // The title is what `abnormal_title` reads, in both languages, and repairing it is the
      // one thing that can bring a withheld report back without a re-parse.
      await refreshGate(proposal.id);
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
