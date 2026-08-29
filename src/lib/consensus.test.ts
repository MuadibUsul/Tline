import assert from "node:assert/strict";
import test from "node:test";
import { CONSENSUS_WINDOW_HOURS, consensusSince } from "./consensus";

test("consensus uses a strict rolling 24-hour publication window", () => {
  const now = new Date("2026-08-27T12:30:00.000Z");
  assert.equal(CONSENSUS_WINDOW_HOURS, 24);
  assert.equal(consensusSince(now).toISOString(), "2026-08-26T12:30:00.000Z");
});

test("latest available consensus windows remain exactly 24 hours", () => {
  const latest = new Date("2026-08-28T16:00:00.000Z");
  assert.equal(consensusSince(latest).toISOString(), "2026-08-27T16:00:00.000Z");
});
