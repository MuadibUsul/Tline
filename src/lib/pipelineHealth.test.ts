import assert from "node:assert/strict";
import test from "node:test";

// The judgement the watchdog makes, kept under test independently of the database it
// reads. What matters is that silence counts as a fault: every other signal in the system
// reports something failing, and a pass that succeeds while returning nothing does not.
function stallReasons(input: {
  articleAgeHours: number | null;
  viewAgeHours: number | null;
  crawlableSources: number;
  workingSources: number;
}, stallHours = 6, viewStallHours = 12) {
  const reasons: string[] = [];
  if (input.articleAgeHours === null) reasons.push("no research has ever been stored");
  else if (input.articleAgeHours > stallHours) reasons.push(`no research stored for ${input.articleAgeHours.toFixed(1)}h`);
  if (input.articleAgeHours !== null && input.viewAgeHours !== null && input.viewAgeHours > viewStallHours) {
    reasons.push(`no views extracted for ${input.viewAgeHours.toFixed(1)}h`);
  }
  if (input.crawlableSources > 0 && input.workingSources === 0) reasons.push("no source has succeeded in 24h");
  return reasons;
}

test("a working pipeline reports nothing", () => {
  assert.deepEqual(stallReasons({ articleAgeHours: 0.5, viewAgeHours: 0.6, crawlableSources: 56, workingSources: 10 }), []);
});

test("silence is a fault, even when every pass succeeded", () => {
  // The failure that actually happened: nothing errored, nothing arrived, and a person
  // noticed before the system did.
  const reasons = stallReasons({ articleAgeHours: 9, viewAgeHours: 9, crawlableSources: 56, workingSources: 4 });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /no research stored/);
});

test("views are given longer than research before silence counts", () => {
  // Views lag the research they are drawn from, so an hour without them means nothing.
  assert.deepEqual(stallReasons({ articleAgeHours: 1, viewAgeHours: 8, crawlableSources: 56, workingSources: 10 }), []);
  assert.equal(stallReasons({ articleAgeHours: 1, viewAgeHours: 13, crawlableSources: 56, workingSources: 10 }).length, 1);
});

test("sources that all succeed while returning nothing are reported", () => {
  const reasons = stallReasons({ articleAgeHours: 1, viewAgeHours: 1, crawlableSources: 56, workingSources: 0 });
  assert.deepEqual(reasons, ["no source has succeeded in 24h"]);
});

test("an empty corpus is reported rather than read as quiet", () => {
  assert.match(stallReasons({ articleAgeHours: null, viewAgeHours: null, crawlableSources: 56, workingSources: 0 })[0]!, /has ever been stored/);
});
