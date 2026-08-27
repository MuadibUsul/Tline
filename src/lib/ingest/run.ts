import "dotenv/config";
import Parser from "rss-parser";
import { prisma } from "../db";
import { fetchPdf, fetchText, sleep } from "./fetch";
import { extractLinks, extractArticle, inferPublicationDate } from "./extract";
import { ensureAssets, persistArticle, type RawArticle } from "./store";
import { snapshotAll } from "../consensus";
import { fetchRobots, robotsAllows, robotsCrawlDelay, robotsSitemaps } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { extractPdf } from "../documents/extractPdf";
import { generateArticleDocuments, saveNativePdf } from "../documents/pdf";
import { urlHash } from "../hash";
import { renderHtml } from "./render";
import { runTrackedJob } from "../jobs";

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
  await prisma.institution.update({
    where: { id: inst.id },
    data: { lastCrawlAt: new Date(), lastCrawlStatus: "running", lastCrawlMessage: null },
  });
  const finish = async (status: "succeeded" | "paused" | "refused", message: string, created: number) => {
    await prisma.institution.update({
      where: { id: inst.id },
      data: {
        lastCrawlStatus: status,
        lastCrawlMessage: message.slice(0, 1000),
        ...(status === "succeeded" ? { lastSuccessAt: new Date() } : {}),
      },
    });
    return created;
  };
  const origin = new URL(inst.researchUrl).origin;

  // --- Runtime robots.txt compliance check (authoritative) ---
  const robotsTxt = await fetchRobots(origin);
  if (robotsTxt === null) {
    console.log(`  ${inst.name.padEnd(26)} PAUSE · robots unavailable and no valid 24h cache`);
    return finish("paused", "robots unavailable and no valid 24h cache", 0);
  }
  if (robotsTxt && !robotsAllows(robotsTxt, UA, new URL(inst.researchUrl).pathname)) {
    console.log(`  ${inst.name.padEnd(26)} SKIP · robots disallows research path`);
    return finish("refused", "robots disallows research path", 0);
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
        if (!item.link || !allowsUrl(item.link)) continue;
        await sleep(delayMs);
        if (/\.pdf(?:$|\?)/i.test(item.link)) {
          const pdf = await fetchPdf(item.link);
          if (!pdf) continue;
          const extracted = await extractPdf(pdf);
          const publishedAt = (item.isoDate ? new Date(item.isoDate) : null) || inferPublicationDate(item.link, item.title);
          if (!publishedAt || isNaN(publishedAt.getTime())) { empty++; continue; }
          raws.push({
            title: item.title || "Institutional research report",
            text: extracted.text,
            sourceUrl: item.link,
            author: item.creator || null,
            publishedAt,
            segments: [{ heading: null, text: extracted.text }],
            strict: true,
          });
          nativePdfs.set(item.link, pdf);
          continue;
        }
        let html = await fetchText(item.link);
        if (!html && inst.requiresRender) html = await renderHtml(item.link);
        if (!html) continue;
        let article = extractArticle(html);
        if (article.text.length < 400 && inst.requiresRender) {
          const rendered = await renderHtml(item.link);
          if (rendered) article = extractArticle(rendered);
        }
        const publishedAt = article.publishedAt || (item.isoDate ? new Date(item.isoDate) : null) || inferPublicationDate(item.link, item.title);
        if (!publishedAt || isNaN(publishedAt.getTime())) { empty++; continue; }
        raws.push({
          title: article.title || item.title || "",
          text: article.text,
          sourceUrl: item.link,
          author: article.author || item.creator || null,
          publishedAt,
          segments: article.segments,
          strict: true,
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
          const publishedAt = candidate.lastModified || inferPublicationDate(candidate.url, filename);
          if (!publishedAt) { empty++; continue; }
          raws.push({
            title: filename || "Institutional research report",
            text: extracted.text,
            sourceUrl: candidate.url,
            author: null,
            publishedAt,
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
        const publishedAt = article.publishedAt || candidate.lastModified || inferPublicationDate(candidate.url, article.title);
        if (!publishedAt) { empty++; continue; }
        raws.push({
          title: article.title,
          text: article.text,
          sourceUrl: candidate.url,
          author: article.author,
          publishedAt,
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
        const publishedAt = a.publishedAt || inferPublicationDate(link.url, a.title || link.title);
        if (!publishedAt) { empty++; continue; }
        raws.push({
          title: a.title || link.title,
          text: a.text,
          sourceUrl: link.url,
          author: a.author,
          publishedAt,
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
      const article = await prisma.article.findUnique({ where: { urlHash: urlHash(r.sourceUrl) }, select: { id: true } });
      const native = nativePdfs.get(r.sourceUrl);
      if (native && article) await saveNativePdf(article.id, r.sourceUrl, native);
      if (article) {
        try {
          await generateArticleDocuments(article.id);
        } catch (error) {
          console.error(`  document generation failed for ${r.sourceUrl}`, error);
        }
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
  return finish("succeeded", `${raws.length} discovered · ${created} created · ${dup} duplicate · ${empty} empty · ${blocked} blocked`, created);
}

async function executeIngest() {
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
    const exists = await prisma.institution.findUnique({ where: { slug }, select: { id: true, crawlPolicy: true, name: true } });
    if (exists && !["allowed", "delayed"].includes(exists.crawlPolicy)) {
      console.log(`Refusing to crawl "${exists.name}" — crawlPolicy=${exists.crawlPolicy} (robots blocked / needs manual review).`);
      await prisma.institution.update({
        where: { id: exists.id },
        data: { lastCrawlAt: new Date(), lastCrawlStatus: "refused", lastCrawlMessage: `crawlPolicy=${exists.crawlPolicy}` },
      });
      return { institutions: 0, articlesCreated: 0, consensusSnapshots: 0, refused: true };
    }
  }

  console.log(`Ingesting ${institutions.length} compliant institution(s), up to ${perLimit} articles each…`);
  let total = 0;
  let failedSources = 0;
  for (const inst of institutions) {
    try {
      total += await ingestInstitution(inst, perLimit);
    } catch (error) {
      failedSources++;
      await prisma.institution.update({
        where: { id: inst.id },
        data: { lastCrawlStatus: "failed", lastCrawlMessage: String(error).slice(0, 1000) },
      });
      console.error(JSON.stringify({ event: "ingest.source.failed", institution: inst.name, error: String(error) }));
    }
  }

  const snaps = await snapshotAll();
  console.log(`\nDone. ${total} new articles · ${snaps} consensus snapshots.`);
  return { institutions: institutions.length, failedSources, articlesCreated: total, consensusSnapshots: snaps, refused: false };
}

async function main() {
  const parameters = { slug: arg("slug") ?? null, limit: Number(arg("limit") || 6), all: flag("all") };
  await runTrackedJob("ingest", parameters, async () => {
    const metrics = await executeIngest();
    return { result: undefined, metrics };
  }, Math.max(1, Number(arg("attempt") || 1)));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
