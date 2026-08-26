import "dotenv/config";
import { prisma } from "../db";
import { snapshotAll } from "../consensus";
import { evaluateRules } from "../alerts";

async function main() {
  const n = await snapshotAll();
  const fired = await evaluateRules();
  console.log(`Wrote ${n} consensus snapshots · ${fired} alerts fired.`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
