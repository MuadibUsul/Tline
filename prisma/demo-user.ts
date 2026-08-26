import "dotenv/config";
import { prisma } from "../src/lib/db";
import { evaluateRules } from "../src/lib/alerts";
import { DEMO_EMAIL } from "../src/lib/user";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: "Demo Trader", tier: "trader" },
    update: {},
  });

  const watch: { kind: string; refId: string }[] = [
    { kind: "asset", refId: "XAUUSD" },
    { kind: "asset", refId: "WTI" },
    { kind: "asset", refId: "DXY" },
    { kind: "asset", refId: "BTC" },
    { kind: "institution", refId: "goldman-sachs" },
    { kind: "institution", refId: "ubs" },
  ];
  for (const w of watch) {
    await prisma.watchlistItem.upsert({
      where: { userId_kind_refId: { userId: user.id, kind: w.kind, refId: w.refId } },
      create: { userId: user.id, ...w },
      update: {},
    });
  }

  const rules = [
    { name: "Gold consensus turns strong", type: "CONSENSUS_ABOVE", assetTicker: "XAUUSD", threshold: 80 },
    { name: "Oil consensus drops fast", type: "CONSENSUS_DROP_24H", assetTicker: "WTI", threshold: 5 },
    { name: "USD consensus turns bearish", type: "CONSENSUS_BELOW", assetTicker: "DXY", threshold: 40 },
    { name: "Any asset rips higher", type: "CONSENSUS_RISE_24H", assetTicker: null, threshold: 10 },
  ];
  // Rules have no natural unique key besides id; clear+recreate for idempotent demo.
  await prisma.alertRule.deleteMany({ where: { userId: user.id } });
  for (const r of rules) {
    await prisma.alertRule.create({ data: { userId: user.id, ...r } });
  }

  const fired = await evaluateRules();
  console.log(`Demo user ready · ${watch.length} watchlist items · ${rules.length} rules · ${fired} alerts fired.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
