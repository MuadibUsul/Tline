import assert from "node:assert/strict";
import test from "node:test";
import { backfillChunks } from "./backfill";

test("backfill chunks are chronological, bounded and non-overlapping", () => {
  const chunks = backfillChunks(new Date("2024-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), 1);
  assert.deepEqual(chunks.map((chunk) => [chunk.from.toISOString().slice(0, 10), chunk.to.toISOString().slice(0, 10)]), [
    ["2024-01-01", "2024-12-31"], ["2025-01-01", "2025-12-31"], ["2026-01-01", "2026-02-01"],
  ]);
});
