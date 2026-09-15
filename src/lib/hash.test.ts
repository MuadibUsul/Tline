import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, urlHash } from "./hash";

test("tracking params, AMP and trailing slashes are canonicalized away", () => {
  assert.equal(canonicalizeUrl("https://x.com/a/?utm_source=n&keep=1"), "https://x.com/a?keep=1");
  assert.equal(canonicalizeUrl("https://x.com/a/amp/"), "https://x.com/a");
});

test("State Street regional copies of one report share a canonical URL and hash", () => {
  const base = "institutional/insights/emerging-market-debt-market-commentary-aug-2026";
  const regional = [
    `https://www.ssga.com/nz/en_gb/${base}`,
    `https://www.ssga.com/sg/en/${base}`,
    `https://www.ssga.com/hk/en/${base}`,
    `https://www.ssga.com/us/en/${base}`,
  ];
  const canonical = regional.map(canonicalizeUrl);
  assert.equal(new Set(canonical).size, 1, "all regions collapse to one canonical URL");
  assert.equal(canonical[0], `https://www.ssga.com/${base}`);
  assert.equal(new Set(regional.map(urlHash)).size, 1, "all regions share one urlHash");
});

test("distinct State Street reports stay distinct, and non-SSGA hosts are untouched", () => {
  assert.notEqual(
    urlHash("https://www.ssga.com/us/en/institutional/insights/report-a"),
    urlHash("https://www.ssga.com/us/en/institutional/insights/report-b"),
  );
  // A leading /xx/yy segment on another host must not be mistaken for a region prefix.
  assert.equal(canonicalizeUrl("https://www.ing.com/nl/en/research/foo"), "https://www.ing.com/nl/en/research/foo");
});
