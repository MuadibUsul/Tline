import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchSlug, researchPath } from "./researchPath";

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
