import type { Prisma } from "@prisma/client";

/**
 * The numbers behind a read-out, computed rather than asked for.
 *
 * A model given only "actual 423429, consensus 421000" can restate them and nothing else,
 * and any statistic it volunteers — a three-month trend, a percentile, "the largest drop
 * since" — is unverifiable prose. Everything here is arithmetic over the stored history, so
 * the read-out is written about figures that already exist, and the guard can reject a
 * number the facts do not contain.
 */

export type FactSeriesPoint = { period: Date; value: number };

export interface FactValue {
  canonicalKey: string;
  nameEn: string;
  nameZh: string | null;
  unit: string;
  /** The print, and the two figures it is read against. */
  actual: number;
  consensus: number | null;
  previous: number | null;
  /** actual − previous, in the indicator's own unit. */
  change: number | null;
  /** actual − consensus, in both the unit and as a share of the typical move. */
  surprise: number | null;
  surprisePct: number | null;
  /** How large the surprise is against the historical spread of period changes. */
  surpriseSd: number | null;
  /** Where this period's change sits in the distribution of past changes (0–100). */
  changePercentile: number | null;
  /** Three-month annualised rate (index series) or three-period average change (flow series). */
  momentum: number | null;
  momentumLabel: string;
  /** Deviation of the change from the average change of the last twelve periods. */
  meanDeviation: number | null;
  revision: string | null;
}

export interface ReleaseFacts {
  family: string;
  topic: string;
  title: string;
  asOf: string;
  values: FactValue[];
  /** Conclusions the arithmetic already settled: no consensus, no beat/miss language. */
  labels: string[];
  /** Every number a read-out may quote, as strings, for the guard to check against. */
  allowedNumbers: string[];
}

export interface Playbook {
  family: string;
  topic: string;
  primary: string;
  metrics: string[];
  compare: string[];
  market: string[];
  questions: string[];
  notes: string;
}

const FLOW_UNITS = ["THOUSANDS_OF_PERSONS", "THOUSANDS", "THOUSANDS_OF_BARRELS", "BILLIONS_USD"];
const RATE_UNITS = ["PERCENT", "PERCENT_CHANGE_SAAR", "BASIS_POINTS"];

const mean = (items: number[]) => items.reduce((sum, item) => sum + item, 0) / items.length;

/** Population standard deviation; zero when every value is identical. */
function spread(items: number[]) {
  if (items.length < 2) return 0;
  const average = mean(items);
  return Math.sqrt(mean(items.map((item) => (item - average) ** 2)));
}

export function periodChanges(series: FactSeriesPoint[]): number[] {
  const ordered = [...series].sort((left, right) => left.period.getTime() - right.period.getTime());
  const changes: number[] = [];
  for (let index = 1; index < ordered.length; index++) changes.push(ordered[index].value - ordered[index - 1].value);
  return changes;
}

function percentileOf(value: number, pool: number[]): number | null {
  if (pool.length < 6) return null;
  const below = pool.filter((item) => item <= value).length;
  return Math.round((below / pool.length) * 100);
}

/**
 * Momentum means a different thing per unit, so it is reported as what it is:
 * index levels compound, flow series average, rates are already a rate.
 */
export function momentumFor(unit: string, series: FactSeriesPoint[]) {
  const ordered = [...series].sort((left, right) => left.period.getTime() - right.period.getTime());
  if (ordered.length < 4) return { value: null, label: "insufficient history" };
  const last = ordered.at(-1)!;
  const anchor = ordered.at(-4)!;
  if (["INDEX", "THOUSANDS_OF_BARRELS", "BILLIONS_USD"].includes(unit)) {
    if (anchor.value <= 0) return { value: null, label: "insufficient history" };
    const annualised = ((last.value / anchor.value) ** (12 / 3) - 1) * 100;
    return { value: Number(annualised.toFixed(2)), label: "three-month annualised" };
  }
  if (FLOW_UNITS.includes(unit)) {
    const recent = ordered.slice(-4);
    const steps = recent.slice(1).map((item, index) => item.value - recent[index].value);
    return { value: Number(mean(steps).toFixed(2)), label: "three-period average change" };
  }
  if (RATE_UNITS.includes(unit)) {
    return { value: Number((last.value - anchor.value).toFixed(2)), label: "change over three periods" };
  }
  return { value: null, label: "not defined for this unit" };
}

export function revisionNote(initial: number | null, latest: number | null): string | null {
  if (initial === null || latest === null || initial === latest) return null;
  const direction = latest > initial ? "raised" : "lowered";
  return `initial print ${initial} ${direction} to ${latest} in later vintages`;
}

export interface FactInput {
  family: string;
  title: string;
  now: Date;
  playbook: Playbook;
  values: Array<{
    canonicalKey: string;
    nameEn: string;
    nameZh: string | null;
    unit: string;
    actual: number;
    consensus: number | null;
    previous: number | null;
    initialActual?: number | null;
    latestActual?: number | null;
  }>;
  /** Stored history per indicator, excluding the period under review. */
  history: Record<string, FactSeriesPoint[]>;
}

