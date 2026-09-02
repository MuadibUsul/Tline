import "dotenv/config";
import Parser from "rss-parser";
import { prisma } from "../db";
import { fetchImage, fetchPdf, fetchText, lastFetchReason, lastFetchStatus, sleep } from "./fetch";
import { extractLinks, extractArticle, extractFeedLinks, extractPaginationLinks, extractPdfCandidates, inferPublicationDate, isAccessGateText, isBroadcastOrEvent, looksLikeArticle, looksLikeResearchTopic, newestByPublication } from "./extract";
import { ensureAssets, persistArticle, persistArticleFigures, type RawArticle } from "./store";
import { snapshotAll } from "../consensus";
import { fetchRobots, robotsAllows, robotsCrawlDelay, robotsSitemaps } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { extractPdf } from "../documents/extractPdf";
import { saveNativePdf } from "../documents/pdf";
import { urlHash } from "../hash";
import { lastRenderReason, renderHtml } from "./render";
import { runTrackedJob } from "../jobs";
import { articleAllowed, candidateAllowed, listingUrls, sitemapEnabled } from "./sourceRules";
import { apiDiscoveryEnabled, discoverFromApi } from "./apiSources";
import { ACCESS_CIRCUIT_FAILURES, crawlIntervalSeconds, healthyScheduleSeconds, jitterSeconds, runSourcesByOrigin, sourceBackoffSeconds } from "./scheduling";

// Usage:
//   npm run ingest                 -> priority-1 institutions (allowed/delayed only)
//   npm run ingest -- --slug=ubs   -> one institution
//   npm run ingest -- --all        -> every crawlable institution
//   npm run ingest -- --limit=3    -> cap articles per institution
//   npm run ingest -- --scan-limit=60 --pages=3 -> inspect deeper current-month listings
//   npm run ingest -- --source-seconds=180 --render-limit=4 -> bound slow public rendering
//   npm run ingest -- --all --resume-minutes=60 -> skip sources completed in the last hour

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const rss = new Parser({ timeout: 15000 });
const UA = "InstitutionalIntelligenceBot";
const MIN_DELAY_MS = 1000; // politeness floor even when robots is silent

async function notifySourceProtection(event: "source.blocked" | "source.circuit_open", source: { slug: string; name: string; researchUrl: string }, status: number, failures: number, retrySeconds: number) {
  const payload = { event, source: source.slug, institution: source.name, url: source.researchUrl, status, consecutiveFailures: failures, retrySeconds, timestamp: new Date().toISOString() };
  console.warn(JSON.stringify(payload));
  const webhook = process.env.JOB_FAILURE_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error(JSON.stringify({ event: "source.notification.failed", source: source.slug, error: String(error) }));
  }
}

