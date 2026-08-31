import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { auditMacroData } from "../src/lib/macro/audit";

runTrackedJob("macro:audit", {}, async () => {
  const report = await auditMacroData();
  const stamp = report.generatedAt.slice(0, 10).replaceAll("-", "");
  const directory = path.resolve("data/macro");
  const output = path.join(directory, `audit-${stamp}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ event: "macro.audit.complete", output, ...report.summary }));
  if (report.summary.severe) { const error = new Error(`Macro audit found ${report.summary.severe} severe issue(s).`) as Error & { metrics: Record<string, unknown> }; error.metrics = { ...report.summary, output }; throw error; }
  return { result: undefined, metrics: { ...report.summary, output } };
}).catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
