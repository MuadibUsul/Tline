const LADDER_BASE = 5;

/**
 * Which page numbers a paginated listing should link to, `null` where a run is skipped.
 *
 * Previous/next alone puts page 250 two hundred and fifty clicks from the front, which is
 * how a corpus becomes unreachable to a crawler without ever going missing. Neighbours
 * keep normal reading cheap; the evenly spaced anchors are what bound the depth, since
 * each click can cross a fraction of the whole range rather than a single page.
 */
export function paginationWindow(current: number, pages: number, neighbours = 2, anchors = 7): Array<number | null> {
  const wanted = new Set<number>([1, pages]);
  for (let offset = -neighbours; offset <= neighbours; offset += 1) {
    const page = current + offset;
    if (page >= 1 && page <= pages) wanted.add(page);
  }
  for (let step = 0; step < anchors; step += 1) {
    wanted.add(1 + Math.round((step * (pages - 1)) / Math.max(1, anchors - 1)));
  }
  // Anchors fixed to the whole range get a crawler close to any page in one click, but no
  // closer: from page 209 the nearest offer to 199 would be 207, and the last stretch would
  // crawl by twos. A ladder that grows from wherever the reader is closes that last stretch
  // at the same rate as the first, so the walk converges in clicks, not in pages.
  for (let stride = LADDER_BASE; stride < pages; stride *= LADDER_BASE) {
    for (const page of [current - stride, current + stride]) {
      if (page >= 1 && page <= pages) wanted.add(page);
    }
  }

  const sorted = [...wanted].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const [position, page] of sorted.entries()) {
    if (position > 0 && page - sorted[position - 1] > 1) out.push(null);
    out.push(page);
  }
  return out;
}
