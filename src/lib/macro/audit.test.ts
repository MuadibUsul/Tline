import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { periodMatchesFrequency, valuesMateriallyDisagree } from "./audit";

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
