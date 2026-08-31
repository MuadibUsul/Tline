type ScheduledSource = {
  researchUrl: string;
  rssUrl: string | null;
  requiresRender: boolean;
  crawlIntervalSec: number | null;
};

export function crawlIntervalSeconds(source: Omit<ScheduledSource, "researchUrl">) {
  return Math.max(30, source.crawlIntervalSec ?? (source.rssUrl ? 60 : source.requiresRender ? 600 : 180));
}

/** Bounded async I/O across domains; sources sharing a publisher domain stay serial. */
export async function runSourcesByOrigin<T extends Pick<ScheduledSource, "researchUrl">>(
  sources: T[],
  concurrency: number,
  work: (source: T) => Promise<void>,
) {
  const grouped = new Map<string, T[]>();
  for (const source of sources) {
    const origin = new URL(source.researchUrl).origin;
    grouped.set(origin, [...(grouped.get(origin) ?? []), source]);
  }
  const groups = [...grouped.values()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), groups.length) }, async () => {
    while (cursor < groups.length) {
      const group = groups[cursor++];
      for (const source of group) await work(source);
    }
  }));
}
