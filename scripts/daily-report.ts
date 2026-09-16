import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { buildDailyReport, renderDailyReportCard, renderDailyReportText } from "../src/lib/reports/dailyReport";
import { sendFeishuCard } from "../src/lib/social/feishu";
import { REPORT_ZONE, zoneDayKey } from "../src/lib/zoneTime";

/**
 * Send the morning report.
 *
 * Idempotent per Beijing day: the scheduler ticks through the morning hour and would
 * otherwise send the same report on every tick, so the day's send is recorded in
 * MacroSyncState (the same keyed store the watcher uses) and a second attempt is a no-op.
 * A failed send records nothing and is retried on the next tick, which is the behaviour a
 * transient Feishu outage needs.
 *
 *   npm run daily:report            (send)
 *   npm run daily:report -- --print (render and print, send nothing — also ignores the gate)
 */
const SCOPE = "daily-report";

async function main() {
  const print = process.argv.includes("--print");
  const now = new Date();
  const day = zoneDayKey(now, REPORT_ZONE);
  if (print) {
    const report = await buildDailyReport(now);
    console.log(renderDailyReportText(report));
    return;
  }
  const sent = await prisma.macroSyncState.findUnique({ where: { provider_scopeKey: { provider: SCOPE, scopeKey: day } } });
  if (sent?.lastStatus === "sent") {
    console.log(JSON.stringify({ event: "daily.report.skipped", day, reason: "already sent" }));
    return;
  }
  await runTrackedJob("daily-report", { day }, async () => {
    const report = await buildDailyReport(now);
    const messageId = await sendFeishuCard(renderDailyReportCard(report));
    await prisma.macroSyncState.upsert({
      where: { provider_scopeKey: { provider: SCOPE, scopeKey: day } },
      create: { provider: SCOPE, scopeKey: day, lastAttemptAt: now, lastSuccessAt: now, lastStatus: "sent", metadata: JSON.stringify({ messageId, visitors: report.traffic.visitors }) },
      update: { lastAttemptAt: now, lastSuccessAt: now, lastStatus: "sent", lastError: null, metadata: JSON.stringify({ messageId, visitors: report.traffic.visitors }) },
    });
    console.log(JSON.stringify({ event: "daily.report.sent", day, messageId, visitors: report.traffic.visitors, views: report.traffic.views }));
    return { result: undefined, metrics: { day, visitors: report.traffic.visitors, views: report.traffic.views, releases: report.releases.length } };
  });
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
