import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { prisma } from "../../db";
import { fetchText, sleep } from "../../ingest/fetch";
import { inferPublicationDate } from "../../ingest/extract";
import { fetchRobots, robotsAllows, robotsCrawlDelay } from "../../ingest/robots";
import { resolveLLMProvider } from "../../llm/config";
import type { LLMProvider } from "../../llm/provider";
import { extractPolicyText } from "./extract";
import { parsePolicyDocument, POLICY_PROMPT_VERSION } from "./parse";
import type { DiscoveredPolicyDocument, PolicyDocumentType } from "./types";

export const FOMC_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const FED_ORIGIN = "https://www.federalreserve.gov";
const UA = "InstitutionalIntelligenceBot/0.1 (+respectful research aggregator; contact: ops@globalintel.io)";

function documentType(url: URL): PolicyDocumentType | null {
  if (/\/monetarypolicy\/fomcminutes\d{8}\.htm$/i.test(url.pathname)) return "MINUTES";
  if (/\/newsevents\/pressreleases\/monetary\d{8}a1\.htm$/i.test(url.pathname)) return "IMPLEMENTATION_NOTE";
  if (/\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/i.test(url.pathname)) return "STATEMENT";
  return null;
}

function dateFromUrl(url: URL) {
  const value = url.pathname.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
  return value ? new Date(Date.UTC(Number(value[1]), Number(value[2]) - 1, Number(value[3]))) : null;
}

/** Discover only the three explicitly supported HTML document types linked from meeting rows. */
export function discoverFomcPolicyDocuments(html: string, baseUrl = FOMC_CALENDAR_URL): DiscoveredPolicyDocument[] {
  const $ = cheerio.load(html);
  const rows: DiscoveredPolicyDocument[] = [];
  $(".fomc-meeting").each((_, meeting) => {
    const minutesPublished = inferPublicationDate($(meeting).find(".fomc-meeting__minutes").text());
    $(meeting).find("a[href]").each((__, anchor) => {
      let url: URL;
      try { url = new URL($(anchor).attr("href")!, baseUrl); } catch { return; }
      if (url.origin !== FED_ORIGIN) return;
      const docType = documentType(url);
      const meetingDate = dateFromUrl(url);
      if (!docType || !meetingDate) return;
      rows.push({
        docType,
        meetingDate,
        publishedAt: docType === "MINUTES" && minutesPublished ? minutesPublished : meetingDate,
        sourceUrl: url.href.split("#")[0],
      });
    });
  });
  return rows.filter((row, index) => rows.findIndex((other) => other.sourceUrl === row.sourceUrl) === index);
}

function allowedFedUrl(value: string) {
  const url = new URL(value);
  return url.origin === FED_ORIGIN && Boolean(documentType(url));
}

async function releaseFor(meetingDate: Date) {
  return prisma.macroRelease.findFirst({
    where: {
      releaseFamily: "FOMC_DECISION",
      scheduledAt: { gte: meetingDate, lt: new Date(meetingDate.getTime() + 86_400_000) },
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, scheduledAt: true },
  });
}

async function persistDocument(candidate: DiscoveredPolicyDocument, rawText: string, fetchedAt: Date, provider: LLMProvider | null) {
  const contentHash = createHash("sha256").update(rawText).digest("hex");
  const duplicate = await prisma.macroPolicyDocument.findFirst({ where: { contentHash }, select: { id: true, sourceUrl: true } });
  if (duplicate && duplicate.sourceUrl !== candidate.sourceUrl) return { status: "deduplicated" as const, id: duplicate.id };
  const existing = await prisma.macroPolicyDocument.findFirst({
    where: { sourceUrl: candidate.sourceUrl, contentHash },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true, promptVersion: true },
  });
  const shouldReparse = !existing || existing.promptVersion !== POLICY_PROMPT_VERSION || Boolean(provider && existing.provider === "deterministic");
  if (existing && !shouldReparse) return { status: "unchanged" as const, id: existing.id };
  const result = await parsePolicyDocument(rawText, provider);
  const parsing = {
    parsedJson: JSON.stringify(result.parsed),
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    reviewStatus: result.reviewStatus,
  };
  if (existing) {
    await prisma.macroPolicyDocument.update({ where: { id: existing.id }, data: parsing });
    return { status: "reparsed" as const, id: existing.id };
  }
  const release = await releaseFor(candidate.meetingDate);
  const created = await prisma.macroPolicyDocument.create({
    data: {
      releaseId: release?.id ?? null,
      centralBank: "FED",
      docType: candidate.docType,
      meetingDate: candidate.meetingDate,
      publishedAt: candidate.docType === "MINUTES" ? candidate.publishedAt : release?.scheduledAt ?? candidate.publishedAt,
      sourceUrl: candidate.sourceUrl,
      rawText,
      contentHash,
      fetchedAt,
      ...parsing,
    },
    select: { id: true },
  });
  return { status: "created" as const, id: created.id };
}

export async function syncFomcPolicyDocuments(options: { since?: Date; now?: Date; provider?: LLMProvider | null } = {}) {
  const now = options.now ?? new Date();
  const since = options.since ?? new Date(now.getTime() - 120 * 86_400_000);
  const robots = await fetchRobots(FED_ORIGIN);
  if (robots === null || !robotsAllows(robots, UA, new URL(FOMC_CALENDAR_URL).pathname)) {
    throw new Error("Federal Reserve robots policy is unavailable or disallows the FOMC calendar.");
  }
  const calendar = await fetchText(FOMC_CALENDAR_URL);
  if (!calendar) throw new Error("Federal Reserve FOMC calendar fetch failed.");
  const documents = discoverFomcPolicyDocuments(calendar).filter((item) => item.publishedAt >= since && item.publishedAt <= now);
  const delayMs = Math.max(1000, (robotsCrawlDelay(robots, UA) ?? 0) * 1000);
  const provider = options.provider === undefined ? await resolveLLMProvider("policy") : options.provider;
  const metrics = { discovered: documents.length, created: 0, unchanged: 0, reparsed: 0, deduplicated: 0, failed: 0 };
  for (const candidate of documents) {
    try {
      if (!allowedFedUrl(candidate.sourceUrl) || !robotsAllows(robots, UA, new URL(candidate.sourceUrl).pathname)) continue;
      await sleep(delayMs);
      const html = await fetchText(candidate.sourceUrl);
      if (!html) throw new Error("Policy document fetch failed.");
      const { rawText } = extractPolicyText(html);
      const result = await persistDocument(candidate, rawText, now, provider);
      metrics[result.status]++;
      console.log(JSON.stringify({ event: "macro.policy.document", docType: candidate.docType, meetingDate: candidate.meetingDate.toISOString(), sourceUrl: candidate.sourceUrl, status: result.status }));
    } catch (error) {
      metrics.failed++;
      console.error(JSON.stringify({ event: "macro.policy.document.failed", sourceUrl: candidate.sourceUrl, message: String(error).slice(0, 500) }));
    }
  }
  return metrics;
}
