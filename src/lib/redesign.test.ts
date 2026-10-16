import assert from "node:assert/strict";
import test from "node:test";
import { redesignAtLeast, redesignPhase } from "./redesign";

function withEnv(value: string | undefined, run: () => void) {
  const previous = process.env.TL_REDESIGN;
  if (value === undefined) delete process.env.TL_REDESIGN;
  else process.env.TL_REDESIGN = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TL_REDESIGN;
    else process.env.TL_REDESIGN = previous;
  }
}

test("the phase defaults to off — an unset or unknown value never turns the redesign on", () => {
  withEnv(undefined, () => assert.equal(redesignPhase(), "off"));
  withEnv("", () => assert.equal(redesignPhase(), "off"));
  withEnv("yes-please", () => assert.equal(redesignPhase(), "off"));
  withEnv("DESIGN-SYSTEM", () => assert.equal(redesignPhase(), "design-system"));
});

test("phases are ordered: each includes the ones before it", () => {
  withEnv("design-system", () => {
    assert.equal(redesignAtLeast("design-system"), true);
    assert.equal(redesignAtLeast("article"), false);
    assert.equal(redesignAtLeast("home"), false);
  });
  withEnv("article", () => {
    assert.equal(redesignAtLeast("design-system"), true);
    assert.equal(redesignAtLeast("article"), true);
    assert.equal(redesignAtLeast("home"), false);
  });
  withEnv("home", () => {
    assert.equal(redesignAtLeast("article"), true);
    assert.equal(redesignAtLeast("home"), true);
  });
  withEnv("all", () => {
    assert.equal(redesignAtLeast("design-system"), true);
    assert.equal(redesignAtLeast("article"), true);
    assert.equal(redesignAtLeast("home"), true);
  });
  withEnv("off", () => {
    assert.equal(redesignAtLeast("design-system"), false);
    assert.equal(redesignAtLeast("article"), false);
  });
});