async function ingestInstitution(
  inst: { id: string; slug: string; name: string; researchUrl: string; rssUrl: string | null; sitemapUrl: string | null; language: string; crawlDelay: number | null; requiresRender: boolean; crawlIntervalSec: number | null; consecutiveFailures: number },
  perLimit: number,
  scanLimit: number,
  since: Date,
  maxPages: number,
  sourceSeconds: number,
  renderLimit: number,
) {
  const intervalSeconds = crawlIntervalSeconds(inst);
  const startedAt = new Date();
  const claim = await prisma.institution.updateMany({
    where: {
      id: inst.id,
      OR: [
        { lastCrawlStatus: { not: "running" } },
        { lastCrawlAt: null },
        { lastCrawlAt: { lt: new Date(startedAt.getTime() - (sourceSeconds + 300) * 1000) } },
      ],
    },
    data: { lastCrawlAt: new Date(), lastCrawlStatus: "running", lastCrawlMessage: null },
  });
  if (claim.count === 0) {
    console.log(JSON.stringify({ event: "ingest.source.busy", institution: inst.name }));
    return 0;
  }
  const finish = async (status: "succeeded" | "empty" | "paused" | "refused", message: string, created: number, protection?: { failures: number; retrySeconds: number; disable?: boolean }) => {
    const now = new Date();
    const healthy = status === "succeeded" || status === "empty";
    const nextDelay = protection?.retrySeconds ?? (healthy ? healthyScheduleSeconds(intervalSeconds, inst.consecutiveFailures) : jitterSeconds(Math.max(intervalSeconds, 3600)));
    await prisma.institution.update({
      where: { id: inst.id },
      data: {
        lastCrawlStatus: status,
        lastCrawlMessage: message.slice(0, 1000),
        nextCrawlAt: new Date(now.getTime() + nextDelay * 1000),
        consecutiveFailures: protection?.failures ?? (healthy ? 0 : inst.consecutiveFailures),
        ...(protection?.disable ? { monitoringEnabled: false } : {}),
        ...(healthy ? { lastSuccessAt: now } : {}),
        ...(created > 0 ? { lastDiscoveredAt: now } : {}),
      },
    });
    return created;
  };
  const origin = new URL(inst.researchUrl).origin;
  const sourceListings = listingUrls(inst.slug, inst.researchUrl).filter((url) => new URL(url).origin === origin);
  const deadline = Date.now() + sourceSeconds * 1000;
  const withinBudget = () => Date.now() < deadline;

  // --- Runtime robots.txt compliance check ---
  // When robots.txt cannot be fetched we proceed (treat as allowed) rather than pausing;
  // an explicit Disallow in a robots.txt we DID retrieve is still respected.
  const robotsTxt = await fetchRobots(origin);
  if (robotsTxt === null) {
    console.log(`  ${inst.name.padEnd(26)} robots unavailable — proceeding (treated as allowed)`);
  } else if (!robotsAllows(robotsTxt, UA, new URL(inst.researchUrl).pathname)) {
    console.log(`  ${inst.name.padEnd(26)} SKIP · robots disallows research path`);
    return finish("refused", "robots disallows research path", 0);
  }
  const robotsDelaySec = robotsTxt ? robotsCrawlDelay(robotsTxt, UA) : undefined;
  const delayMs = Math.max(MIN_DELAY_MS, (robotsDelaySec ?? inst.crawlDelay ?? 0) * 1000);

  const allowsUrl = (u: string) => {
    try {
      const url = new URL(u);
      return url.origin === origin && (robotsTxt === null || robotsAllows(robotsTxt, UA, url.pathname));
    } catch {
      return false;
    }
  };
  let accessReason: string | undefined;
  let renderedCandidates = 0;
  const renderPublic = async (url: string) => {
    if (url !== inst.researchUrl && renderedCandidates >= renderLimit) return null;
    if (!withinBudget()) return null;
    if (url !== inst.researchUrl) renderedCandidates++;
    const html = await renderHtml(url);
    accessReason ??= lastRenderReason(url);
    return html;
  };
  const readArticle = (html: string, url?: string) => {
    const article = extractArticle(html, url);
    if (isAccessGateText(article.text)) accessReason ??= "interactive consent or guest-access gate";
    return article;
  };

  let created = 0, updated = 0, dup = 0, empty = 0, outOfWindow = 0, blocked = 0, nativeRejected = 0;
  const raws: RawArticle[] = [];
  const nativePdfs = new Map<string, Buffer>();
  const seenCandidates = new Set<string>();
  const knownCandidates = new Set((await prisma.article.findMany({
    where: { institutionId: inst.id },
    select: { urlHash: true },
  })).map((article) => article.urlHash));
  let listingHtml: string | null = null;
  const candidateLimit = Math.min(500, Math.max(perLimit * 3, scanLimit));
  const stage = (raw: RawArticle) => {
    if (isNaN(raw.publishedAt.getTime()) || raw.publishedAt.getTime() > Date.now() + 864e5) { empty++; return false; }
    // A page can't be published after we discovered it; cap near-future dates (timezone skew,
    // or an event date scraped as the publish date) so they never pin the newest-first feed.
    if (raw.publishedAt.getTime() > Date.now()) raw.publishedAt = new Date();
    if (raw.publishedAt < since) { outOfWindow++; return false; }
    if (!articleAllowed(inst.slug, raw.title, raw.text)) { empty++; return false; }
    // Webinars / podcasts / video / live-event invitations are not written research.
    if (isBroadcastOrEvent(raw.title, raw.text)) { empty++; return false; }
    if (raw.strict && (!looksLikeArticle(raw.title, raw.text) || !looksLikeResearchTopic(raw.title, raw.text))) { empty++; return false; }
    raws.push(raw);
    return true;
  };
  const skipCandidate = async (url: string) => {
    const clean = url.split("#")[0];
    if (seenCandidates.has(clean)) return true;
    seenCandidates.add(clean);
    if (knownCandidates.has(urlHash(clean))) { dup++; return true; }
    return false;
  };
  const stageEmbeddedPdf = async (html: string, pageUrl: string, title: string, publishedAt: Date | null) => {
    let staged = false;
    for (const pdfCandidate of extractPdfCandidates(html, pageUrl).slice(0, candidateLimit)) {
      if (raws.length >= perLimit || !withinBudget()) break;
      const pdfUrl = pdfCandidate.url;
      if (!allowsUrl(pdfUrl) || await skipCandidate(pdfUrl)) continue;
      await sleep(delayMs);
      const pdf = await fetchPdf(pdfUrl);
      if (!pdf) { accessReason ??= lastFetchReason(pdfUrl); continue; }
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

  // 0) Publisher JSON API (client-rendered sources whose HTML is only an app shell).
  if (apiDiscoveryEnabled(inst.slug)) {
    const api = await discoverFromApi(inst.slug, { since, limit: candidateLimit, delayMs });
    if (api.unreachable) accessReason ??= api.unreachable;
    for (const candidate of api.candidates) {
      if (raws.length >= perLimit || !withinBudget()) break;
      if (!allowsUrl(candidate.url) || !candidateAllowed(inst.slug, candidate.url)) { blocked++; continue; }
      if (await skipCandidate(candidate.url)) continue;
      await sleep(delayMs);
      const pdf = await candidate.pdf();
      if (!pdf) { empty++; continue; }
      try {
        const extracted = await extractPdf(pdf);
        if (!extracted.text.trim() || !looksLikeResearchTopic(candidate.title, extracted.text)) { empty++; continue; }
        // Title/date/author come from publisher metadata, so the HTML-shaped strict check does not apply.
        const accepted = stage({
          title: candidate.title || "Institutional research report",
          text: extracted.text,
          sourceUrl: candidate.url,
          author: candidate.author,
          publishedAt: candidate.publishedAt,
          segments: [{ heading: null, text: extracted.text }],
        });
        if (accepted) nativePdfs.set(candidate.url, pdf);
      } catch {
        empty++;
      }
    }
  }

  // 1) Publisher-declared RSS/Atom feeds. Fetch through the same compliant client.
  const feedUrls: string[] = [];
  if (inst.rssUrl && allowsUrl(inst.rssUrl)) feedUrls.push(inst.rssUrl);
  if (feedUrls.length === 0) {
    for (const listingUrl of sourceListings) {
      const html = await fetchText(listingUrl);
      if (listingUrl === inst.researchUrl) listingHtml = html;
      if (html) feedUrls.push(...extractFeedLinks(html, listingUrl).filter(allowsUrl));
      if (feedUrls.length) break;
    }
  }
  if (!inst.rssUrl && feedUrls[0]) {
    await prisma.institution.update({ where: { id: inst.id }, data: { rssUrl: feedUrls[0] } });
    inst.rssUrl = feedUrls[0];
  }
  for (const feedUrl of feedUrls) {
    try {
      await sleep(delayMs);
      const feedXml = await fetchText(feedUrl);
      if (!feedXml) continue;
      let feed;
      try {
        feed = await rss.parseString(feedXml);
      } catch {
        for (const nested of extractFeedLinks(feedXml, feedUrl)) {
          if (allowsUrl(nested) && !feedUrls.includes(nested) && feedUrls.length < 12) feedUrls.push(nested);
        }
        continue;
      }
      for (const item of (feed.items || []).slice(0, candidateLimit)) {
        if (raws.length >= perLimit || !withinBudget()) break;
        if (!item.link || !allowsUrl(item.link) || !candidateAllowed(inst.slug, item.link)) continue;
        if (await skipCandidate(item.link)) continue;
        const feedDate = (item.isoDate ? new Date(item.isoDate) : null) || inferPublicationDate(item.link, item.title);
        if (feedDate && !isNaN(feedDate.getTime()) && feedDate < since) { outOfWindow++; continue; }
        await sleep(delayMs);
        if (/\.pdf(?:$|\?)/i.test(item.link)) {
          const pdf = await fetchPdf(item.link);
          if (!pdf) { accessReason ??= lastFetchReason(item.link); continue; }
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
        let article = readArticle(html, item.link);
        if (article.text.length < 700) {
          const rendered = await renderPublic(item.link);
          if (rendered) {
            html = rendered;
            article = readArticle(rendered, item.link);
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
          figures: article.figures,
          disclaimerText: article.disclaimerText,
          strict: true,
        });
      }
    } catch { /* fall through to HTML */ }
  }

  // 2) Sitemap/Sitemap Index discovery, including native research PDFs.
  if (raws.length < perLimit && sitemapEnabled(inst.slug)) {
    const declaredSitemaps = (robotsTxt ? robotsSitemaps(robotsTxt) : []).filter(allowsUrl);
    if (!inst.sitemapUrl && declaredSitemaps[0]) {
      await prisma.institution.update({ where: { id: inst.id }, data: { sitemapUrl: declaredSitemaps[0] } });
      inst.sitemapUrl = declaredSitemaps[0];
    }
    const sitemapSeeds = [
      ...declaredSitemaps,
      ...(inst.sitemapUrl ? [inst.sitemapUrl] : []),
      `${origin}/sitemap.xml`,
    ];
    const candidates = await discoverFromSitemaps(sitemapSeeds, inst.researchUrl, {
      limit: candidateLimit,
      since,
      allows: allowsUrl,
    });
    for (const candidate of candidates.filter((item) => candidateAllowed(inst.slug, item.url))) {
      if (raws.length >= perLimit || !withinBudget()) break;
      if (!allowsUrl(candidate.url)) { blocked++; continue; }
      if (await skipCandidate(candidate.url)) continue;
      await sleep(delayMs);
      if (/\.pdf(?:$|\?)/i.test(candidate.url)) {
        const pdf = await fetchPdf(candidate.url);
        if (!pdf) { accessReason ??= lastFetchReason(candidate.url); continue; }
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
        let article = readArticle(artHtml, candidate.url);
        if (article.text.length < 700) {
          const rendered = await renderPublic(candidate.url);
          if (rendered) {
            artHtml = rendered;
            article = readArticle(rendered, candidate.url);
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
          figures: article.figures,
          disclaimerText: article.disclaimerText,
          strict: true,
        });
      }
    }
  }

  // 3) HTML listings and explicit pagination → per-article extraction.
  // Skipped for API-backed sources: their pages are app shells, so HTML extraction
  // only yields consent/gate boilerplate and would mask a healthy crawl as blocked.
  if (!apiDiscoveryEnabled(inst.slug)) {
    const beforeListing = raws.length;
    const pages = [...sourceListings];
    const visitedPages = new Set<string>();
    while (pages.length && visitedPages.size < maxPages && raws.length < perLimit && withinBudget()) {
      const pageUrl = pages.shift()!;
      if (visitedPages.has(pageUrl) || !allowsUrl(pageUrl)) continue;
      visitedPages.add(pageUrl);
      let listHtml = pageUrl === inst.researchUrl ? listingHtml ?? await fetchText(pageUrl) : await fetchText(pageUrl);
      let links = listHtml ? extractLinks(listHtml, pageUrl, candidateLimit).filter((link) => candidateAllowed(inst.slug, link.url)) : [];
      if (inst.requiresRender || links.length === 0) {
        const rendered = await renderPublic(pageUrl);
        if (rendered) {
          listHtml = rendered;
          links = extractLinks(rendered, pageUrl, candidateLimit).filter((link) => candidateAllowed(inst.slug, link.url));
        }
      }
      if (!listHtml) continue;
      for (const link of links.slice(0, candidateLimit)) {
        if (raws.length >= perLimit || !withinBudget()) break;
        if (!allowsUrl(link.url)) { blocked++; continue; }
        if (await skipCandidate(link.url)) continue;
        if (link.publishedAt && link.publishedAt < since) { outOfWindow++; continue; }
        await sleep(delayMs);
        let artHtml = await fetchText(link.url);
        if (!artHtml) artHtml = await renderPublic(link.url);
        if (!artHtml) continue;
        let a = readArticle(artHtml, link.url);
        if (a.text.length < 700) {
          const rendered = await renderPublic(link.url);
          if (rendered) {
            artHtml = rendered;
            a = readArticle(rendered, link.url);
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
          figures: a.figures,
          disclaimerText: a.disclaimerText,
          strict: true, // HTML-extracted → enforce the full article check
        });
      }
      if (raws.length < perLimit) {
        const listing = readArticle(listHtml);
        await stageEmbeddedPdf(listHtml, pageUrl, listing.title, listing.publishedAt);
      }
      for (const next of extractPaginationLinks(listHtml, pageUrl, pageUrl)) {
        if (!visitedPages.has(next) && allowsUrl(next)) pages.push(next);
      }
    }
    if (raws.length === beforeListing && visitedPages.size === 0) empty++;
  }

  const selectedRaws = newestByPublication(raws, perLimit);
  let figuresStored = 0;
  for (const r of selectedRaws) {
    const res = await persistArticle(inst.id, r);
    if (res === "created") created++;
    else if (res === "updated") updated++;
    else if (res === "duplicate") { dup++; continue; }
    else { empty++; continue; }
    const article = await prisma.article.findUnique({ where: { urlHash: urlHash(r.sourceUrl) }, select: { id: true } });
    if (!article) continue;
    if (res === "created") {
      const native = nativePdfs.get(r.sourceUrl);
      if (native) {
        try {
          await saveNativePdf(article.id, r.sourceUrl, native);
        } catch (error) {
          nativeRejected++;
          console.warn(`  native PDF rejected for ${r.sourceUrl}: ${String(error)}`);
        }
      }
    }
    // Download inline figures (skip when the article already has some on a refresh).
    if (r.figures?.length && withinBudget()) {
      const existing = res === "updated" ? await prisma.articleFigure.count({ where: { articleId: article.id } }) : 0;
      if (existing === 0) {
        try {
          figuresStored += await persistArticleFigures(article.id, r.figures, (url) => allowsUrl(url) || new URL(url).origin !== origin ? fetchImage(url) : Promise.resolve(null), async () => { await sleep(delayMs); });
        } catch (error) {
          console.warn(`  figures skipped for ${r.sourceUrl}: ${String(error)}`);
        }
      }
    }
  }
  const note = `since ${since.toISOString().slice(0, 10)} · delay ${delayMs}ms${robotsDelaySec ? " (robots)" : ""} · ${renderedCandidates}/${renderLimit} rendered${!withinBudget() ? " · time budget reached" : ""}${outOfWindow ? ` · ${outOfWindow} older` : ""}${blocked ? ` · ${blocked} url blocked` : ""}${nativeRejected ? ` · ${nativeRejected} native PDF rejected` : ""}`;
  console.log(`  ${inst.name.padEnd(26)} +${created} created · ${updated} refreshed · ${dup} dup · ${empty} empty · ${note}`);
  console.log(JSON.stringify({
    event: "ingest.source.complete",
    institution: inst.name,
    discovered: selectedRaws.length,
    acceptedCandidates: raws.length,
    created,
    updated,
    duplicate: dup,
    empty,
    outOfWindow,
    robotsBlocked: blocked,
    nativePdfRejected: nativeRejected,
    figuresStored,
    delayMs,
  }));
  const accessStatus = lastFetchStatus(inst.researchUrl);
  const accessBlocked = Boolean(accessStatus && [401, 403, 429].includes(accessStatus)) || /access wall|human verification/i.test(accessReason ?? "");
  if (raws.length === 0 && accessBlocked) {
    const failures = inst.consecutiveFailures + 1;
    const retrySeconds = jitterSeconds(sourceBackoffSeconds(intervalSeconds, failures, true));
    const circuitOpen = failures >= ACCESS_CIRCUIT_FAILURES;
    await notifySourceProtection(circuitOpen ? "source.circuit_open" : "source.blocked", inst, accessStatus ?? 0, failures, retrySeconds);
    return finish("paused", `${accessStatus ? `research endpoint HTTP ${accessStatus}` : accessReason}; access wall not bypassed${circuitOpen ? "; circuit opened after repeated blocks" : ""}`, created, { failures, retrySeconds, disable: circuitOpen });
  }
  if (raws.length === 0 && accessReason) {
    return finish("paused", `${accessReason}; access condition not bypassed`, created);
  }
  if (raws.length === 0 && dup > 0) {
    return finish("succeeded", `source reachable · ${dup} known article${dup === 1 ? "" : "s"} · no new article selected`, created);
  }
  if (raws.length === 0 && outOfWindow > 0) {
    return finish("succeeded", `source reachable · ${outOfWindow} article${outOfWindow === 1 ? "" : "s"} older than current-month window · no new article selected`, created);
  }
  if (raws.length === 0) {
    return finish("empty", `no candidate passed full-body/date/topic gates · ${dup} duplicate · ${empty} rejected · ${blocked} blocked`, created);
  }
  return finish("succeeded", `${selectedRaws.length} selected from ${raws.length} accepted · ${created} created · ${dup} duplicate · ${empty} empty · ${blocked} blocked · ${nativeRejected} native PDF rejected`, created);
}

async function executeIngest() {
  await ensureAssets();
  const perLimit = Number(arg("limit") || 6);
  const scanLimit = Math.max(perLimit * 3, Number(arg("scan-limit") || 60));
  const maxPages = Math.min(10, Math.max(1, Number(arg("pages") || 3)));
  const sourceSeconds = Math.min(600, Math.max(30, Number(arg("source-seconds") || 180)));
  const renderLimit = Math.min(20, Math.max(0, Number(arg("render-limit") || 4)));
  const concurrency = Math.min(16, Math.max(1, Number(arg("concurrency") || process.env.INGEST_CONCURRENCY || 8)));
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const requestedSince = arg("since") ? new Date(arg("since")!) : monthStart;
  const since = !isNaN(requestedSince.getTime()) && requestedSince > monthStart ? requestedSince : monthStart;
  const slug = arg("slug");
  const resumeMinutes = Math.max(0, Number(arg("resume-minutes") || 0));
  const due = flag("due") ? { OR: [{ nextCrawlAt: null }, { nextCrawlAt: { lte: new Date() } }] } : {};

  // Compliance gate: never crawl blocked/manual institutions.
  const crawlable = { crawlPolicy: { in: ["allowed", "delayed"] }, monitoringEnabled: true };
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
      ? { ...crawlable, ...resume, ...due }
      : { priority: 1, ...crawlable, ...resume, ...due };

  const institutions = await prisma.institution.findMany({
    where,
    orderBy: { priority: "asc" },
    select: { id: true, slug: true, name: true, researchUrl: true, rssUrl: true, sitemapUrl: true, language: true, crawlDelay: true, requiresRender: true, crawlIntervalSec: true, consecutiveFailures: true },
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

  console.log(`Ingesting ${institutions.length} compliant institution(s), up to ${perLimit} current-month articles each (scan ${scanLimit}, pages ${maxPages})…`);
  let total = 0;
  let failedSources = 0;
  await runSourcesByOrigin(institutions, concurrency, async (inst) => {
    try {
      total += await ingestInstitution(inst, perLimit, scanLimit, since, maxPages, sourceSeconds, renderLimit);
    } catch (error) {
      failedSources++;
      const failures = inst.consecutiveFailures + 1;
      const retrySeconds = jitterSeconds(sourceBackoffSeconds(crawlIntervalSeconds(inst), failures));
      await prisma.institution.update({
        where: { id: inst.id },
        data: { lastCrawlStatus: "failed", lastCrawlMessage: String(error).slice(0, 1000), consecutiveFailures: failures, nextCrawlAt: new Date(Date.now() + retrySeconds * 1000) },
      });
      console.error(JSON.stringify({ event: "ingest.source.failed", institution: inst.name, error: String(error) }));
    }
  });

  const snaps = await snapshotAll();
  console.log(`\nDone. ${total} new articles · ${snaps} consensus snapshots.`);
  return { institutions: institutions.length, failedSources, articlesCreated: total, consensusSnapshots: snaps, refused: false };
}

async function main() {
  const parameters = { slug: arg("slug") ?? null, limit: Number(arg("limit") || 6), scanLimit: Number(arg("scan-limit") || 60), pages: Number(arg("pages") || 3), sourceSeconds: Number(arg("source-seconds") || 180), renderLimit: Number(arg("render-limit") || 4), concurrency: Number(arg("concurrency") || process.env.INGEST_CONCURRENCY || 8), since: arg("since") ?? "current-month", all: flag("all"), due: flag("due"), resumeMinutes: Number(arg("resume-minutes") || 0) };
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
