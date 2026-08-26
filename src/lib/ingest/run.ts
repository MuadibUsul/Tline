import "dotenv/config";
import Parser from "rss-parser";
import { prisma } from "../db";
import { fetchPdf, fetchText, sleep } from "./fetch";
import { extractLinks, extractArticle } from "./extract";
import { ensureAssets, persistArticle, type RawArticle } from "./store";
import { snapshotAll } from "../consensus";
import { fetchRobots, robotsAllows, robotsCrawlDelay, robotsSitemaps } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { extractPdf } from "../documents/extractPdf";
import { saveNativePdf } from "../documents/pdf";
import { urlHash } from "../hash";
import { renderHtml } from "./render";

// Usage:
//   npm run ingest                 -> priority-1 institutions (allowed/delayed only)
//   npm run ingest -- --slug=ubs   -> one institution
//   npm run ingest -- --all        -> every crawlable institution
//   npm run ingest -- --limit=3    -> cap articles per institution

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const rss = new Parser({ timeout: 15000 });
const UA = "InstitutionalIntelligenceBot";
const MIN_DELAY_MS = 1000; // politeness floor even when robots is silent

async function ingestInstitution(
  inst: { id: string; name: string; researchUrl: string; rssUrl: string | null; sitemapUrl: string | null; language: string; crawlDelay: number | null; requiresRender: boolean },
  perLimit: number,
) {
  const origin = new URL(inst.researchUrl).origin;

  // --- Runtime robots.txt compliance check (authoritative) ---
  const robotsTxt = await fetchRobots(origin);
  if (robotsTxt === null) {
    console.log(`  ${inst.name.padEnd(26)} PAUSE · robots unavailable and no valid 24h cache`);
    return 0;
  }
  if (robotsTxt && !robotsAllows(robotsTxt, UA, new URL(inst.researchUrl).pathname)) {
    console.log(`  ${inst.name.padEnd(26)} SKIP · robots disallows research path`);
    return 0;
  }
  const robotsDelaySec = robotsTxt ? robotsCrawlDelay(robotsTxt, UA) : undefined;
  const delayMs = Math.max(MIN_DELAY_MS, (robotsDelaySec ?? inst.crawlDelay ?? 0) * 1000);

  const allowsUrl = (u: string) => {
    try {
      return robotsAllows(robotsTxt, UA, new URL(u).pathname);
    } catch {
      return false;
    }
  };

  let created = 0, dup = 0, empty = 0, blocked = 0;
  const raws: RawArticle[] = [];
  const nativePdfs = new Map<string, Buffer>();

  // 1) RSS first when configured (and allowed).
  if (inst.rssUrl && allowsUrl(inst.rssUrl)) {
    try {
      const feed = await rss.parseURL(inst.rssUrl);
      for (const item of (feed.items || []).slice(0, perLimit)) {
        if (!item.link) continue;
        raws.push({
          title: item.title || "",
          text: (item.contentSnippet || item.content || item.title || "").toString(),
          sourceUrl: item.link,
          author: item.creator || null,
          publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
        });
      }
    } catch { /* fall through to HTML */ }
  }

  // 2) Sitemap/Sitemap Index discovery, including native research PDFs.
  if (raws.length === 0) {
    const sitemapSeeds = [
      ...robotsSitemaps(robotsTxt),
      ...(inst.sitemapUrl ? [inst.sitemapUrl] : []),
      `${origin}/sitemap.xml`,
    ];
    const candidates = await discoverFromSitemaps(sitemapSeeds, inst.researchUrl, {
      limit: perLimit,
      allows: allowsUrl,
    });
    for (const candidate of candidates) {
      if (!allowsUrl(candidate.url)) { blocked++; continue; }
      await sleep(delayMs);
      if (/\.pdf(?:$|\?)/i.test(candidate.url)) {
        const pdf = await fetchPdf(candidate.url);
        if (!pdf) continue;
        try {
          const extracted = await extractPdf(pdf);
          const filename = decodeURIComponent(new URL(candidate.url).pathname.split("/").pop() || "Research report")
            .replace(/\.pdf$/i, "")
            .replace(/[-_]+/g, " ")
            .trim();
          raws.push({
            title: filename || "Institutional research report",
            text: extracted.text,
            sourceUrl: candidate.url,
            author: null,
            publishedAt: candidate.lastModified || new Date(),
            segments: [{ heading: null, text: extracted.text }],
          });
          nativePdfs.set(candidate.url, pdf);
        } catch {
          empty++;
        }
      } else {
        let artHtml = await fetchText(candidate.url);
        if (!artHtml && inst.requiresRender) artHtml = await renderHtml(candidate.url);
        if (!artHtml) continue;
        let article = extractArticle(artHtml);
        if (article.text.length < 400 && inst.requiresRender) {
          const rendered = await renderHtml(candidate.url);
          if (rendered) article = extractArticle(rendered);
        }
        raws.push({
          title: article.title,
          text: article.text,
          sourceUrl: candidate.url,
          author: article.author,
          publishedAt: article.publishedAt || candidate.lastModified || new Date(),
          segments: article.segments,
          strict: true,
        });
      }
    }
  }

  // 3) HTML listing → per-article extraction, each URL robots-checked.
  if (raws.length === 0) {
    let listHtml = await fetchText(inst.researchUrl);
    let links = listHtml ? extractLinks(listHtml, inst.researchUrl).slice(0, perLimit) : [];
    if (links.length === 0 && inst.requiresRender) {
      listHtml = await renderHtml(inst.researchUrl);
      links = listHtml ? extractLinks(listHtml, inst.researchUrl).slice(0, perLimit) : [];
    }
    if (listHtml) {
      for (const link of links) {
        if (!allowsUrl(link.url)) { blocked++; continue; }
        await sleep(delayMs);
        let artHtml = await fetchText(link.url);
        if (!artHtml && inst.requiresRender) artHtml = await renderHtml(link.url);
        if (!artHtml) continue;
        let a = extractArticle(artHtml);
        if (a.text.length < 400 && inst.requiresRender) {
          const rendered = await renderHtml(link.url);
          if (rendered) a = extractArticle(rendered);
        }
        raws.push({
          title: a.title || link.title,
          text: a.text,
          sourceUrl: link.url,
          author: a.author,
          publishedAt: a.publishedAt || new Date(),
          segments: a.segments,
          strict: true, // HTML-extracted → enforce the full article check
        });
      }
    }
  }

  for (const r of raws) {
    const res = await persistArticle(inst.id, inst.name, r);
    if (res === "created") {
      created++;
      const native = nativePdfs.get(r.sourceUrl);
      if (native) {
        const article = await prisma.article.findUnique({ where: { urlHash: urlHash(r.sourceUrl) }, select: { id: true } });
        if (article) await saveNativePdf(article.id, r.sourceUrl, native);
      }
    }
    else if (res === "duplicate") dup++;
    else empty++;
  }
  const note = `delay ${delayMs}ms${robotsDelaySec ? " (robots)" : ""}${blocked ? ` · ${blocked} url blocked` : ""}`;
  console.log(`  ${inst.name.padEnd(26)} +${created} created · ${dup} dup · ${empty} empty · ${note}`);
  console.log(JSON.stringify({
    event: "ingest.source.complete",
    institution: inst.name,
    discovered: raws.length,
    created,
    duplicate: dup,
    empty,
    robotsBlocked: blocked,
    delayMs,
  }));
  return created;
}

