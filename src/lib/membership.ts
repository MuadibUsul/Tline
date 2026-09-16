import { prisma } from "./db";
import { writeAudit } from "./audit";

/**
 * Founding membership: the first hundred accounts, numbered for good.
 *
 * The cap is the whole point, so it is enforced where it cannot be raced: the seat lives in
 * a unique column, and allocation picks the lowest free seat inside a transaction. Two
 * registrations arriving together compute the same seat; one write succeeds and the other
 * hits the unique index, which is then retried onto the next free seat. A counter read
 * before an insert would have let both through.
 *
 * Membership never expires and there is nothing to renew: the tier stays on the account.
 */
export const FOUNDING_TIER = "founding";
export const FOUNDING_MEMBERSHIP_LIMIT = Math.max(1, Number(process.env.FOUNDING_MEMBERSHIP_LIMIT || 100));

export interface SeatHolder {
  id: string;
  foundingSeat: number | null;
}

/**
 * The lowest seat still free, or null when the house is full.
 *
 * Gaps are reused: a seat freed by an account deletion is offered to the next arrival,
 * because the promise is "one of the first hundred", not "one of the first hundred attempts".
 */
export function nextFoundingSeat(takenSeats: number[], limit = FOUNDING_MEMBERSHIP_LIMIT): number | null {
  const taken = new Set(takenSeats.filter((seat) => seat >= 1 && seat <= limit));
  for (let seat = 1; seat <= limit; seat++) {
    if (!taken.has(seat)) return seat;
  }
  return null;
}

export type GrantResult =
  | { granted: true; seat: number }
  | { granted: false; reason: "already_member" | "full" };

/** Give one account the next free seat, if there is one. Idempotent per account. */
export async function grantFoundingMembership(userId: string): Promise<GrantResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { foundingSeat: true } });
    if (!existing) return { granted: false, reason: "full" };
    if (existing.foundingSeat !== null) return { granted: false, reason: "already_member" };
    const holders = await prisma.user.findMany({ where: { foundingSeat: { not: null } }, select: { foundingSeat: true } });
    const seat = nextFoundingSeat(holders.map((holder) => holder.foundingSeat!));
    if (seat === null) {
      await writeAudit({ action: "membership.founding.full", targetType: "user", targetId: userId, metadata: { limit: FOUNDING_MEMBERSHIP_LIMIT } });
      return { granted: false, reason: "full" };
    }
    try {
      await prisma.user.update({ where: { id: userId }, data: { foundingSeat: seat, tier: FOUNDING_TIER } });
      await writeAudit({ action: "membership.founding.granted", targetType: "user", targetId: userId, metadata: { seat } });
      return { granted: true, seat };
    } catch (error) {
      // Another registration took the seat between the read and the write. Take the next one.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  return { granted: false, reason: "full" };
}

/**
 * Number the accounts that were already here.
 *
 * Run once, so the earliest registrations receive the seats they would have had if the
 * programme had existed from the start, and anyone arriving afterwards takes what is left.
 */
export async function backfillFoundingMembers(apply: boolean, now = new Date()) {
  const holders = await prisma.user.findMany({ where: { foundingSeat: { not: null } }, select: { id: true, foundingSeat: true } });
  const takenSeats = holders.map((holder) => holder.foundingSeat!);
  const candidates = await prisma.user.findMany({
    where: { foundingSeat: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, email: true, createdAt: true, tier: true },
  });
  const assignments: Array<{ id: string; email: string; seat: number; tier: string; createdAt: Date }> = [];
  const taken = new Set(takenSeats);
  for (const candidate of candidates) {
    const seat = nextFoundingSeat([...taken]);
    if (seat === null) break;
    taken.add(seat);
    assignments.push({ id: candidate.id, email: candidate.email, seat, tier: FOUNDING_TIER, createdAt: candidate.createdAt });
  }
  if (apply) {
    for (const assignment of assignments) {
      await prisma.user.update({ where: { id: assignment.id }, data: { foundingSeat: assignment.seat, tier: FOUNDING_TIER } });
    }
    if (assignments.length) {
      await writeAudit({ action: "membership.founding.backfilled", metadata: { assigned: assignments.length, seats: assignments.map((item) => item.seat), at: now.toISOString() } });
    }
  }
  return { limit: FOUNDING_MEMBERSHIP_LIMIT, existingSeats: takenSeats.length, candidates: candidates.length, assignments };
}