export function buildFacts(input: FactInput): ReleaseFacts {
  const labels: string[] = [];
  const values: FactValue[] = input.values.map((value) => {
    const history = input.history[value.canonicalKey] ?? [];
    // The series under review is the read-out's subject; the stored history is what came
    // before it. Percentiles and spreads are computed on changes, not levels: a growing
    // price index sits at "100th percentile" every month and says nothing.
    const changes = periodChanges(history);
    const change = value.previous === null ? null : value.actual - value.previous;
    const surprise = value.consensus === null ? null : value.actual - value.consensus;
    const sd = spread(changes);
    const momentum = change === null ? { value: null, label: "n/a" } : momentumFor(value.unit, [...history, { period: input.now, value: value.actual }]);
    return {
      canonicalKey: value.canonicalKey,
      nameEn: value.nameEn,
      nameZh: value.nameZh,
      unit: value.unit,
      actual: value.actual,
      consensus: value.consensus,
      previous: value.previous,
      change: change === null ? null : Number(change.toFixed(4)),
      surprise: surprise === null ? null : Number(surprise.toFixed(4)),
      surprisePct: surprise === null || !value.consensus ? null : Number(((surprise / Math.abs(value.consensus)) * 100).toFixed(3)),
      surpriseSd: surprise === null || sd === 0 ? null : Number((surprise / sd).toFixed(2)),
      changePercentile: change === null ? null : percentileOf(change, changes),
      momentum: momentum.value,
      momentumLabel: momentum.label,
      meanDeviation: change === null || changes.length < 6 ? null : Number((change - mean(changes.slice(-12))).toFixed(4)),
      revision: revisionNote(value.initialActual ?? null, value.latestActual ?? null),
    };
  });

  for (const value of values) {
    if (value.change !== null && value.previous !== null) {
      const direction = value.change > 0 ? "rose" : value.change < 0 ? "fell" : "was unchanged";
      labels.push(`${value.nameEn} ${direction} ${Math.abs(value.change)} from ${value.previous} to ${value.actual}`);
    }
    if (value.surprise === null) {
      labels.push(`no survey consensus was recorded for ${value.nameEn}: the print cannot be described as beating or missing expectations`);
    } else if (value.surprise === 0) {
      labels.push(`${value.nameEn} printed exactly at the consensus of ${value.consensus}`);
    } else {
      const side = value.surprise > 0 ? "above" : "below";
      const sig = value.surpriseSd === null ? "" : ` (${Math.abs(value.surpriseSd)} standard deviations of the historical change)`;
      labels.push(`${value.nameEn} printed ${side} the consensus of ${value.consensus} by ${Math.abs(value.surprise)}${sig}`);
    }
    if (value.changePercentile !== null) labels.push(`${value.nameEn}'s change sits at the ${value.changePercentile}th percentile of its recorded changes`);
    if (value.momentum !== null) labels.push(`${value.nameEn} ${value.momentumLabel}: ${value.momentum}`);
    if (value.revision) labels.push(`${value.nameEn} ${value.revision}`);
  }

  const allowedNumbers = new Set<string>();
  for (const value of values) {
    for (const candidate of [value.actual, value.consensus, value.previous, value.change, value.surprise, value.surprisePct, value.surpriseSd, value.momentum, value.meanDeviation]) {
      if (candidate === null || candidate === undefined) continue;
      allowedNumbers.add(String(candidate));
      allowedNumbers.add(String(Math.abs(candidate)));
      allowedNumbers.add(String(Number(candidate.toFixed(2))));
      allowedNumbers.add(String(Number(Math.abs(candidate).toFixed(2))));
      // A change of 0.25 percentage points is the same fact as "25 basis points".
      allowedNumbers.add(String(Number((candidate * 100).toFixed(2))));
      allowedNumbers.add(String(Math.abs(Number((candidate * 100).toFixed(2)))));
    }
    if (value.changePercentile !== null) allowedNumbers.add(String(value.changePercentile));
  }
  return {
    family: input.family,
    topic: input.playbook.topic,
    title: input.title,
    asOf: input.now.toISOString(),
    values,
    labels,
    allowedNumbers: [...allowedNumbers],
  };
}

/** The subset the read-out must state, whatever else it says. */
export function requiredFigures(facts: ReleaseFacts): string[] {
  const required: string[] = [];
  for (const value of facts.values.slice(0, 2)) {
    required.push(`${value.nameEn} actual ${value.actual}`);
    if (value.consensus !== null) required.push(`${value.nameEn} consensus ${value.consensus}`);
    if (value.previous !== null) required.push(`${value.nameEn} previous ${value.previous}`);
  }
  return required;
}

export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}
