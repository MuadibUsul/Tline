type ScheduledSource = {
  researchUrl: string;
  rssUrl: string | null;
  requiresRender: boolean;
  crawlIntervalSec: number | null;
};

// Low-frequency baseline: one pass an hour per source. Enough to catch the publish
// window without hammering publishers; override per source with crawlIntervalSec.
export function crawlIntervalSeconds(source: Omit<ScheduledSource, "researchUrl">) {
  return Math.max(30, source.crawlIntervalSec ?? 3600);
}

export const ACCESS_CIRCUIT_FAILURES = 6;

/** Positive-only jitter avoids synchronized crawls without checking earlier than configured. */
export function jitterSeconds(seconds: number, random = Math.random) {
  return Math.ceil(seconds * (1 + random() * 0.2));
}

export function sourceBackoffSeconds(intervalSeconds: number, failures: number, accessBlocked = false) {
  if (accessBlocked) return failures >= 3 ? 86_400 : failures === 2 ? 14_400 : 3_600;
  return Math.min(86_400, intervalSeconds * 2 ** Math.min(Math.max(1, failures), 8));
}

export function healthyScheduleSeconds(intervalSeconds: number, previousFailures: number, random = Math.random) {
  return jitterSeconds(intervalSeconds * (previousFailures > 0 ? 4 : 1), random);
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
