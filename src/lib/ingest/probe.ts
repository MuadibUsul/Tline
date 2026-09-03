import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";
import { prisma } from "../db";
import { extractPdf } from "../documents/extractPdf";
import { extractArticle, extractFeedLinks, extractLinks, extractPdfCandidates, extractPdfLinks, inferPublicationDate, isAccessGateText, looksLikeArticle, looksLikeResearchTopic } from "./extract";
import { fetchPdf, fetchText, lastFetchReason, lastFetchStatus } from "./fetch";
import { lastRenderReason, renderHtml } from "./render";
import { fetchRobots, robotsAllows, robotsSitemaps } from "./robots";
import { discoverFromSitemaps } from "./sitemap";
import { candidateAllowed, listingUrls, sitemapEnabled } from "./sourceRules";
import { apiDiscoveryEnabled, discoverFromApi } from "./apiSources";

const UA = "InstitutionalIntelligenceBot";
const rss = new Parser({ timeout: 15000 });

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const flag = (name: string) => process.argv.includes(`--${name}`);

type ProbeStatus = "ready" | "empty" | "paused" | "refused" | "failed";

interface ProbeResult {
  slug: string;
  name: string;
  status: ProbeStatus;
  listingStatus: number | null;
  sitemapCandidates: number;
  listingCandidates: number;
  feedCandidates: number;
  pdfCandidates: number;
  sampled: number;
  accepted: number;
  rendered: boolean;
  reason: string;
  failures: Record<string, number>;
  examples: Array<{ url: string; title: string; publishedAt: string }>;
}

/** Acceptance check for sources discovered through a publisher JSON API. */
async function probeApiSource(
  inst: { slug: string; name: string },
  base: Omit<ProbeResult, "status" | "reason">,
): Promise<ProbeResult> {
  const sampleLimit = Math.max(1, Number(arg("sample") || 3));
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000);
  const { candidates, unreachable } = await discoverFromApi(inst.slug, { since, limit: Math.max(sampleLimit * 4, 20), delayMs: 500 });
  if (unreachable) return { ...base, status: "paused", reason: unreachable };
  const examples: ProbeResult["examples"] = [];
  const failures: Record<string, number> = {};
  const fail = (reason: string) => { failures[reason] = (failures[reason] ?? 0) + 1; };
  let sampled = 0;
  for (const candidate of candidates) {
    if (examples.length >= sampleLimit) break;
    sampled++;
    const pdf = await candidate.pdf();
    if (!pdf) { fail("pdf_fetch"); continue; }
    try {
      const extracted = await extractPdf(pdf);
      if (!extracted.text.trim()) fail("body_empty");
      else if (!looksLikeResearchTopic(candidate.title, extracted.text)) fail("not_research");
      else examples.push({ url: candidate.url, title: candidate.title, publishedAt: candidate.publishedAt.toISOString() });
    } catch { fail("pdf_invalid"); }
  }
  const accepted = examples.length;
  return {
    ...base,
    status: accepted > 0 ? "ready" : "empty",
    listingCandidates: candidates.length,
    sampled,
    accepted,
    reason: accepted > 0
      ? `${accepted}/${sampled} API publications passed full-body gates`
      : `${candidates.length} API publications in the last 45 days; none passed${Object.keys(failures).length ? ` (${Object.entries(failures).map(([key, value]) => `${key}:${value}`).join(", ")})` : ""}`,
    failures,
    examples,
  };
}

