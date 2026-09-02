import "dotenv/config";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/db";

/**
 * Move an already-crawled research corpus between deployments.
 *
 *   npm run dataset:export -- --out ../bundle     (reads the local database)
 *   npm run dataset:import -- --in /bundle        (writes the target database)
 *
 * The two ends run different engines — SQLite in development, PostgreSQL in production —
 * so a file copy or SQL dump is no help. Prisma hands back typed values on both sides, so
 * the transport is line-delimited JSON with dates tagged, which survives the round trip
 * without the exporter needing to know each column's type.
 *
 * Figures are deliberately absent: the pipeline no longer collects them, and importing
 * rows whose images were never shipped would render as broken exhibits.
 */

// Parents before children: every row's foreign keys must already resolve on insert.
const MODELS = [
  "institution",
  "asset",
  "article",
  "articleSegment",
  "articleTranslation",
  "articleTranslationSegment",
  "analysis",
  "articleAsset",
  "atomicView",
  "articleDocument",
  "forecast",
  "priceObservation",
  "consensusHistory",
] as const;

type ModelName = (typeof MODELS)[number];

// The models share no common delegate type, so reach them through the narrow shape this
// tool actually uses rather than repeating a per-model switch.
interface RowDelegate {
  findMany: () => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[]; skipDuplicates: boolean }) => Promise<{ count: number }>;
}

const delegate = (model: ModelName) => prisma[model] as unknown as RowDelegate;

/**
 * Institutions and assets are seeded independently on every deployment, so the same
 * publisher carries a different id on each side. They are matched on their natural key
 * instead, and every foreign key pointing at them is rewritten to the target's id.
 */
const NATURAL_KEY = { institution: "slug", asset: "ticker" } as const;
type RootModel = keyof typeof NATURAL_KEY;

const REMAP: Partial<Record<ModelName, Record<string, RootModel>>> = {
  article: { institutionId: "institution" },
  articleAsset: { assetId: "asset" },
  forecast: { institutionId: "institution", assetId: "asset" },
  priceObservation: { assetId: "asset" },
  consensusHistory: { assetId: "asset" },
};

const DATE_TAG = "$date";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// `value` has already been through Date.prototype.toJSON by the time a replacer sees it,
// so the original has to be read back off the holder to recognise it.
function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const original = this[key];
  return original instanceof Date ? { [DATE_TAG]: original.toISOString() } : value;
}

function reviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && DATE_TAG in (value as Record<string, unknown>)) {
    return new Date((value as Record<string, string>)[DATE_TAG]);
  }
  return value;
}

async function exportDataset(outDir: string) {
  await mkdir(outDir, { recursive: true });
  const counts: Record<string, number> = {};

  for (const model of MODELS) {
    const rows = await delegate(model).findMany();
    const file = createWriteStream(path.join(outDir, `${model}.ndjson`));
    for (const row of rows) file.write(JSON.stringify(row, replacer) + "\n");
    await new Promise<void>((resolve, reject) => file.end((error?: Error) => (error ? reject(error) : resolve())));
    counts[model] = rows.length;
    console.log(JSON.stringify({ event: "dataset.export.model", model, rows: rows.length }));
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ exportedAt: new Date().toISOString(), models: MODELS, counts }, null, 2),
  );
  console.log(JSON.stringify({ event: "dataset.export.complete", counts }));
}

async function readRows(file: string) {
  const rows: Record<string, unknown>[] = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) rows.push(JSON.parse(line, reviver));
  return rows;
}

async function importDataset(inDir: string) {
  const manifest = JSON.parse(await readFile(path.join(inDir, "manifest.json"), "utf8")) as { models: ModelName[] };
  const results: Record<string, { inserted: number; skipped: number }> = {};

  // localId -> id in the target database, filled in as the root tables are matched.
  const identity: Record<RootModel, Map<string, string>> = { institution: new Map(), asset: new Map() };

  for (const model of manifest.models) {
    const rows = await readRows(path.join(inDir, `${model}.ndjson`));

    if (model === "institution" || model === "asset") {
      const key = NATURAL_KEY[model];
      const existing = await delegate(model).findMany();
      const byKey = new Map(existing.map((row) => [String(row[key]), String(row.id)]));
      let matched = 0;
      for (const row of rows) {
        const target = byKey.get(String(row[key]));
        // An unmatched row is one this deployment never seeded; carry it over as-is.
        if (target) matched++;
        else await delegate(model).createMany({ data: [row], skipDuplicates: true });
        identity[model].set(String(row.id), target ?? String(row.id));
      }
      results[model] = { inserted: rows.length - matched, skipped: matched };
      console.log(JSON.stringify({ event: "dataset.import.model", model, ...results[model] }));
      continue;
    }

    const remap = REMAP[model];
    if (remap) {
      for (const row of rows) {
        for (const [field, root] of Object.entries(remap)) {
          const mapped = identity[root].get(String(row[field]));
          if (mapped) row[field] = mapped;
        }
      }
    }

    let inserted = 0;
    // Chunked so one oversized statement cannot exhaust the server's parameter limit.
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      const result = await delegate(model).createMany({ data: chunk, skipDuplicates: true });
      inserted += result.count;
    }
    results[model] = { inserted, skipped: rows.length - inserted };
    console.log(JSON.stringify({ event: "dataset.import.model", model, ...results[model] }));
  }

  console.log(JSON.stringify({ event: "dataset.import.complete", results }));
}

const mode = process.argv[2];
const run =
  mode === "export"
    ? exportDataset(path.resolve(arg("out") ?? "dataset-bundle"))
    : mode === "import"
      ? importDataset(path.resolve(arg("in") ?? "dataset-bundle"))
      : Promise.reject(new Error("Usage: dataset.ts export --out <dir> | import --in <dir>"));

run
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
