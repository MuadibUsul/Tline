import assert from "node:assert/strict";
import test from "node:test";
import { publicationReadyWhere } from "./publication";

test("public research accepts either the publisher PDF or a generated English PDF", () => {
  assert.deepEqual(publicationReadyWhere({ id: "article-1" }), {
    AND: [
      {
        rawText: { not: null },
        OR: [
          { documents: { some: { kind: "source_native", locale: "en", status: "ready" } } },
          { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
        ],
      },
      { id: "article-1" },
    ],
  });
});