async function probeInstitution(inst: {
  slug: string;
  name: string;
  researchUrl: string;
  sitemapUrl: string | null;
  rssUrl: string | null;
  requiresRender: boolean;
}): Promise<ProbeResult> {
  const base = {
    slug: inst.slug,
    name: inst.name,
    listingStatus: null,
    sitemapCandidates: 0,
    listingCandidates: 0,
    feedCandidates: 0,
    pdfCandidates: 0,
    sampled: 0,
    accepted: 0,
    rendered: false,
    failures: {} as Record<string, number>,
    examples: [] as ProbeResult["examples"],
  };
  try {
    const source = new URL(inst.researchUrl);
    const robots = await fetchRobots(source.origin);
    // Mirrors run.ts: an unavailable robots.txt is treated as allowed, while an
    // explicit Disallow in a robots.txt we DID retrieve is still respected.
    if (robots !== null && !robotsAllows(robots, UA, source.pathname)) return { ...base, status: "refused", reason: "robots disallows research path" };
    const allows = (url: string) => {
      try {
        const target = new URL(url);
        return target.origin === source.origin && (robots === null || robotsAllows(robots, UA, target.pathname));
      } catch { return false; }
    };

    // API-backed sources serve an app shell for every path, so HTML/sitemap
    // discovery cannot see them; probe the same JSON listing the crawler uses.
    if (apiDiscoveryEnabled(inst.slug)) return probeApiSource(inst, base);

    let accessReason: string | undefined;
    const renderPublic = async (url: string) => {
      const renderedHtml = await renderHtml(url);
      accessReason ??= lastRenderReason(url);
      return renderedHtml;
    };
    let html = await fetchText(inst.researchUrl);
    const sourceListings = listingUrls(inst.slug, inst.researchUrl).filter(allows);
    let listingCandidates = html ? extractLinks(html, inst.researchUrl).filter((link) => candidateAllowed(inst.slug, link.url)) : [];
    for (const listingUrl of sourceListings.slice(1)) {
      const listingHtml = await fetchText(listingUrl);
      if (listingHtml) listingCandidates.push(...extractLinks(listingHtml, listingUrl).filter((link) => candidateAllowed(inst.slug, link.url)));
    }
    let rendered = false;
    if (inst.requiresRender || (flag("render") && listingCandidates.length === 0)) {
      const renderedHtml = await renderPublic(inst.researchUrl);
      if (renderedHtml) {
        html = renderedHtml;
        listingCandidates = extractLinks(renderedHtml, inst.researchUrl).filter((link) => candidateAllowed(inst.slug, link.url));
        rendered = true;
      }
    }
    const declaredSitemaps = [
      ...(robots ? robotsSitemaps(robots) : []),
      ...(inst.sitemapUrl ? [inst.sitemapUrl] : []),
    ];
    const sitemapCandidates = sitemapEnabled(inst.slug)
      ? await discoverFromSitemaps(
        declaredSitemaps.length || listingCandidates.length ? declaredSitemaps : [`${source.origin}/sitemap.xml`],
        inst.researchUrl,
        { limit: 20, maxSitemaps: 6, allows },
      )
      : [];

    const feedCandidates: Array<{ url: string; title: string; publishedAt: Date | null }> = [];
    const feeds = [...new Set([
      ...(inst.rssUrl ? [inst.rssUrl] : []),
      ...(html ? extractFeedLinks(html, inst.researchUrl) : []),
    ])].filter(allows);
    for (const feedUrl of feeds) {
      try {
        const xml = await fetchText(feedUrl);
        if (!xml) continue;
        let feed;
        try {
          feed = await rss.parseString(xml);
        } catch {
          for (const nested of extractFeedLinks(xml, feedUrl)) {
            if (allows(nested) && !feeds.includes(nested) && feeds.length < 12) feeds.push(nested);
          }
          continue;
        }
        for (const item of (feed.items || []).slice(0, 20)) {
          if (!item.link || !allows(item.link)) continue;
          const parsed = item.isoDate ? new Date(item.isoDate) : null;
          feedCandidates.push({
            url: item.link,
            title: item.title || "",
            publishedAt: parsed && !isNaN(parsed.getTime()) ? parsed : inferPublicationDate(item.link, item.title),
          });
        }
      } catch { /* another discovery channel may still succeed */ }
    }

    const candidates = new Map<string, { url: string; title: string; lastModified: Date | null }>();
    for (const candidate of feedCandidates.filter((item) => candidateAllowed(inst.slug, item.url))) {
      if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, lastModified: candidate.publishedAt });
    }
    // Listing pages usually represent the publisher's current editorial order; sitemaps fill gaps.
    for (const candidate of listingCandidates) {
      if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, lastModified: candidate.publishedAt });
    }
    const directPdfCandidates = html ? extractPdfCandidates(html, inst.researchUrl) : [];
    for (const candidate of directPdfCandidates) {
      if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, lastModified: candidate.publishedAt });
    }
    for (const candidate of sitemapCandidates.filter((item) => candidateAllowed(inst.slug, item.url))) {
      if (!candidates.has(candidate.url)) candidates.set(candidate.url, { ...candidate, title: "" });
    }

    const sampleLimit = Math.max(1, Number(arg("sample") || 3));
    const scanLimit = Math.max(sampleLimit, Number(arg("scan") || sampleLimit * 4));
    const examples: ProbeResult["examples"] = [];
    const failures: Record<string, number> = {};
    const fail = (reason: string) => { failures[reason] = (failures[reason] ?? 0) + 1; };
    let sampled = 0;
    const orderedCandidates = [...candidates.values()].sort((left, right) => {
      const dated = Number(Boolean(right.lastModified || inferPublicationDate(right.url, right.title))) - Number(Boolean(left.lastModified || inferPublicationDate(left.url, left.title)));
      return dated || Number(/\/(?:content\/articles|insights?\/[^/]+\/|research\/[^/]+\/)/i.test(right.url)) - Number(/\/(?:content\/articles|insights?\/[^/]+\/|research\/[^/]+\/)/i.test(left.url));
    });
    for (const candidate of orderedCandidates.slice(0, scanLimit)) {
      if (examples.length >= sampleLimit) break;
      if (!allows(candidate.url)) continue;
      sampled++;
      if (/\.pdf(?:$|\?)/i.test(candidate.url)) {
        const pdf = await fetchPdf(candidate.url);
        if (!pdf) { accessReason ??= lastFetchReason(candidate.url); fail("pdf_fetch"); continue; }
        try {
          const extracted = await extractPdf(pdf);
          const publishedAt = inferPublicationDate(candidate.url, candidate.title) || candidate.lastModified;
          if (!publishedAt) fail("date_missing");
          else if (!extracted.text.trim()) fail("body_empty");
          else if (!looksLikeResearchTopic(candidate.title, extracted.text)) fail("not_research");
          else {
            examples.push({ url: candidate.url, title: candidate.title || candidate.url.split("/").pop() || "PDF", publishedAt: publishedAt.toISOString() });
          }
        } catch { fail("pdf_invalid"); }
        continue;
      }

      let articleHtml = await fetchText(candidate.url);
      let article = articleHtml ? extractArticle(articleHtml) : null;
      if ((inst.requiresRender || flag("render")) && (!article || article.text.length < 700)) {
        const renderedArticle = await renderPublic(candidate.url);
        if (renderedArticle) {
          articleHtml = renderedArticle;
          article = extractArticle(renderedArticle);
          rendered = true;
        }
      }
      if (!article) { fail("html_fetch"); continue; }
      if (isAccessGateText(article.text)) accessReason ??= "interactive consent or guest-access gate";
      const publishedAt = inferPublicationDate(candidate.url, article.title || candidate.title, article.publicationDateText, article.text.slice(0, 1200)) || article.publishedAt || candidate.lastModified;
      const articleReady = publishedAt && looksLikeArticle(article.title || candidate.title, article.text) && looksLikeResearchTopic(article.title || candidate.title, article.text);
      if (articleReady) {
        examples.push({ url: candidate.url, title: article.title || candidate.title, publishedAt: publishedAt.toISOString() });
        continue;
      }

      let embeddedReady = false;
      for (const pdfUrl of extractPdfLinks(articleHtml || "", candidate.url).slice(0, 2)) {
        const pdf = await fetchPdf(pdfUrl);
        if (!pdf) { accessReason ??= lastFetchReason(pdfUrl); continue; }
        try {
          const extracted = await extractPdf(pdf);
          const pdfDate = inferPublicationDate(pdfUrl, candidate.title, extracted.text.slice(0, 1000)) || publishedAt;
          if (pdfDate && extracted.text.trim() && looksLikeResearchTopic(candidate.title || article.title, extracted.text)) {
            examples.push({ url: pdfUrl, title: article.title || candidate.title, publishedAt: pdfDate.toISOString() });
            embeddedReady = true;
            break;
          }
        } catch { /* try the next embedded PDF */ }
      }
      if (!embeddedReady) {
        if (!publishedAt) fail("date_missing");
        else if (!looksLikeArticle(article.title || candidate.title, article.text)) fail("body_gate");
        else fail("not_research");
      }
    }

    const listingStatus = lastFetchStatus(inst.researchUrl) ?? null;
    const accepted = examples.length;
    const renderReason = accessReason;
    const status: ProbeStatus = accepted > 0 ? "ready" : (listingStatus && [401, 403, 429].includes(listingStatus)) || renderReason ? "paused" : "empty";
    const reason = accepted > 0
      ? `${accepted}/${sampled} sampled candidates passed full-body gates`
      : candidates.size === 0
        ? "no article candidates discovered"
        : `${sampled} candidates sampled; none passed full-body/date/topic gates`;
    return {
      ...base,
      status,
      listingStatus,
      sitemapCandidates: sitemapCandidates.length,
      listingCandidates: listingCandidates.length,
      feedCandidates: feedCandidates.length,
      pdfCandidates: directPdfCandidates.length,
      sampled,
      accepted,
      rendered,
      reason: accepted > 0 ? reason : `${reason}${Object.keys(failures).length ? ` (${Object.entries(failures).map(([key, value]) => `${key}:${value}`).join(", ")})` : ""}${renderReason ? ` · ${renderReason}` : ""}`,
      failures,
      examples,
    };
  } catch (error) {
    return { ...base, status: "failed", reason: String(error).slice(0, 500) };
  }
}

