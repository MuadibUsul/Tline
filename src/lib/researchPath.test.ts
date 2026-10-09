import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchSlug, researchLookupWhere, researchPath, researchRedirectPath } from "./researchPath";

test("research slugs are readable, bounded, deterministic and fingerprinted", () => {
  const input = {
    institution: "Intesa Sanpaolo",
    title: "Macro · Weekly Economic Monitor Viewpoint",
    fingerprint: "5zt1r000m2y38nyu44hs0",
  };
  const slug = buildResearchSlug(input);
  assert.equal(slug, "intesa-sanpaolo-macro-weekly-economic-monitor-viewpoint-5zt1r000m2");
  assert.equal(buildResearchSlug(input), slug);
  assert.ok(slug.length <= 120);
  assert.equal(researchPath({ slug }), `/research/${slug}`);
});

test("research slugs normalize punctuation and accents", () => {
  assert.equal(
    buildResearchSlug({ institution: "Société Générale", title: "Rates & FX: Q4", fingerprint: "ABC-1234567890" }),
    "societe-generale-rates-and-fx-q4-abc1234567",
  );
});

test("stored slugs remain canonical while historical IDs take one redirect", () => {
  const reports = Array.from({ length: 10 }, (_, index) => ({ id: `legacy-id-${index}`, slug: `publisher-report-${index}-abcdef1234` }));
  for (const report of reports) {
    assert.deepEqual(researchLookupWhere(report.id), { OR: [{ id: report.id }, { slug: report.id }] });
    assert.equal(researchRedirectPath(report.id, report), researchPath(report));
    assert.equal(researchRedirectPath(report.slug, report), null);
    // Two language URLs per report: 20 bilingual canonical/new-old mapping groups.
    assert.equal(`/en${researchRedirectPath(report.id, report)}`, `/en/research/${report.slug}`);
    assert.equal(`/zh${researchRedirectPath(report.id, report)}`, `/zh/research/${report.slug}`);
  }
});

test("a repaired title cannot change a stored public URL", () => {
  const article = { slug: "bank-original-title-abcdef1234", title: "Original title" };
  const before = researchPath(article);
  article.title = "A materially better repaired title";
  assert.equal(researchPath(article), before);
});
