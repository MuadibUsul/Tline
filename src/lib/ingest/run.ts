import "dotenv/config";
import Parser from "rss-parser";
import { prisma } from "../db";
import { fetchPdf, fetchText, lastFetchStatus, sleep } from "./fetch";
import { extractLinks, extractArticle, extractFeedLinks, extractPdfCandidates, inferPublicationDate, looksLikeArticle, looksLikeResearchTopic, newestByPublication } from "./extract";
import { ensureAssets, persistArticle, type RawArticle } from "./store";
import { snapshotAll } from "../consensus";
import { fetchRobots, robotsAllows, robotsCrawlDelay, robotsSitemaps } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { extractPdf } from "../documents/extractPdf";
import { generateArticleDocuments, saveNativePdf } from "../documents/pdf";
import { urlHash } from "../hash";
import { lastRenderReason, renderHtml } from "./render";
import { runTrackedJob } from "../jobs";

// Usage:
//   npm run ingest                 -> priority-1 institutions (allowed/delayed only)
//   npm run ingest -- --slug=ubs   -> one institution
//   npm run ingest -- --all        -> every crawlable institution
//   npm run ingest -- --limit=3    -> cap articles per institution
//   npm run ingest -- --all --resume-minutes=60 -> skip sources completed in the last hour

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
  const finish = async (status: "succeeded" | "empty" | "paused" | "refused", message: string, created: number) => {
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
      const url = new URL(u);
      return url.origin === origin && robotsAllows(robotsTxt, UA, url.pathname);
    } catch {
      return false;
    }
  };
  let accessReason: string | undefined;
  const renderPublic = async (url: string) => {
    const html = await renderHtml(url);
    accessReason ??= lastRenderReason(url);
    return html;
  };

  let created = 0, dup = 0, empty = 0, blocked = 0, nativeRejected = 0;
  const raws: RawArticle[] = [];
  const nativePdfs = new Map<string, Buffer>();
  const seenCandidates = new Set<string>();
  let listingHtml: string | null = null;
  const candidateLimit = Math.min(40, Math.max(3, perLimit * 3));
  const stage = (raw: RawArticle) => {
    if (isNaN(raw.publishedAt.getTime()) || raw.publishedAt.getTime() > Date.now() + 864e5) { empty++; return false; }
    if (raw.strict && (!looksLikeArticle(raw.title, raw.text) || !looksLikeResearchTopic(raw.title, raw.text))) { empty++; return false; }
    raws.push(raw);
    return true;
  };
  const knownUrl = async (url: string) => Boolean(await prisma.article.findUnique({
    where: { urlHash: urlHash(url) },
    select: { id: true },
  }));
  const skipCandidate = async (url: string) => {
    const clean = url.split("#")[0];
    if (seenCandidates.has(clean)) return true;
    seenCandidates.add(clean);
    if (await knownUrl(clean)) { dup++; return true; }
    return false;
  };
  const stageEmbeddedPdf = async (html: string, pageUrl: string, title: string, publishedAt: Date | null) => {
    let staged = false;
    for (const pdfCandidate of extractPdfCandidates(html, pageUrl).slice(0, candidateLimit)) {
      if (raws.length >= perLimit) break;
      const pdfUrl = pdfCandidate.url;
      if (!allowsUrl(pdfUrl) || await skipCandidate(pdfUrl)) continue;
      await sleep(delayMs);
      const pdf = await fetchPdf(pdfUrl);
      if (!pdf) continue;
      try {
        const extracted = await extractPdf(pdf);
        const date = pdfCandidate.publishedAt || inferPublicationDate(pdfUrl, extracted.text.slice(0, 1000)) || publishedAt || inferPublicationDate(pageUrl, title);
        if (!date || !extracted.text.trim()) continue;
        const filename = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() || "Research report")
          .replace(/\.pdf$/i, "")
          .replace(/(?:[a-z]{0,2})?20\d{6}[a-z]?$/i, "")
          .replace(/[-_]+/g, " ")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .trim();
        const pageLabel = title.split(/[;|]/).at(-1)?.trim() || title;
        const candidateTitle = pdfCandidate.title && !/^(?:download|pdf|read more)$/i.test(pdfCandidate.title) ? pdfCandidate.title : "";
        const documentTitle = candidateTitle || (title && !/^(?:research|insights?|publications?|reports?)$/i.test(pageLabel) ? title : filename);
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

  // 1) Publisher-declared RSS/Atom feeds. Fetch through the same compliant client.
  const feedUrls: string[] = [];
  if (inst.rssUrl && allowsUrl(inst.rssUrl)) feedUrls.push(inst.rssUrl);
  if (feedUrls.length === 0) {
    listingHtml = await fetchText(inst.researchUrl);
    if (listingHtml) feedUrls.push(...extractFeedLinks(listingHtml, inst.researchUrl).filter(allowsUrl));
  }
  for (const feedUrl of feedUrls) {
    try {
      await sleep(delayMs);
      const feedXml = await fetchText(feedUrl);
      if (!feedXml) continue;
      const feed = await rss.parseString(feedXml);
      for (const item of (feed.items || []).slice(0, candidateLimit)) {
        if (raws.length >= perLimit) break;
        if (!item.link || !allowsUrl(item.link)) continue;
        if (await skipCandidate(item.link)) continue;
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
        if (!html) html = await renderPublic(item.link);
        if (!html) continue;
        let article = extractArticle(html);
        if (article.text.length < 700) {
          const rendered = await renderPublic(item.link);
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
  if (raws.length < perLimit) {
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
      if (await skipCandidate(candidate.url)) continue;
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
        if (!artHtml) artHtml = await renderPublic(candidate.url);
        if (!artHtml) continue;
        let article = extractArticle(artHtml);
        if (article.text.length < 700) {
          const rendered = await renderPublic(candidate.url);
          if (rendered) {
            artHtml = rendered;
            article = extractArticle(rendered);
          }
        }
        const publishedAt = inferPublicationDate(candidate.url, article.title, article.publicationDateText, article.text.slice(0, 1200)) || article.publishedAt || candidate.lastModified;
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
  {
    const beforeListing = raws.length;
    let listHtml = listingHtml ?? await fetchText(inst.researchUrl);
    let links = listHtml ? extractLinks(listHtml, inst.researchUrl) : [];
    if (links.length === 0) {
      listHtml = await renderPublic(inst.researchUrl);
      links = listHtml ? extractLinks(listHtml, inst.researchUrl) : [];
    }
    if (listHtml) {
      for (const link of links.slice(0, candidateLimit)) {
        if (raws.length >= perLimit) break;
        if (!allowsUrl(link.url)) { blocked++; continue; }
        if (await skipCandidate(link.url)) continue;
        await sleep(delayMs);
        let artHtml = await fetchText(link.url);
        if (!artHtml) artHtml = await renderPublic(link.url);
        if (!artHtml) continue;
        let a = extractArticle(artHtml);
        if (a.text.length < 700) {
          const rendered = await renderPublic(link.url);
          if (rendered) {
            artHtml = rendered;
            a = extractArticle(rendered);
          }
        }
        const publishedAt = inferPublicationDate(link.url, a.title || link.title, a.publicationDateText, a.text.slice(0, 1200)) || a.publishedAt || link.publishedAt;
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
      if (links.length === 0 && raws.length === beforeListing) {
        const listing = extractArticle(listHtml);
        await stageEmbeddedPdf(listHtml, inst.researchUrl, listing.title, listing.publishedAt);
      }
    }
  }

  const selectedRaws = newestByPublication(raws, perLimit);
  for (const r of selectedRaws) {
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
    discovered: selectedRaws.length,
    acceptedCandidates: raws.length,
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
  if (raws.length === 0 && accessReason) {
    return finish("paused", `${accessReason}; access condition not bypassed`, created);
  }
  if (raws.length === 0 && dup > 0) {
    return finish("succeeded", `source reachable · ${dup} known article${dup === 1 ? "" : "s"} · no new article selected`, created);
  }
  if (raws.length === 0) {
    return finish("empty", `no candidate passed full-body/date/topic gates · ${dup} duplicate · ${empty} rejected · ${blocked} blocked`, created);
  }
  return finish("succeeded", `${selectedRaws.length} selected from ${raws.length} accepted · ${created} created · ${dup} duplicate · ${empty} empty · ${blocked} blocked · ${nativeRejected} native PDF rejected`, created);
}

async function executeIngest() {
  await ensureAssets();
  const perLimit = Number(arg("limit") || 6);
  const slug = arg("slug");
  const resumeMinutes = Math.max(0, Number(arg("resume-minutes") || 0));

  // Compliance gate: never crawl blocked/manual institutions.
  const crawlable = { crawlPolicy: { in: ["allowed", "delayed"] } };
  const resume = resumeMinutes > 0 ? {
    OR: [
      { lastCrawlAt: null },
      { lastCrawlAt: { lt: new Date(Date.now() - resumeMinutes * 60_000) } },
      { lastCrawlStatus: { in: ["running", "failed"] } },
    ],
  } : {};
  const where = slug
    ? { slug, ...crawlable }
    : flag("all")
      ? { ...crawlable, ...resume }
      : { priority: 1, ...crawlable, ...resume };

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
  const parameters = { slug: arg("slug") ?? null, limit: Number(arg("limit") || 6), all: flag("all"), resumeMinutes: Number(arg("resume-minutes") || 0) };
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
