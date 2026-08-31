import * as cheerio from "cheerio";
import { localTimeToUtc } from "./normalize";
import { getMacroReleaseFamily, macroReleaseFamilies } from "./registry";
import { storeCalendarRelease, type CalendarReleaseCandidate } from "./release";
import { createJsonClient, type FetchLike } from "./providers/types";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const priority = (source: CalendarReleaseCandidate["sourceKind"]) => source === "OFFICIAL" ? 10 : source === "FRED" ? 20 : 30;

function family(key: string) {
  const value = getMacroReleaseFamily(key);
  if (!value) throw new Error(`Unknown macro release family ${key}.`);
  return value;
}

function localDateTime(year: number, month: number, day: number, time: string, timeZone: string) {
  return localTimeToUtc(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}:00`, timeZone);
}

function parseUsDate(value: string) {
  const match = value.trim().toLowerCase().match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const month = match ? MONTHS.indexOf(match[1]) + 1 : 0;
  return match && month ? { year: Number(match[3]), month, day: Number(match[2]) } : null;
}

function time24(value: string) {
  const match = value.trim().toLowerCase().replace(/\s+/g, " ").match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/);
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3] === "p" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function matchingFamily(source: string, title: string) {
  const normalized = title.replace(/\\([,;])/g, "$1").toLowerCase();
  return macroReleaseFamilies.find((item) => item.calendar.source === source && item.calendar.aliases.some((alias) => normalized.includes(alias.toLowerCase()))) ?? null;
}

/** Parse the official BLS iCalendar feed, including its stable UID and cancellation state. */
export function parseBlsIcs(text: string): CalendarReleaseCandidate[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return unfolded.split("BEGIN:VEVENT").slice(1).flatMap((block) => {
    const lines = block.split(/\r?\n/).filter((line) => !line.startsWith("END:VEVENT"));
    const get = (name: string) => lines.find((line) => line === name || line.startsWith(`${name}:`) || line.startsWith(`${name};`));
    const summary = get("SUMMARY")?.slice(get("SUMMARY")!.indexOf(":") + 1).trim() ?? "";
    const definition = matchingFamily("BLS_ICS", summary);
    const start = get("DTSTART");
    const uid = get("UID")?.slice(get("UID")!.indexOf(":") + 1).trim();
    if (!definition || !start || !uid) return [];
    const raw = start.slice(start.indexOf(":") + 1).trim();
    const parts = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!parts) return [];
    const time = parts[4] ? `${parts[4]}:${parts[5]}` : definition.calendar.defaultLocalTime;
    const scheduledAt = parts[7]
      ? new Date(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6] ?? "00"}Z`)
      : localDateTime(Number(parts[1]), Number(parts[2]), Number(parts[3]), time, definition.normalTimezone);
    const status = get("STATUS")?.endsWith(":CANCELLED") ? "CANCELLED" as const : "SCHEDULED" as const;
    const sourceUrl = get("URL")?.slice(get("URL")!.indexOf(":") + 1).trim() || definition.calendar.sourceUrl;
    return [{ releaseFamily: definition.key, externalReleaseId: `bls:${uid}`, scheduledAt, sourceTimezone: definition.normalTimezone, sourceUrl, sourceKind: "OFFICIAL", status }];
  });
}

/** Parse release rows from BEA's official schedule page. */
export function parseBeaSchedule(html: string, year: number): CalendarReleaseCandidate[] {
  const $ = cheerio.load(html);
  return $("tr").toArray().flatMap((row) => {
    const title = $(row).find(".release-title").text().replace(/\s+/g, " ").trim();
    const definition = matchingFamily("BEA_SCHEDULE", title);
    const dateText = $(row).find(".release-date").text().replace(/\s+/g, " ").trim();
    const time = time24($(row).find("small").text()) ?? definition?.calendar.defaultLocalTime;
    const date = dateText.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
    const month = date ? MONTHS.indexOf(date[1].toLowerCase()) + 1 : 0;
    if (!definition || !date || !month || !time) return [];
    const identity = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return [{
      releaseFamily: definition.key,
      externalReleaseId: `bea:${definition.key}:${identity}`,
      scheduledAt: localDateTime(year, month, Number(date[2]), time, definition.normalTimezone),
      sourceTimezone: definition.normalTimezone,
      sourceUrl: definition.calendar.sourceUrl,
      sourceKind: "OFFICIAL" as const,
      status: "SCHEDULED" as const,
    }];
  });
}

