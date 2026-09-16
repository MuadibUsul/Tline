import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * Confirm (or inspect) who is allowed to use which dataset, and for what.
 *
 * The licence gate is deliberately closed until someone opens it: every reader checks
 * `status = CONFIRMED`, a confirmation time, an unexpired window and an explicit use
 * before a number is shown, analysed or posted. Nothing in the application writes these
 * rows — the decision is a human one, and this is the command that records it, with the
 * evidence URL and the confirmer's name attached.
 *
 *   npm run licenses
 *   npm run licenses -- confirm --dataset=forexfactory:calendar --provider=ForexFactory \
 *     --uses=internal_analysis,public_display,social --evidence-url=<url> --by=<name> --apply
 */
const USES = ["internal_analysis", "public_display", "api", "social", "derived_display"];

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

async function list() {
  const policies = await prisma.dataLicensePolicy.findMany({ orderBy: [{ provider: "asc" }, { datasetKey: "asc" }] });
  if (!policies.length) {
    console.log("No licence records. Every derived figure stays switched off.");
    return;
  }
  for (const policy of policies) {
    console.log([policy.datasetKey, policy.provider, policy.status, policy.allowedUses, policy.confirmedBy ?? "—", policy.confirmedAt?.toISOString() ?? "—", policy.evidenceUrl ?? "—"].join(" | "));
  }
}

async function confirm() {
  const datasetKey = args.get("dataset")?.trim();
  const provider = args.get("provider")?.trim();
  const uses = (args.get("uses") ?? "").split(",").map((use) => use.trim()).filter(Boolean);
  const evidenceUrl = args.get("evidence-url")?.trim();
  const by = args.get("by")?.trim() ?? process.env.USERNAME ?? "unknown";
  if (!datasetKey || !provider || !evidenceUrl) throw new Error("--dataset, --provider and --evidence-url are required.");
  const unknown = uses.filter((use) => !USES.includes(use));
  if (unknown.length) throw new Error(`Unknown uses: ${unknown.join(", ")}. Known: ${USES.join(", ")}`);
  if (!uses.length) throw new Error("--uses is required. Confirm only the uses the evidence actually supports.");
  if (!/^https:\/\//.test(evidenceUrl)) throw new Error("--evidence-url must be an https URL that supports the claim.");

  const row = { datasetKey, provider, status: "CONFIRMED", allowedUses: JSON.stringify(uses), evidenceUrl, confirmedBy: by, confirmedAt: new Date() };
  if (args.get("apply") !== "true") {
    console.log(JSON.stringify({ dryRun: true, ...row }, null, 2));
    console.log("\nNothing written. Re-run with --apply to record this confirmation.");
    return;
  }
  const saved = await prisma.dataLicensePolicy.upsert({ where: { datasetKey }, create: row, update: row });
  console.log(JSON.stringify({ confirmed: true, datasetKey: saved.datasetKey, allowedUses: saved.allowedUses }));
}

const command = process.argv[2]?.startsWith("--") || !process.argv[2] ? "list" : process.argv[2];
const run = command === "confirm" ? confirm : command === "list" ? list : null;
if (!run) throw new Error(`Unknown command ${command}. Use list or confirm.`);

run().catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
