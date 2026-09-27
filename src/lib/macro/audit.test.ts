import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { periodMatchesFrequency, valuesMateriallyDisagree } from "./audit";
import { macroProviderFactories } from "./providers";
import { macroSources } from "./registry";

/**
 * The audit answers `UNKNOWN_PROVIDER` at `severe` severity for a provider it does not
 * recognise, and `scripts/macro-audit.ts` exits non-zero on a severe issue. So a name in the
 * source registry that the provider registry does not implement does not fail loudly where
 * it belongs — it turns the command into one that always fails, which is how a real
 * integrity problem goes unread. This is the check that keeps the two registries together.
 */
test("every provider named by the source registry exists", () => {
  const unknown = [...new Set(macroSources.map((source) => source.provider))]
    .filter((provider) => !(provider in macroProviderFactories));
  assert.deepEqual(unknown, [], `sources.json names providers the registry does not implement: ${unknown.join(", ")}`);
});

test("audit frequency alignment is deterministic", () => {
  assert.equal(periodMatchesFrequency(new Date("2026-04-01T00:00:00Z"), "QUARTERLY"), true);
  assert.equal(periodMatchesFrequency(new Date("2026-05-01T00:00:00Z"), "QUARTERLY"), false);
  assert.equal(periodMatchesFrequency(new Date("2026-05-02T00:00:00Z"), "MONTHLY"), false);
  assert.equal(periodMatchesFrequency(new Date("2026-05-02T00:00:00Z"), "DAILY"), true);
});

test("audit reconciliation tolerates official-source rounding only", () => {
  assert.equal(valuesMateriallyDisagree([new Prisma.Decimal("27114.792"), new Prisma.Decimal("27114.8")]), false);
  assert.equal(valuesMateriallyDisagree([new Prisma.Decimal("130.658"), new Prisma.Decimal("93.419")]), true);
});
