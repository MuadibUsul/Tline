import assert from "node:assert/strict";
import test from "node:test";
import { publicationReadyWhere } from "./publication";

test("public research requires complete source text and an English PDF", () => {
  assert.deepEqual(publicationReadyWhere({ id: "article-1" }), {
    AND: [
      {
        rawText: { not: null },
        documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } },
      },
      { id: "article-1" },
    ],
  });
});
