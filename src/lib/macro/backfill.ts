export interface BackfillChunk { from: Date; to: Date }

export function backfillChunks(from: Date, to: Date, years = 1): BackfillChunk[] {
  if (from > to) throw new Error("--from must not be after --to.");
  const chunks: BackfillChunk[] = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    const end = new Date(cursor);
    end.setUTCFullYear(end.getUTCFullYear() + years);
    end.setUTCDate(end.getUTCDate() - 1);
    if (end > to) end.setTime(to.getTime());
    chunks.push({ from: new Date(cursor), to: end });
    cursor = new Date(end.getTime() + 86_400_000);
  }
  return chunks;
}
