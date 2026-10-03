import assert from "node:assert/strict";
import test from "node:test";
import { preferredEnglishDocuments, publicationReadyWhere } from "./publication";

const READY = {
  rawText: { not: null },
  withdrawnAt: null,
  OR: [
    { documents: { some: { kind: "source_native", locale: "en", status: "ready" } } },
    { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
  ],
};

test("an institution PDF hides a generated English copy", () => {
  const documents = [{ id: "native", kind: "source_native" }, { id: "generated", kind: "original_pdf" }];
  assert.deepEqual(preferredEnglishDocuments(documents).map((document) => document.id), ["native"]);
  assert.deepEqual(preferredEnglishDocuments([documents[1]]).map((document) => document.id), ["generated"]);
});

test("public research accepts either the publisher PDF or a generated English PDF", () => {
  assert.deepEqual(publicationReadyWhere({ id: "article-1" }) as { AND: unknown[] }, {
    AND: [READY, { OR: [{ indexableEn: true }, { indexableZh: true }] }, { id: "article-1" }],
  });
});

test("with no language, a report has to be public in at least one", () => {
  // Every caller of this function is a public surface — consensus, alerts, the read API,
  // search, a watchlist. A report the gate withholds at both addresses is not published, and
  // letting it into a score or a result list is how a reader reaches a 404 from inside the site.
  const where = publicationReadyWhere() as { AND: Array<Record<string, unknown>> };
  assert.deepEqual(where.AND[1], { OR: [{ indexableEn: true }, { indexableZh: true }] });
});

test("a language asks the gate's verdict for that language", () => {
  // English used to be ungated — it is the fallback language, and a report with a body was
  // assumed to have an English page. It does not: the page withholds a report whose title is a
  // document label, whose body is thin, or whose analysis is still in review, and the feed was
  // advertising exactly those. That is what a reader experiences as a dead link.
  assert.deepEqual(publicationReadyWhere(undefined, "en") as { AND: Array<Record<string, unknown>> }, {
    AND: [READY, { indexableEn: true }],
  });
  // Chinese is where the weaker rule hurt most: "has a translation row, or predates the cutoff"
  // let a report whose Chinese page the gate then sends to English be listed under /zh, so a
  // reader browsing Chinese was handed English.
  assert.deepEqual(publicationReadyWhere(undefined, "zh-CN") as { AND: Array<Record<string, unknown>> }, {
    AND: [READY, { indexableZh: true }],
  });
});

test("a withdrawn report is not published anywhere", () => {
  // One clause, read by every public surface — so a takedown cannot be half-applied by a
  // listing that forgot to filter. The alternative was nulling `rawText`, which destroys
  // the body the corrections and audit surfaces are kept for.
  const where = publicationReadyWhere() as { AND: Array<Record<string, unknown>> };
  const ready = where.AND[0] as Record<string, unknown>;
  assert.equal(ready.withdrawnAt, null);
  assert.deepEqual(ready.rawText, { not: null });
  // The clause survives being combined with a caller's own filter, which is how every
  // listing that narrows the set reaches it.
  const combined = publicationReadyWhere({ id: "article-1" }) as { AND: Array<Record<string, unknown>> };
  assert.equal((combined.AND[0] as Record<string, unknown>).withdrawnAt, null);
});
