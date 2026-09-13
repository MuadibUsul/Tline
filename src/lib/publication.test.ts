import assert from "node:assert/strict";
import test from "node:test";
import { preferredEnglishDocuments, publicationReadyWhere } from "./publication";

test("an institution PDF hides a generated English copy", () => {
  const documents = [{ id: "native", kind: "source_native" }, { id: "generated", kind: "original_pdf" }];
  assert.deepEqual(preferredEnglishDocuments(documents).map((document) => document.id), ["native"]);
  assert.deepEqual(preferredEnglishDocuments([documents[1]]).map((document) => document.id), ["generated"]);
});

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