/** Parse meeting-end dates; the policy statement is scheduled for 2:00 p.m. Eastern. */
export function parseFomcCalendar(html: string): CalendarReleaseCandidate[] {
  const $ = cheerio.load(html);
  const definition = family("FOMC_DECISION");
  const out: CalendarReleaseCandidate[] = [];
  $(".panel").each((_, panel) => {
    const year = Number($(panel).find(".panel-heading").first().text().match(/(20\d{2})\s+FOMC Meetings/i)?.[1]);
    if (!year) return;
    $(panel).find(".fomc-meeting").each((index, meeting) => {
      const monthText = $(meeting).find(".fomc-meeting__month").text().trim().toLowerCase();
      const dateText = $(meeting).find(".fomc-meeting__date").text().replace(/\*/g, "").trim();
      const monthNames = monthText.split("/");
      const days = dateText.split("-").map(Number);
      const endMonth = MONTHS.indexOf(monthNames.at(-1)!) + 1;
      const endDay = days.at(-1);
      if (!endMonth || !endDay) return;
      out.push({
        releaseFamily: definition.key,
        externalReleaseId: `fomc:${year}:${index + 1}`,
        scheduledAt: localDateTime(year, endMonth, endDay, definition.calendar.defaultLocalTime, definition.normalTimezone),
        sourceTimezone: definition.normalTimezone,
        sourceUrl: definition.calendar.sourceUrl,
        sourceKind: "OFFICIAL",
        status: "SCHEDULED",
      });
    });
  });
  return out;
}

/** Generate the weekly official EIA schedule and replace holiday weeks with published exceptions. */
export function buildEiaSchedule(html: string, from: Date, to: Date): CalendarReleaseCandidate[] {
  const $ = cheerio.load(html);
  const definition = family("EIA_PETROLEUM_STATUS");
  const exceptions = new Map<string, { date: { year: number; month: number; day: number }; time: string }>();
  $("tr").each((_, row) => {
    const cells = $(row).find("th,td").toArray().map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
    const week = parseUsDate(cells[0] ?? "");
    const alternate = parseUsDate(cells[1] ?? "");
    const time = time24(cells[3] ?? "");
    if (week && alternate && time) exceptions.set(`${week.year}-${String(week.month).padStart(2, "0")}-${String(week.day).padStart(2, "0")}`, { date: alternate, time });
  });
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor.getUTCDay() !== 5) cursor.setUTCDate(cursor.getUTCDate() - 1);
  const out: CalendarReleaseCandidate[] = [];
  for (; cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const weekKey = cursor.toISOString().slice(0, 10);
    const alternate = exceptions.get(weekKey);
    const regular = new Date(cursor); regular.setUTCDate(regular.getUTCDate() + 5);
    const date = alternate?.date ?? { year: regular.getUTCFullYear(), month: regular.getUTCMonth() + 1, day: regular.getUTCDate() };
    const scheduledAt = localDateTime(date.year, date.month, date.day, alternate?.time ?? definition.calendar.defaultLocalTime, definition.normalTimezone);
    if (scheduledAt < from || scheduledAt > to) continue;
    out.push({ releaseFamily: definition.key, externalReleaseId: `eia:wpsr:${weekKey}`, scheduledAt, sourceTimezone: definition.normalTimezone, sourceUrl: definition.calendar.sourceUrl, sourceKind: "OFFICIAL", status: alternate ? "DELAYED" : "SCHEDULED" });
  }
  return out;
}

interface FredReleaseDates { release_dates?: Array<{ release_id?: number; date?: string }> }

