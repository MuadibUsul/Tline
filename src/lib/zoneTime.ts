/**
 * Wall-clock facts in a named zone, without a date library.
 *
 * The desk's day is Beijing's, not UTC's: "today's registrations" and "08:00" both mean the
 * reader's morning, and a report that silently used UTC would be a day out at the edges. The
 * offset is read from the zone itself rather than assumed, so nothing breaks if a deployment
 * moves or an offset changes.
 */

/** The desk's own day: the operator reads messages in the morning, in Beijing. */
export const REPORT_ZONE = "Asia/Shanghai";

function partsAt(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

/** Milliseconds the zone is ahead of UTC at that instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = partsAt(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime();
}

/** The zone's calendar day as YYYY-MM-DD. */
export function zoneDayKey(date: Date, timeZone: string): string {
  const parts = partsAt(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** The hour of the day in the zone, 0–23. */
export function zoneHour(date: Date, timeZone: string): number {
  return partsAt(date, timeZone).hour;
}

/** The instant the zone's current day began. */
export function startOfZoneDay(date: Date, timeZone: string): Date {
  const key = zoneDayKey(date, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

/** A zone-local label for a moment, for messages a person reads. */
export function zoneLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone, dateStyle: "medium", timeStyle: "short", hour12: false }).format(date);
}
