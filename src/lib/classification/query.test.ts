import assert from "node:assert/strict";
import test from "node:test";
import { classificationWhere } from "./query";

test("combines jurisdiction and topic as AND without cross-country leakage", () => {
  assert.deepEqual(classificationWhere({ jurisdictions: ["us"], topics: ["inflation"] }), {
    AND: [
      { jurisdictions: { some: { jurisdictionKey: { in: ["us"] } } } },
      { topics: { some: { topicKey: { in: ["inflation"] } } } },
    ],
  });
});

test("uses OR within one facet and AND across populated facets", () => {
  assert.deepEqual(classificationWhere({
    jurisdictions: ["japan"],
    topics: ["inflation", "employment"],
    events: ["cpi", "unemployment-rate"],
  }), {
    AND: [
      { jurisdictions: { some: { jurisdictionKey: { in: ["japan"] } } } },
      { topics: { some: { topicKey: { in: ["inflation", "employment"] } } } },
      { events: { some: { eventKey: { in: ["cpi", "unemployment-rate"] } } } },
    ],
  });
});

test("limits jurisdiction matching to PRIMARY only when requested", () => {
  assert.deepEqual(classificationWhere({ jurisdictions: ["us"], primaryJurisdictionOnly: true }), {
    AND: [{ jurisdictions: { some: { jurisdictionKey: { in: ["us"] }, role: "PRIMARY" } } }],
  });
});

test("filters subject institutions instead of Article publisher", () => {
  const where = classificationWhere({ institutions: ["federal-reserve"] });
  assert.deepEqual(where, {
    AND: [{ institutions: { some: { institutionKey: { in: ["federal-reserve"] } } } }],
  });
  assert.equal(JSON.stringify(where).includes("institutionId"), false);
});

test("keeps legacy pseudo-assets out of asset queries", () => {
  assert.deepEqual(classificationWhere({ assets: ["SPX", "FED", "CPI"] }), {
    AND: [{ assets: { some: { asset: { ticker: { in: ["SPX"] } } } } }],
  });
  assert.deepEqual(classificationWhere({ assets: ["FED"] }), {
    AND: [{ assets: { some: { asset: { ticker: { in: [] } } } } }],
  });
});

test("maps a date range only to content with a real event or publication date", () => {
  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-30T23:59:59.999Z");
  const range = { gte: from, lte: to };

  assert.deepEqual(classificationWhere({ dateRange: { from, to } }), {
    AND: [{
      OR: [
        { article: { publishedAt: range } },
        { macroRelease: { OR: [{ releasedAt: range }, { releasedAt: null, scheduledAt: range }] } },
        { policyDocument: { publishedAt: range } },
      ],
    }],
  });
});

test("returns an unrestricted where object for an empty filter", () => {
  assert.deepEqual(classificationWhere({}), {});
});
