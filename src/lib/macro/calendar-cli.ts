import "dotenv/config";
import { prisma } from "../db";
import { runTrackedJob } from "../jobs";
import { loadEconomicCalendar, syncCalendarCandidates } from "./calendar";
import { macroReleaseFamilies } from "./registry";

async function main() {
  await runTrackedJob("macro:calendar", {}, async () => {
    const candidates = await loadEconomicCalendar();
    const present = new Set(candidates.map((candidate) => candidate.releaseFamily));
    const missingFamilies = macroReleaseFamilies.filter((family) => !present.has(family.key)).map((family) => family.key);
    if (missingFamilies.length) console.warn(JSON.stringify({ event: "macro.calendar.missing", families: missingFamilies }));
    const metrics = { ...await syncCalendarCandidates(candidates), missingFamilies: missingFamilies.length };
    console.log(JSON.stringify({ event: "macro.calendar.complete", ...metrics }));
    return { result: undefined, metrics };
  });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String(error));
  await prisma.$disconnect();
  process.exit(1);
});
