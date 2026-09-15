import "dotenv/config";
import { prisma } from "../src/lib/db";
import { canonicalizeUrl, urlHash } from "../src/lib/hash";

/**
 * Reconcile reports that are the same publication reached at more than one URL — chiefly a
 * State Street report syndicated across its regional sites (/nz, /sg, /hk, /us), which
 * defeated exact-URL and exact-content dedup and left three near-identical cards in the
 * feed. Grouping is by the canonical URL (see `canonicalizeUrl`), so any publisher whose
 * region/locale prefix is stripped there is covered.
 *
 * Two things happen, both needed after the canonicalization went live:
 *  - duplicate groups are merged down to the most complete row;
 *  - every survivor's `urlHash` is repointed at the canonical URL, so a later crawl of any
 *    regional copy dedups to it instead of creating a fresh row (without this, an existing
 *    single-region report would be duplicated the next time it is crawled).
 *
 * Dry-run by default; pass --apply to write.
 */

const apply = process.argv.includes("--apply");

// A survivor is chosen to lose the least: keep the most finished, most complete row, and
// prefer a properly-cased title over a degraded lowercase one ("aug 26 emd monthly
// commentary") when everything else ties.
function score(a: { rawTextLen: number; hasAnalysis: boolean; hasZh: boolean; title: string; createdAt: Date }) {
  const properTitle = /[A-Z]/.test(a.title) && a.title !== a.title.toLowerCase();
  return [
    a.hasZh ? 1 : 0,
    a.hasAnalysis ? 1 : 0,
    a.rawTextLen,
    properTitle ? 1 : 0,
    -a.createdAt.getTime(), // earliest ingested breaks the final tie
  ];
}
function better(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function main() {
  const rows = await prisma.article.findMany({ select: { id: true, sourceUrl: true, urlHash: true } });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = canonicalizeUrl(row.sourceUrl);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  const duplicated = [...groups.values()].filter((g) => g.length > 1);
  const staleSingles = [...groups.values()].filter((g) => g.length === 1 && g[0].urlHash !== urlHash(g[0].sourceUrl));
  console.log(`${rows.length} reports · ${duplicated.length} duplicate groups · ${staleSingles.length} single reports whose hash needs repointing${apply ? "" : "  (dry-run — pass --apply to write)"}`);

  // 1) Merge duplicate groups.
  let merged = 0;
  let removed = 0;
  for (const group of duplicated) {
    const ids = group.map((r) => r.id);
    const canonical = canonicalizeUrl(group[0].sourceUrl);
    const members = await prisma.article.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, title: true, sourceUrl: true, urlHash: true, createdAt: true, rawText: true,
        analysis: { select: { id: true } },
        translations: { where: { locale: "zh-CN" }, select: { id: true } },
      },
    });
    const scored = members.map((m) => ({
      m,
      s: score({ rawTextLen: m.rawText?.length ?? 0, hasAnalysis: !!m.analysis, hasZh: m.translations.length > 0, title: m.title, createdAt: m.createdAt }),
    }));
    let keep = scored[0];
    for (const c of scored) if (better(c.s, keep.s)) keep = c;
    const drop = members.filter((m) => m.id !== keep.m.id);

    // Never delete a report a social draft points at (sourceId is not a FK): removing it
    // would strand the draft. Leave the whole group untouched and flag it.
    const draftBlocked = await prisma.socialDraft.findFirst({ where: { sourceKind: "research", sourceId: { in: drop.map((m) => m.id) } }, select: { id: true } });
    if (draftBlocked) {
      console.log(`  SKIP (social draft references a duplicate) · ${canonical}`);
      continue;
    }

    console.log(`  ${canonical}`);
    console.log(`    keep   ${keep.m.id} · ${keep.m.title}`);
    for (const m of drop) console.log(`    remove ${m.id} · ${m.title}`);

    if (apply) {
      const canonicalHash = urlHash(keep.m.sourceUrl);
      await prisma.$transaction(async (tx) => {
        await tx.article.deleteMany({ where: { id: { in: drop.map((m) => m.id) } } });
        if (keep.m.urlHash !== canonicalHash) await tx.article.update({ where: { id: keep.m.id }, data: { urlHash: canonicalHash } });
      });
    }
    merged++;
    removed += drop.length;
  }

  // 2) Repoint stale single-report hashes so a re-crawl dedups instead of duplicating.
  let repointed = 0;
  for (const group of staleSingles) {
    const single = group[0];
    if (apply) await prisma.article.update({ where: { id: single.id }, data: { urlHash: urlHash(single.sourceUrl) } });
    repointed++;
  }

  console.log(`${apply ? "Merged" : "Would merge"} ${merged} groups, ${apply ? "removed" : "removing"} ${removed} duplicates; ${apply ? "repointed" : "would repoint"} ${repointed} single hashes.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
