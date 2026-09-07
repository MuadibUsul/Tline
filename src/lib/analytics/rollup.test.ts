import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../db";
import { pruneRaw, retentionDays, rollupDay } from "./rollup";

/**
 * These touch the development database, so every case works inside its own day key far in
 * the past and removes what it wrote. That keeps them from colliding with real rows and
 * from depending on whatever else happens to be in the table.
 */
const DAY = "1999-01-02";
const OLD = "1999-01-01";

async function clear() {
  await prisma.pageView.deleteMany({ where: { day: { in: [DAY, OLD] } } });
  await prisma.analyticsEvent.deleteMany({ where: { day: { in: [DAY, OLD] } } });
  await prisma.webVital.deleteMany({ where: { day: { in: [DAY, OLD] } } });
  await prisma.trafficDaily.deleteMany({ where: { day: { in: [DAY, OLD] } } });
}

function view(overrides: Partial<Parameters<typeof prisma.pageView.create>[0]["data"]> = {}) {
  return {
    day: DAY,
    ts: new Date(`${DAY}T12:00:00.000Z`),
    path: "/research",
    locale: "en",
    visitorId: "v1",
    sessionId: "s1",
    device: "desktop",
    browser: "Chrome",
    os: "Windows",
    ...overrides,
  };
}

test("a day rolls up to totals, and re-running it changes nothing", async (t) => {
  await clear();
  t.after(clear);

  await prisma.pageView.createMany({
    data: [
      // One visitor reading three pages in one session: not a bounce.
      view({ path: "/research" }),
      view({ path: "/consensus", durationMs: 30_000 }),
      view({ path: "/markets", durationMs: 90_000 }),
      // A second visitor who arrives and leaves: a bounce.
      view({ visitorId: "v2", sessionId: "s2", path: "/research", browser: "Safari" }),
    ],
  });

  const first = await rollupDay(DAY);
  assert.equal(first.views, 4);

  const total = await prisma.trafficDaily.findFirst({ where: { day: DAY, dimension: "total" } });
  assert.equal(total?.views, 4);
  assert.equal(total?.visitors, 2);
  assert.equal(total?.sessions, 2);
  assert.equal(total?.bounces, 1);
  assert.equal(total?.durationSec, 120);

  const research = await prisma.trafficDaily.findFirst({ where: { day: DAY, dimension: "path", value: "/research" } });
  assert.equal(research?.views, 2);
  assert.equal(research?.visitors, 2);

  // Idempotent: the second pass replaces the day rather than adding to it.
  await rollupDay(DAY);
  assert.equal(await prisma.trafficDaily.count({ where: { day: DAY, dimension: "total" } }), 1);
  assert.equal((await prisma.trafficDaily.findFirst({ where: { day: DAY, dimension: "total" } }))?.views, 4);
});

test("a value containing a space survives the round trip", async (t) => {
  await clear();
  t.after(clear);
  // "Samsung Internet" is why the aggregate is not keyed by a joined string: any
  // separator would eventually split a real value in half.
  await prisma.pageView.createMany({ data: [view({ browser: "Samsung Internet" }), view({ browser: "Samsung Internet", sessionId: "s2" })] });
  await rollupDay(DAY);
  const row = await prisma.trafficDaily.findFirst({ where: { day: DAY, dimension: "browser" } });
  assert.equal(row?.value, "Samsung Internet");
  assert.equal(row?.views, 2);
});

test("a bounce is counted only against the day's total, never against each page", async (t) => {
  await clear();
  t.after(clear);
  await prisma.pageView.createMany({ data: [view({ path: "/a" }), view({ path: "/b", sessionId: "s1" })] });
  await rollupDay(DAY);
  const paths = await prisma.trafficDaily.findMany({ where: { day: DAY, dimension: "path" } });
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map((row) => row.bounces), [0, 0]);
});

test("a day with no rows leaves no aggregate behind", async (t) => {
  await clear();
  t.after(clear);
  await prisma.pageView.createMany({ data: [view()] });
  await rollupDay(DAY);
  assert.ok(await prisma.trafficDaily.count({ where: { day: DAY } }) > 0);

  // The raw rows go, the day is recomputed: the stale aggregate must not survive it.
  await prisma.pageView.deleteMany({ where: { day: DAY } });
  await rollupDay(DAY);
  assert.equal(await prisma.trafficDaily.count({ where: { day: DAY } }), 0);
});

test("pruning removes raw rows past the window and leaves the aggregates", async (t) => {
  await clear();
  t.after(clear);
  await prisma.pageView.createMany({ data: [view({ day: OLD, ts: new Date(`${OLD}T12:00:00.000Z`) }), view()] });
  await rollupDay(OLD);
  await rollupDay(DAY);

  // A one-day window read from 1999-01-03 keeps everything from 1999-01-02 onwards, so
  // OLD falls outside it and DAY does not.
  const pruned = await pruneRaw(1, new Date("1999-01-03T12:00:00.000Z"));
  assert.equal(pruned.before, DAY);
  assert.equal(pruned.pageViews, 1);
  assert.equal(await prisma.pageView.count({ where: { day: OLD } }), 0);
  assert.equal(await prisma.pageView.count({ where: { day: DAY } }), 1);
  // The whole point of aggregating first: the day's numbers outlive its rows.
  assert.ok(await prisma.trafficDaily.count({ where: { day: OLD } }) > 0);
});

test("an unusable retention setting falls back rather than deleting everything", () => {
  const previous = process.env.ANALYTICS_RAW_RETENTION_DAYS;
  try {
    process.env.ANALYTICS_RAW_RETENTION_DAYS = "0";
    assert.equal(retentionDays(), 90);
    process.env.ANALYTICS_RAW_RETENTION_DAYS = "not a number";
    assert.equal(retentionDays(), 90);
    process.env.ANALYTICS_RAW_RETENTION_DAYS = "30";
    assert.equal(retentionDays(), 30);
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_RAW_RETENTION_DAYS;
    else process.env.ANALYTICS_RAW_RETENTION_DAYS = previous;
  }
});

test.after(async () => {
  await clear();
  await prisma.$disconnect();
});
