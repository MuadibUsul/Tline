import assert from "node:assert/strict";
import test from "node:test";
import { buildEiaSchedule, parseBeaSchedule, parseBlsIcs, parseFomcCalendar, syncCalendarCandidates } from "./calendar";
import { macroReleaseKey, persistCalendarRelease, type CalendarReleaseCandidate, type ReleaseRepository } from "./release";

type Write = Parameters<ReleaseRepository["create"]>[0];

class FakeRepository implements ReleaseRepository {
  rows = new Map<string, Write & { id: string }>();
  async find(releaseKey: string) {
    const row = this.rows.get(releaseKey);
    return row ? { id: row.id, scheduledAt: row.scheduledAt, status: row.status, sourceUrl: row.sourceUrl, sourceTimezone: row.sourceTimezone } : null;
  }
  async findAt(releaseFamily: string, scheduledAt: Date) {
    const row = [...this.rows.values()].find((item) => item.releaseFamily === releaseFamily && item.scheduledAt.getTime() === scheduledAt.getTime());
    return row ? { id: row.id, scheduledAt: row.scheduledAt, status: row.status, sourceUrl: row.sourceUrl, sourceTimezone: row.sourceTimezone } : null;
  }
  async create(data: Write) {
    const row = { ...data, id: `release-${this.rows.size + 1}` };
    this.rows.set(data.releaseKey, row);
    return { id: row.id };
  }
  async update(id: string, data: Write) {
    const oldKey = [...this.rows].find(([, row]) => row.id === id)?.[0];
    if (oldKey) this.rows.delete(oldKey);
    this.rows.set(data.releaseKey, { ...data, id });
  }
}

const candidate = (externalReleaseId: string, scheduledAt: string): CalendarReleaseCandidate => ({
  releaseFamily: "BLS_CPI",
  externalReleaseId,
  scheduledAt: new Date(scheduledAt),
  sourceTimezone: "America/New_York",
  sourceUrl: "https://www.bls.gov/schedule/news_release/bls.ics",
  sourceKind: "OFFICIAL",
});

test("calendar parsing converts Eastern wall time across DST", () => {
  const rows = parseBeaSchedule(`<table>
    <tr><td class="scheduled-date"><div class="release-date">March 13</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, February 2026</td></tr>
    <tr><td class="scheduled-date"><div class="release-date">November 10</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, October 2026</td></tr>
  </table>`, 2026);
  assert.deepEqual(rows.map((row) => row.scheduledAt.toISOString()), ["2026-03-13T12:30:00.000Z", "2026-11-10T13:30:00.000Z"]);
});

test("duplicate calendar sync is idempotent", async () => {
  const repository = new FakeRepository();
  const release = candidate("bls-cpi-2026-09", "2026-09-11T12:30:00Z");
  assert.equal((await persistCalendarRelease(repository, release)).status, "created");
  assert.equal((await persistCalendarRelease(repository, release)).status, "unchanged");
  assert.equal(repository.rows.size, 1);
});

test("a rescheduled event updates the existing deterministic release", async () => {
  const repository = new FakeRepository();
  const original = candidate("bls-cpi-2026-10", "2026-10-14T12:30:00Z");
  const delayed = { ...original, scheduledAt: new Date("2026-10-15T12:30:00Z"), status: "DELAYED" as const };
  const first = await persistCalendarRelease(repository, original);
  const second = await persistCalendarRelease(repository, delayed);
  assert.equal(second.status, "updated");
  assert.equal(first.releaseKey, second.releaseKey);
  assert.equal(repository.rows.size, 1);
  assert.equal(repository.rows.get(macroReleaseKey(original.releaseFamily, original.externalReleaseId))?.scheduledAt.toISOString(), "2026-10-15T12:30:00.000Z");
});

test("a release missing from the next feed is retained", async () => {
  const repository = new FakeRepository();
  const first = candidate("bls-cpi-2026-09", "2026-09-11T12:30:00Z");
  const second = candidate("bls-cpi-2026-10", "2026-10-14T12:30:00Z");
  const persist = (value: CalendarReleaseCandidate) => persistCalendarRelease(repository, value);
  await syncCalendarCandidates([first, second], persist);
  await syncCalendarCandidates([second], persist);
  assert.equal(repository.rows.size, 2);
});

test("same-day releases remain distinct", () => {
  const rows = parseBeaSchedule(`<table>
    <tr><td class="scheduled-date"><div class="release-date">September 30</div><small>8:30 AM</small></td><td class="release-title">GDP (Third Estimate), 2nd Quarter 2026</td></tr>
    <tr><td class="scheduled-date"><div class="release-date">September 30</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, August 2026</td></tr>
  </table>`, 2026);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].scheduledAt.getTime(), rows[1].scheduledAt.getTime());
  assert.notEqual(rows[0].releaseFamily, rows[1].releaseFamily);
});

test("official BLS, FOMC and EIA formats retain stable event identities", () => {
  const bls = parseBlsIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cpi-2026-09@bls.gov\nDTSTART;TZID=US-Eastern:20260911T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nEND:VCALENDAR`);
  assert.equal(bls[0].externalReleaseId, "bls:cpi-2026-09@bls.gov");
  assert.equal(bls[0].scheduledAt.toISOString(), "2026-09-11T12:30:00.000Z");

  const fomc = parseFomcCalendar(`<div class="panel"><div class="panel-heading"><h4>2026 FOMC Meetings</h4></div><div class="row fomc-meeting"><div class="fomc-meeting__month">September</div><div class="fomc-meeting__date">15-16*</div></div></div>`);
  assert.equal(fomc[0].scheduledAt.toISOString(), "2026-09-16T18:00:00.000Z");

  const eia = buildEiaSchedule(`<table><tr><th>September 4, 2026</th><td>September 10, 2026</td><td>Thursday</td><td>12:00 p.m.</td><td>Labor Day</td></tr></table>`, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-15T23:59:59Z"));
  assert.equal(eia.find((row) => row.externalReleaseId === "eia:wpsr:2026-09-04")?.status, "DELAYED");
  assert.equal(eia.find((row) => row.externalReleaseId === "eia:wpsr:2026-09-04")?.scheduledAt.toISOString(), "2026-09-10T16:00:00.000Z");
});
