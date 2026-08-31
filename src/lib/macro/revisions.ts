import { Prisma } from "@prisma/client";

export interface StoredObservationRevision {
  id: string;
  value: string;
  status: string;
  vintageAt: Date;
  revisionNo: number;
  isInitial: boolean;
}

export type RevisionDecision =
  | { action: "insert"; revisionNo: number; isInitial: boolean }
  | { action: "unchanged"; existing: StoredObservationRevision };

function sameValue(left: string, right: string) {
  return new Prisma.Decimal(left).equals(new Prisma.Decimal(right));
}

export function decideRevision(
  history: StoredObservationRevision[],
  incoming: { value: string; status: string; vintageAt: Date },
): RevisionDecision {
  const ordered = [...history].sort((left, right) => left.vintageAt.getTime() - right.vintageAt.getTime());
  const exact = ordered.find((row) => row.vintageAt.getTime() === incoming.vintageAt.getTime());
  if (exact) {
    if (sameValue(exact.value, incoming.value) && exact.status === incoming.status) return { action: "unchanged", existing: exact };
    throw new Error("Conflicting macro observation for an existing vintage.");
  }

  const latest = ordered.at(-1);
  if (!latest) return { action: "insert", revisionNo: 0, isInitial: true };
  if (sameValue(latest.value, incoming.value) && latest.status === incoming.status) return { action: "unchanged", existing: latest };
  if (incoming.vintageAt < latest.vintageAt) throw new Error("Macro observation vintage regressed; backfills must be ingested oldest-first.");
  return { action: "insert", revisionNo: latest.revisionNo + 1, isInitial: false };
}
