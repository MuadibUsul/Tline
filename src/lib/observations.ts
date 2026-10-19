import { looksLikeViewFragment } from "./viewQuality";

function isChineseText(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  return letters > 0 && han / letters >= 0.2;
}

/**
 * The homepage's "institutional observations" selection.
 *
 * Two rules, both learned from the first real render (2026-10-17): the block must show
 * different houses — five consecutive rows from one bank's weekly is not a market
 * observation board — and each row must read as a sentence, not a fragment of the
 * source's table layout. On a Chinese page only Chinese text is eligible, and on an
 * English page only English text is; a missing language is a skip, never an invisible
 * cross-language fallback. Rows arrive in display priority order (newest report first,
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
    const text = ((options.zh ? row.viewZh : row.viewEn) ?? "").trim();
    if (!text) continue;
    // The field name is not proof of its language: some translated rows contain the
    // English extraction verbatim. Require the script the reader's page is in.
    if (options.zh ? !isChineseText(text) : isChineseText(text)) continue;
    if (looksLikeViewFragment(text)) continue;
    seenInstitutions.add(row.institutionId);
    picked.push(row);
  }
  return picked;
}
