import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { createMacroProvider } from "../src/lib/macro/providers";
import { storeNormalizedObservation, syncMacroRegistry } from "../src/lib/macro/store";

runTrackedJob("macro:revision-sync", {}, async () => {
  await syncMacroRegistry();
  const sources = await prisma.macroSeriesSource.findMany({ where: { enabled: true }, select: { provider: true, externalSeriesId: true } });
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 2);
  let inserted = 0;
  let revisions = 0;
  let unchanged = 0;
  for (const source of sources) {
    const rows = await createMacroProvider(source.provider).fetchSeries({ externalSeriesId: source.externalSeriesId, from, to: new Date() });
    for (const row of rows) {
      const result = await storeNormalizedObservation(row);
      if (result.status === "unchanged") unchanged++;
      else {
        inserted++;
        if (!result.isInitial) revisions++;
      }
    }
  }
  return { result: undefined, metrics: { sources: sources.length, inserted, revisions, unchanged } };
}).catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
