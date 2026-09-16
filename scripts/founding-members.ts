import "dotenv/config";
import { prisma } from "../src/lib/db";
import { backfillFoundingMembers, FOUNDING_MEMBERSHIP_LIMIT } from "../src/lib/membership";

/**
 * Number the accounts that registered before founding membership existed.
 *
 *   npm run members:founding            (preview: who would receive which seat)
 *   npm run members:founding -- --apply (write it)
 *
 * Seats go to the earliest registrations first, which is what "the first hundred" means; an
 * account that already holds a seat keeps it, and anyone after the hundredth stays a normal
 * account.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillFoundingMembers(apply);
  console.log(JSON.stringify({
    limit: FOUNDING_MEMBERSHIP_LIMIT,
    seatsAlreadyHeld: result.existingSeats,
    accountsWithoutSeat: result.candidates,
    wouldAssign: result.assignments.length,
    applied: apply,
  }, null, 2));
  for (const assignment of result.assignments) {
    console.log(`  #${String(assignment.seat).padStart(3, "0")}  ${assignment.createdAt.toISOString().slice(0, 10)}  ${assignment.email}`);
  }
  if (!apply && result.assignments.length) console.log("\nNothing written. Re-run with --apply to assign these seats.");
}

main().catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
