import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { createMacroProvider, macroProviderFactories } from "../src/lib/macro/providers";
import { macroIndicators, macroSources } from "../src/lib/macro/registry";
import { decideRevision } from "../src/lib/macro/revisions";
import { storeNormalizedObservation, syncMacroRegistry } from "../src/lib/macro/store";
import type { MacroSourceDefinition, NormalizedObservation } from "../src/lib/macro/types";
import { backfillChunks } from "../src/lib/macro/backfill";

type Metrics = { sources: number; chunks: number; observations: number; inserted: number; revisions: number; unchanged: number; failed: number; dryRun: boolean };

function value(name: string) { return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }
function date(name: string, fallback?: Date) {
  const raw = value(name);
  const parsed = raw ? new Date(raw) : fallback;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error(`--${name}=YYYY-MM-DD is required and must be valid.`);
  return parsed;
}

function selectSources(): MacroSourceDefinition[] {
  const all = process.argv.includes("--all");
  const provider = value("provider")?.toLowerCase();
  const indicatorSet = new Set((value("indicator") ?? "").split(",").filter(Boolean));
  const country = value("country")?.toUpperCase();
  if (!all && !provider && !indicatorSet.size && !country) throw new Error("Select --all or at least one of --provider, --indicator, --country.");
  if (provider && !macroProviderFactories[provider]) throw new Error(`Unknown provider ${provider}.`);
  for (const key of indicatorSet) if (!macroIndicators.some((item) => item.canonicalKey === key)) throw new Error(`Unknown indicator ${key}.`);
  const countries = new Map(macroIndicators.map((item) => [item.canonicalKey, item.countryCode]));
  return macroSources.filter((source) => source.enabled
    && (!provider || source.provider === provider)
    && (!indicatorSet.size || indicatorSet.has(source.canonicalKey))
    && (!country || countries.get(source.canonicalKey) === country));
}

function sourceChunks(source: MacroSourceDefinition, from: Date, to: Date) {
  const years = source.provider === "bls" ? 10 : source.provider === "bea" || source.provider === "eia" ? 5 : source.provider === "fred" ? 1 : 10;
  return backfillChunks(from, to, years);
}

async function preview(rows: NormalizedObservation[]) {
  let inserted = 0, revisions = 0, unchanged = 0;
  for (const row of rows) {
    const source = await prisma.macroSeriesSource.findUnique({ where: { provider_externalSeriesId: { provider: row.provider, externalSeriesId: row.externalSeriesId } }, select: { id: true } });
    const stored = source ? await prisma.macroObservation.findMany({ where: { seriesSourceId: source.id, period: row.period }, orderBy: { revisionNo: "asc" }, select: { id: true, value: true, status: true, vintageAt: true, revisionNo: true, isInitial: true } }) : [];
    const history = stored.map((item) => ({ ...item, value: item.value.toString() }));
    const decision = decideRevision(history, row);
    if (decision.action === "unchanged") unchanged++; else { inserted++; if (!decision.isInitial) revisions++; }
  }
  return { inserted, revisions, unchanged };
}

async function execute(dryRun: boolean): Promise<Metrics> {
  const sources = selectSources();
  const from = date("from");
  const to = date("to", new Date());
  const concurrency = Math.min(8, Math.max(1, Number(value("concurrency") ?? 2)));
  if (!Number.isInteger(concurrency)) throw new Error("--concurrency must be an integer from 1 to 8.");
  if (!dryRun) await syncMacroRegistry();
  const metrics: Metrics = { sources: sources.length, chunks: 0, observations: 0, inserted: 0, revisions: 0, unchanged: 0, failed: 0, dryRun };
  const providers = new Map([...new Set(sources.map((source) => source.provider))].map((name) => [name, createMacroProvider(name)]));
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const source = sources[next++];
      const signature = JSON.stringify({ from: from.toISOString(), to: to.toISOString() });
      const scopeKey = `${source.provider}:${source.externalSeriesId}`;
      const state = !dryRun ? await prisma.macroSyncState.findUnique({ where: { provider_scopeKey: { provider: "backfill", scopeKey } } }) : null;
      let chunks = sourceChunks(source, from, to);
      if (state?.metadata === signature && state.cursor) chunks = chunks.filter((chunk) => chunk.to.toISOString() > state.cursor!);
      for (const chunk of chunks) {
        try {
          const rows = (await providers.get(source.provider)!.fetchSeries({ externalSeriesId: source.externalSeriesId, from: chunk.from, to: chunk.to, ...(source.provider === "fred" ? { realtimeStart: from, realtimeEnd: to } : {}) }))
            .filter((row) => row.period >= chunk.from && row.period <= chunk.to)
            .sort((a, b) => a.period.getTime() - b.period.getTime() || a.vintageAt.getTime() - b.vintageAt.getTime());
          const counts = dryRun ? await preview(rows) : { inserted: 0, revisions: 0, unchanged: 0 };
          if (!dryRun) for (const row of rows) {
            const result = await storeNormalizedObservation(row);
            if (result.status === "unchanged") counts.unchanged++; else { counts.inserted++; if (!result.isInitial) counts.revisions++; }
          }
          metrics.chunks++; metrics.observations += rows.length; metrics.inserted += counts.inserted; metrics.revisions += counts.revisions; metrics.unchanged += counts.unchanged;
          if (!dryRun) await prisma.macroSyncState.upsert({ where: { provider_scopeKey: { provider: "backfill", scopeKey } }, create: { provider: "backfill", scopeKey, cursor: chunk.to.toISOString(), lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastStatus: "succeeded", metadata: signature }, update: { cursor: chunk.to.toISOString(), lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastStatus: "succeeded", lastError: null, metadata: signature } });
          console.log(JSON.stringify({ event: "macro.backfill.chunk", provider: source.provider, series: source.externalSeriesId, from: chunk.from.toISOString(), to: chunk.to.toISOString(), rows: rows.length, dryRun }));
        } catch (error) {
          metrics.failed++;
          if (!dryRun) await prisma.macroSyncState.upsert({ where: { provider_scopeKey: { provider: "backfill", scopeKey } }, create: { provider: "backfill", scopeKey, lastAttemptAt: new Date(), lastStatus: "failed", lastError: String(error).slice(0, 2000), metadata: signature }, update: { lastAttemptAt: new Date(), lastStatus: "failed", lastError: String(error).slice(0, 2000), metadata: signature } });
          console.error(JSON.stringify({ event: "macro.backfill.chunk.failed", provider: source.provider, series: source.externalSeriesId, error: String(error).slice(0, 500) }));
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length || 1) }, worker));
  if (metrics.failed) { const error = new Error(`${metrics.failed} backfill source(s) failed.`) as Error & { metrics: Metrics }; error.metrics = metrics; throw error; }
  return metrics;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log(JSON.stringify({ event: "macro.backfill.preview", metrics: await execute(true) }));
  else await runTrackedJob("macro:backfill", { argv: process.argv.slice(2) }, async () => { const metrics = await execute(false); return { result: undefined, metrics }; });
}
main().catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