async function main() {
  const slug = arg("slug");
  const institutions = await prisma.institution.findMany({
    where: slug ? { slug } : { crawlPolicy: { in: ["allowed", "delayed"] } },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    select: { slug: true, name: true, researchUrl: true, rssUrl: true, sitemapUrl: true, requiresRender: true },
  });
  const results: ProbeResult[] = [];
  const queue = [...institutions];
  const worker = async () => {
    for (let institution = queue.shift(); institution; institution = queue.shift()) {
      const result = await probeInstitution(institution);
      results.push(result);
      console.log(`${result.status.padEnd(7)} ${institution.name.padEnd(28)} feed=${result.feedCandidates} sitemap=${result.sitemapCandidates} listing=${result.listingCandidates} pdf=${result.pdfCandidates} accepted=${result.accepted} · ${result.reason}`);
    }
  };
  // Different institutions use different hosts; a small pool shortens audits without increasing per-host request concurrency.
  await Promise.all(Array.from({ length: Math.min(4, institutions.length) }, worker));
  results.sort((left, right) => left.name.localeCompare(right.name));
  const counts = results.reduce<Record<string, number>>((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    return summary;
  }, {});
  const report = { generatedAt: new Date().toISOString(), counts, results };
  const output = arg("output");
  if (output) await writeFile(path.resolve(output), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ event: "ingest.probe.complete", institutions: results.length, ...counts }));
  await prisma.$disconnect();
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
