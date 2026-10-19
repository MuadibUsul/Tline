import { looksLikeViewFragment } from "./viewQuality";

/**
 * The homepage's "institutional observations" selection.
 *
 * Two rules, both learned from the first real render (2026-10-17): the block must show
 * different houses — five consecutive rows from one bank's weekly is not a market
 * observation board — and each row must read as a sentence, not a fragment of the
 * source's table layout. Rows arrive in display priority order (newest report first,
 * then importance); the first clean view a house contributes is its entry, and a house
 * never appears twice.
 */
export interface ObservationCandidate {
  id: string;
  institutionId: string;
  viewEn: string;
  viewZh?: string | null;
}

export function selectDiverseObservations<T extends ObservationCandidate>(
  rows: T[],
  options: { take: number; zh: boolean },
): T[] {
  const seenInstitutions = new Set<string>();
  const picked: T[] = [];
  for (const row of rows) {
    if (picked.length >= options.take) break;
    if (seenInstitutions.has(row.institutionId)) continue;
    const text = ((options.zh ? row.viewZh || row.viewEn : row.viewEn || row.viewZh) ?? "").trim();
    if (looksLikeViewFragment(text)) continue;
    seenInstitutions.add(row.institutionId);
    picked.push(row);
  }
  return picked;
}