export function parseFredReleaseDates(value: FredReleaseDates, releaseFamily: string): CalendarReleaseCandidate[] {
  const definition = family(releaseFamily);
  const releaseId = definition.calendar.fredReleaseId;
  if (!releaseId) return [];
  return (value.release_dates ?? []).flatMap((item) => {
    if (item.release_id !== releaseId || !item.date) return [];
    const date = item.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!date) return [];
    return [{ releaseFamily, externalReleaseId: `fred:${releaseId}:${item.date}`, scheduledAt: localDateTime(Number(date[1]), Number(date[2]), Number(date[3]), definition.calendar.defaultLocalTime, definition.normalTimezone), sourceTimezone: definition.normalTimezone, sourceUrl: `https://fred.stlouisfed.org/release?rid=${releaseId}`, sourceKind: "FRED" as const, status: "SCHEDULED" as const }];
  });
}

async function fetchText(url: string, fetchImpl: FetchLike) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": "TlineMacroIntelligence/0.1 (+official economic calendar client)" }, signal: AbortSignal.timeout(15_000) });
      if (response.ok) return await response.text();
      if (response.status !== 429 && response.status < 500) break;
    } catch { /* retry once */ }
  }
  return null;
}

export async function syncCalendarCandidates(
  candidates: CalendarReleaseCandidate[],
  persist: (candidate: CalendarReleaseCandidate) => Promise<{ status: "created" | "updated" | "unchanged" }> = storeCalendarRelease,
) {
  const unique = new Map<string, CalendarReleaseCandidate>();
  for (const candidate of candidates.sort((left, right) => priority(left.sourceKind) - priority(right.sourceKind))) {
    const key = `${candidate.releaseFamily}:${candidate.scheduledAt.toISOString()}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const metrics = { created: 0, updated: 0, unchanged: 0 };
  for (const candidate of [...unique.values()].sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())) {
    const result = await persist(candidate);
    metrics[result.status]++;
  }
  return { candidates: unique.size, ...metrics };
}

export async function loadEconomicCalendar(options: { fetch?: FetchLike; now?: Date; horizonDays?: number; fredApiKey?: string; manual?: CalendarReleaseCandidate[] } = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? new Date();
  const end = new Date(now.getTime() + (options.horizonDays ?? 370) * 86_400_000);
  const candidates: CalendarReleaseCandidate[] = [...(options.manual ?? [])];
  const officialCounts = new Map<string, number>();
  const add = (rows: CalendarReleaseCandidate[]) => rows.forEach((row) => { candidates.push(row); officialCounts.set(row.releaseFamily, (officialCounts.get(row.releaseFamily) ?? 0) + 1); });

  const [bls, bea, beaNext, fomc, eia] = await Promise.all([
    fetchText(family("BLS_CPI").calendar.sourceUrl, fetchImpl),
    fetchText(family("BEA_GDP").calendar.sourceUrl, fetchImpl),
    fetchText(`${family("BEA_GDP").calendar.sourceUrl}/next-year`, fetchImpl),
    fetchText(family("FOMC_DECISION").calendar.sourceUrl, fetchImpl),
    fetchText(family("EIA_PETROLEUM_STATUS").calendar.sourceUrl, fetchImpl),
  ]);
  if (bls) add(parseBlsIcs(bls));
  if (bea) add(parseBeaSchedule(bea, now.getUTCFullYear()));
  if (beaNext) add(parseBeaSchedule(beaNext, now.getUTCFullYear() + 1));
  if (fomc) add(parseFomcCalendar(fomc));
  if (eia) add(buildEiaSchedule(eia, now, end));

  const fredApiKey = options.fredApiKey ?? process.env.FRED_API_KEY;
  if (fredApiKey) {
    const requestJson = createJsonClient("fred-calendar", { fetch: fetchImpl, minIntervalMs: 250 });
    for (const definition of macroReleaseFamilies.filter((item) => item.calendar.fredReleaseId && !officialCounts.has(item.key))) {
      const url = new URL("https://api.stlouisfed.org/fred/release/dates");
      url.searchParams.set("release_id", String(definition.calendar.fredReleaseId));
      url.searchParams.set("api_key", fredApiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("include_release_dates_with_no_data", "true");
      add(parseFredReleaseDates(await requestJson<FredReleaseDates>(url.href), definition.key));
    }
  }
  return candidates.filter((candidate) => candidate.scheduledAt >= now && candidate.scheduledAt <= end);
}