async function main() {
  await ensureAssets();
  const perLimit = Number(arg("limit") || 6);
  const slug = arg("slug");

  // Compliance gate: never crawl blocked/manual institutions.
  const crawlable = { crawlPolicy: { in: ["allowed", "delayed"] } };
  const where = slug
    ? { slug, ...crawlable }
    : flag("all")
      ? crawlable
      : { priority: 1, ...crawlable };

  const institutions = await prisma.institution.findMany({
    where,
    orderBy: { priority: "asc" },
    select: { id: true, name: true, researchUrl: true, rssUrl: true, sitemapUrl: true, language: true, crawlDelay: true, requiresRender: true },
  });

  if (slug) {
    const exists = await prisma.institution.findUnique({ where: { slug }, select: { crawlPolicy: true, name: true } });
    if (exists && !["allowed", "delayed"].includes(exists.crawlPolicy)) {
      console.log(`Refusing to crawl "${exists.name}" — crawlPolicy=${exists.crawlPolicy} (robots blocked / needs manual review).`);
      await prisma.$disconnect();
      return;
    }
  }

  console.log(`Ingesting ${institutions.length} compliant institution(s), up to ${perLimit} articles each…`);
  let total = 0;
  for (const inst of institutions) total += await ingestInstitution(inst, perLimit);

  const snaps = await snapshotAll();
  console.log(`\nDone. ${total} new articles · ${snaps} consensus snapshots.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
