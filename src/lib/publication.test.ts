import assert from "node:assert/strict";
import test from "node:test";
import { publicationReadyWhere } from "./publication";

test("public research requires the complete reviewed bilingual package", () => {
  assert.deepEqual(publicationReadyWhere({ id: "article-1" }), {
    AND: [
      {
        rawText: { not: null },
        analysis: { is: { reviewStatus: "ok" } },
        documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } },
        translations: { some: { locale: "zh-CN", status: "reviewed", documents: { some: { kind: "translation_pdf", locale: "zh-CN", status: "ready" } } } },
      },
      { id: "article-1" },
    ],
  });
});
