import "dotenv/config";
import { prisma } from "../db";
import { runTrackedJob } from "../jobs";
import { macroSources } from "./registry";
import { storeNormalizedObservation, syncMacroRegistry } from "./store";
import { createMacroProvider, macroProviderFactories } from "./providers";
import { MacroProviderError } from "./providers/types";

function selectedProviders() {
  const providerArg = process.argv.find((value) => value.startsWith("--provider="))?.split("=")[1]?.toLowerCase();
  const all = process.argv.includes("--all");
  if (all === Boolean(providerArg)) throw new Error(`Use exactly one of --provider=${Object.keys(macroProviderFactories).join("|")} or --all.`);
  if (providerArg && !macroProviderFactories[providerArg]) throw new Error(`Unknown macro provider: ${providerArg}.`);
  return all ? Object.keys(macroProviderFactories) : [providerArg!];
}

async function execute(names: string[]) {
  const registry = await syncMacroRegistry();
  let inserted = 0;
  let unchanged = 0;
  let observations = 0;
  const failures: Array<{ provider: string; series: string; code: string }> = [];

  for (const name of names) {
    const provider = createMacroProvider(name);
    const sources = macroSources.filter((source) => source.provider === name && source.enabled);
    for (const source of sources) {
      try {
        const rows = provider.fetchLatest
          ? await provider.fetchLatest({ externalSeriesId: source.externalSeriesId })
          : await provider.fetchSeries({ externalSeriesId: source.externalSeriesId });
        for (const row of rows) {
          const result = await storeNormalizedObservation(row);
          observations++;
          if (result.status === "inserted") inserted++;
          else unchanged++;
        }
        console.log(JSON.stringify({ event: "macro.sync.series", provider: name, series: source.externalSeriesId, observations: rows.length }));
      } catch (error) {
        const code = error instanceof MacroProviderError ? error.code : "UNKNOWN";
        failures.push({ provider: name, series: source.externalSeriesId, code });
        console.error(JSON.stringify({ event: "macro.sync.series.failed", provider: name, series: source.externalSeriesId, code }));
      }
    }
  }
  if (failures.length) throw new Error(`Macro sync failed for ${failures.length} series: ${failures.map((item) => `${item.provider}:${item.series}:${item.code}`).join(", ")}`);
  return { registry, providers: names.length, observations, inserted, unchanged };
}

async function main() {
  const providers = selectedProviders();
  await runTrackedJob("macro:sync", { providers }, async () => {
    const metrics = await execute(providers);
    return { result: undefined, metrics };
  });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof MacroProviderError ? `${error.provider}:${error.code}: ${error.message}` : String(error));
  await prisma.$disconnect();
  process.exit(1);
});
