import "dotenv/config";
import Parser from "rss-parser";
import { prisma } from "../db";
import { fetchPdf, fetchText, lastFetchStatus, sleep } from "./fetch";
import { extractLinks, extractArticle, extractPdfLinks, inferPublicationDate, looksLikeArticle, looksLikeResearchTopic } from "./extract";
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

  let created = 0, dup = 0, empty = 0, blocked = 0, nativeRejected = 0;
  const raws: RawArticle[] = [];
  const nativePdfs = new Map<string, Buffer>();
  const candidateLimit = Math.min(40, Math.max(12, perLimit * 4));
  const stage = (raw: RawArticle) => {
    if (isNaN(raw.publishedAt.getTime()) || raw.publishedAt.getTime() > Date.now() + 864e5) { empty++; return false; }
    if (raw.strict && !looksLikeArticle(raw.title, raw.text)) { empty++; return false; }
    raws.push(raw);
    return true;
  };
  const knownUrl = async (url: string) => Boolean(await prisma.article.findUnique({
    where: { urlHash: urlHash(url) },
    select: { id: true },
  }));
  const stageEmbeddedPdf = async (html: string, pageUrl: string, title: string, publishedAt: Date | null) => {
    let staged = false;
    for (const pdfUrl of extractPdfLinks(html, pageUrl)) {
      if (raws.length >= perLimit) break;
      if (!allowsUrl(pdfUrl) || await knownUrl(pdfUrl)) continue;
      await sleep(delayMs);
      const pdf = await fetchPdf(pdfUrl);
      if (!pdf) continue;
      try {
        const extracted = await extractPdf(pdf);
        const date = inferPublicationDate(pdfUrl, extracted.text.slice(0, 1000)) || publishedAt || inferPublicationDate(pageUrl, title);
        if (!date || !extracted.text.trim()) continue;
        const filename = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() || "Research report")
          .replace(/\.pdf$/i, "")
          .replace(/(?:[a-z]{0,2})?20\d{6}[a-z]?$/i, "")
          .replace(/[-_]+/g, " ")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .trim();
        const pageLabel = title.split(/[;|]/).at(-1)?.trim() || title;
        const documentTitle = title && !/^(?:research|insights?|publications?|reports?)$/i.test(pageLabel) ? title : filename;
        if (!looksLikeResearchTopic(documentTitle, extracted.text)) continue;
        const accepted = stage({
          title: documentTitle,
          text: extracted.text,
          sourceUrl: pdfUrl,
          author: null,
          publishedAt: date,
          segments: [{ heading: null, text: extracted.text }],
          strict: true,
        });
        if (accepted) {
          nativePdfs.set(pdfUrl, pdf);
          staged = true;
        }
      } catch { /* try another PDF link */ }
    }
    return staged;
  };

  // 1) RSS first when configured (and allowed).
  if (inst.rssUrl && allowsUrl(inst.rssUrl)) {
    try {
      const feed = await rss.parseURL(inst.rssUrl);
      for (const item of (feed.items || []).slice(0, candidateLimit)) {
        if (raws.length >= perLimit) break;
        if (!item.link || !allowsUrl(item.link)) continue;
        if (await knownUrl(item.link)) { dup++; continue; }
        await sleep(delayMs);
        if (/\.pdf(?:$|\?)/i.test(item.link)) {
          const pdf = await fetchPdf(item.link);
          if (!pdf) continue;
          const extracted = await extractPdf(pdf);
          const publishedAt = (item.isoDate ? new Date(item.isoDate) : null) || inferPublicationDate(item.link, item.title);
          if (!publishedAt || isNaN(publishedAt.getTime())) { empty++; continue; }
          if (!looksLikeResearchTopic(item.title || "", extracted.text)) { empty++; continue; }
          stage({
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
          if (rendered) {
            html = rendered;
            article = extractArticle(rendered);
          }
        }
        const publishedAt = article.publishedAt || (item.isoDate ? new Date(item.isoDate) : null) || inferPublicationDate(item.link, item.title);
        if (!publishedAt || isNaN(publishedAt.getTime())) { empty++; continue; }
        stage({
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
      limit: candidateLimit,
      allows: allowsUrl,
    });
    for (const candidate of candidates) {
      if (raws.length >= perLimit) break;
      if (!allowsUrl(candidate.url)) { blocked++; continue; }
      if (await knownUrl(candidate.url)) { dup++; continue; }
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
          if (!looksLikeResearchTopic(filename, extracted.text)) { empty++; continue; }
          stage({
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
          if (rendered) {
            artHtml = rendered;
            article = extractArticle(rendered);
          }
        }
        const publishedAt = inferPublicationDate(candidate.url, article.title) || article.publishedAt || candidate.lastModified;
        if (!publishedAt || !looksLikeArticle(article.title, article.text)) {
          if (!await stageEmbeddedPdf(artHtml, candidate.url, article.title, publishedAt)) empty++;
          continue;
        }
        stage({
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
    let links = listHtml ? extractLinks(listHtml, inst.researchUrl) : [];
    if (links.length === 0 && inst.requiresRender) {
      listHtml = await renderHtml(inst.researchUrl);
      links = listHtml ? extractLinks(listHtml, inst.researchUrl) : [];
    }
    if (listHtml) {
      for (const link of links) {
        if (raws.length >= perLimit) break;
        if (!allowsUrl(link.url)) { blocked++; continue; }
        if (await knownUrl(link.url)) { dup++; continue; }
        await sleep(delayMs);
        let artHtml = await fetchText(link.url);
        if (!artHtml && inst.requiresRender) artHtml = await renderHtml(link.url);
        if (!artHtml) continue;
        let a = extractArticle(artHtml);
        if (a.text.length < 400 && inst.requiresRender) {
          const rendered = await renderHtml(link.url);
          if (rendered) {
            artHtml = rendered;
            a = extractArticle(rendered);
          }
        }
        const publishedAt = inferPublicationDate(link.url, a.title || link.title) || a.publishedAt;
        if (!publishedAt || !looksLikeArticle(a.title || link.title, a.text)) {
          if (!await stageEmbeddedPdf(artHtml, link.url, a.title || link.title, publishedAt)) empty++;
          continue;
        }
        stage({
          title: a.title || link.title,
          text: a.text,
          sourceUrl: link.url,
          author: a.author,
          publishedAt,
          segments: a.segments,
          strict: true, // HTML-extracted → enforce the full article check
        });
      }
      if (raws.length === 0) {
        const listing = extractArticle(listHtml);
        await stageEmbeddedPdf(listHtml, inst.researchUrl, listing.title, listing.publishedAt);
      }
    }
  }

  for (const r of raws) {
    const res = await persistArticle(inst.id, inst.name, r);
    if (res === "created") {
      created++;
      const article = await prisma.article.findUnique({ where: { urlHash: urlHash(r.sourceUrl) }, select: { id: true } });
      const native = nativePdfs.get(r.sourceUrl);
      if (native && article) {
        try {
          await saveNativePdf(article.id, r.sourceUrl, native);
        } catch (error) {
          nativeRejected++;
          console.warn(`  native PDF rejected for ${r.sourceUrl}: ${String(error)}`);
        }
      }
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
  const note = `delay ${delayMs}ms${robotsDelaySec ? " (robots)" : ""}${blocked ? ` · ${blocked} url blocked` : ""}${nativeRejected ? ` · ${nativeRejected} native PDF rejected` : ""}`;
  console.log(`  ${inst.name.padEnd(26)} +${created} created · ${dup} dup · ${empty} empty · ${note}`);
  console.log(JSON.stringify({
    event: "ingest.source.complete",
    institution: inst.name,
    discovered: raws.length,
    created,
    duplicate: dup,
    empty,
    robotsBlocked: blocked,
    nativePdfRejected: nativeRejected,
    delayMs,
  }));
  const accessStatus = lastFetchStatus(inst.researchUrl);
  if (raws.length === 0 && accessStatus && [401, 403, 429].includes(accessStatus)) {
    return finish("paused", `research endpoint HTTP ${accessStatus}; access wall not bypassed`, created);
  }
  return finish("succeeded", `${raws.length} discovered · ${created} created · ${dup} duplicate · ${empty} empty · ${blocked} blocked · ${nativeRejected} native PDF rejected`, created);
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
