import assert from "node:assert/strict";
import test from "node:test";

// The predicate the global boundary uses, kept here so its shape is pinned by a test
// rather than only by the component that happens to contain it.
function isStaleBuild(error: Error) {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    `${error.name} ${error.message}`,
  );
}

test("a page left open across a release is recognised by its failure", () => {
  const stale = [
    Object.assign(new Error("Loading chunk 493 failed."), { name: "ChunkLoadError" }),
    new Error("Failed to fetch dynamically imported module: https://tlines.tech/_next/static/chunks/a.js"),
    new Error("Importing a module script failed."),
  ];
  for (const error of stale) assert.equal(isStaleBuild(error), true, error.message);
});

test("an ordinary fault is not treated as a stale build", () => {
  // Reloading would not help these, and looping the browser on them would hide the fault.
  const real = [
    new TypeError("Cannot read properties of undefined (reading 'map')"),
    new Error("Request failed with status 500"),
    new Error("consensus window is empty"),
  ];
  for (const error of real) assert.equal(isStaleBuild(error), false, error.message);
});
