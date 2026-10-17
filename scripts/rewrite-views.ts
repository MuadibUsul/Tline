import "dotenv/config";
import { prisma } from "../src/lib/db";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { isTaskOverBudget } from "../src/lib/llm/budget";
import { completeJSON } from "../src/lib/llm/provider";
import { needsViewRewrite } from "../src/lib/viewQuality";
import { writeAudit } from "../src/lib/audit";

/**
 * Rewrite extracted view fragments into complete, self-contained market views.
 *
 * Extraction sometimes stores a piece of the source's layout — table headers, chart axis
 * runs, a sentence cut mid-name — where a reader expects an opinion. This pass sends each
 * such fragment (with the institution, the report title and the stored source quote as
 * anchors) to the configured model and writes back one complete view in both languages.
 *
 * Safety rails, because this rewrites public copy with a model:
 *  - every numeric token in the rewrite must already appear in the fragment or its source
 *    quote; a rewrite that introduces a number is rejected and the original kept;
 *  - a view the model fails to return as clean bilingual JSON is left untouched;
 *  - spend is recorded through the normal provider wrapper and stops when the analysis
 *    task is over budget.
 *
 *   npx tsx scripts/rewrite-views.ts --dry-run [--limit=200]
 *   npx tsx scripts/rewrite-views.ts [--limit=200]
 *   npx tsx scripts/rewrite-views.ts --ids=<id>,<id>
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const flag = (name: string) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};
const limit = Math.max(1, Number(flag("limit") || 200));
const ids = flag("ids")?.split(",").map((value) => value.trim()).filter(Boolean);

const SYSTEM = `You rewrite an extracted fragment of an institutional research report into ONE complete, self-contained market view that a reader can understand without the source page.

Rules:
- Keep every number exactly as given, with its unit and period. Never invent numbers, targets, levels, dates or forecasts.
- Drop layout noise: table headers, column labels, chart axis numbers, page references like "（图3）", truncated names.
- If the fragment states or implies a direction/stance, state it plainly (看多/看跌/中性 or the asset view's equivalent).
- 1-2 sentences, no markdown, no preamble.
- Output strictly one JSON object: {"zh": "...", "en": "..."} — zh in natural Simplified Chinese financial prose, en its faithful English equivalent.`;

function numericTokens(text: string): string[] {
  return (text.match(/[-−]?\d[\d.,]*/g) ?? []).map((token) => token.replace(/[.,%]/g, "").replace(/^[-−]/, ""));
}

async function main() {
  const rows = ids?.length
    ? await prisma.atomicView.findMany({ where: { id: { in: ids } }, select: viewSelect })
    : await prisma.atomicView.findMany({
        where: { reviewStatus: "ok" },
        orderBy: { createdAt: "desc" },
        take: 1_500,
        select: viewSelect,
      });

  const targets = rows.filter((row) => needsViewRewrite(row, true) || needsViewRewrite(row, false)).slice(0, limit);
  const estimateIn = targets.reduce((sum, row) => sum + Math.ceil(((row.viewZh ?? row.viewEn ?? "").length + (row.viewEn ?? "").length + (row.sourceQuote ?? "").length) / 2) + 400, 0);
  console.log(JSON.stringify({ event: "views.rewrite.plan", scanned: rows.length, targets: targets.length, dryRun, estimatedInputTokens: estimateIn, estimatedOutputTokens: targets.length * 160 }));

  if (dryRun || targets.length === 0) return;
  const provider = await resolveLLMProvider("analysis");
  if (!provider) { console.error("No LLM provider is configured for the analysis task."); process.exitCode = 1; return; }

  let rewritten = 0, rejected = 0, failed = 0, inputTokens = 0, outputTokens = 0;
  for (const [index, row] of targets.entries()) {
    if (index % 20 === 0 && (await isTaskOverBudget("analysis"))) {
      console.log(JSON.stringify({ event: "views.rewrite.budget_stop", at: index }));
      break;
    }
    const fragment = [row.viewZh, row.viewEn].filter(Boolean).join("\n---\n");
    const context = [
      `Institution: ${row.article.institution.name}`,
      `Report: ${row.article.title}`,
      row.assetTicker ? `Asset: ${row.asset} (${row.assetTicker})` : null,
      row.timeHorizon && row.timeHorizon !== "unspecified" ? `Horizon: ${row.timeHorizon}` : null,
      `Extracted fragment:\n${fragment}`,
      row.sourceQuote ? `Source quote (anchor for every number):\n${row.sourceQuote}` : null,
    ].filter(Boolean).join("\n");

    try {
      const { value, meta } = await completeJSON<{ zh?: string; en?: string }>(provider, { system: SYSTEM, user: context, maxTokens: 500 });
      inputTokens += meta.usage?.inputTokens ?? 0;
      outputTokens += meta.usage?.outputTokens ?? 0;
      const zh = (value.zh ?? "").trim();
      const en = (value.en ?? "").trim();
      // The article title is part of the source context: a rewrite may use a year or unit
      // stated there, but nothing beyond it.
      const anchor = `${fragment}\n${row.sourceQuote ?? ""}\n${row.article.title}`;
      const allowed = new Set(numericTokens(anchor));
      const invented = [...numericTokens(`${zh}\n${en}`)].filter((token) => token.length > 0 && !allowed.has(token));
      const valid = zh.length >= 20 && en.length >= 20 && /[\u4e00-\u9fff]/.test(zh) && zh.length <= 500 && en.length <= 700 && invented.length === 0;
      if (!valid) {
        rejected += 1;
        console.log(JSON.stringify({ event: "views.rewrite.rejected", id: row.id, invented: invented.slice(0, 5) }));
        continue;
      }
      await prisma.atomicView.update({ where: { id: row.id }, data: { viewZh: zh, viewEn: en } });
      rewritten += 1;
      if (rewritten % 10 === 0) console.log(JSON.stringify({ event: "views.rewrite.progress", rewritten, at: index + 1 }));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({ event: "views.rewrite.failed", id: row.id, error: String(error).slice(0, 200) }));
    }
  }

  await writeAudit({ action: "views.rewrite", targetType: "atomicView", metadata: { rewritten, rejected, failed, inputTokens, outputTokens, provider: provider.name, model: provider.model } });
  console.log(JSON.stringify({ event: "views.rewrite.done", rewritten, rejected, failed, inputTokens, outputTokens }));
}

const viewSelect = {
  id: true, viewEn: true, viewZh: true, sourceQuote: true, asset: true, assetTicker: true, timeHorizon: true,
  article: { select: { title: true, institution: { select: { name: true } } } },
} as const;

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
