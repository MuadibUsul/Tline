import { prisma } from "./db";
import { computeConsensus, consensusChange } from "./consensus";

// The demo user is still seeded so "continue as demo" shows populated data.
export const DEMO_EMAIL = "demo@globalintel.io";

export async function getWatchlistView(userId: string) {
  const items = await prisma.watchlistItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });

  const assets = [];
  for (const it of items.filter((i) => i.kind === "asset")) {
    const asset = await prisma.asset.findUnique({ where: { ticker: it.refId } });
    if (!asset) continue;
    const c = await computeConsensus(asset.id);
    assets.push({
      ticker: asset.ticker,
      name: asset.name,
      score: c?.score ?? null,
      label: c?.label ?? null,
      tone: c?.tone ?? null,
      isFallback: c?.isFallback ?? false,
      windowEnd: c?.windowEnd ?? null,
      d1: await consensusChange(asset.id, 1),
    });
  }

  const instSlugs = items.filter((i) => i.kind === "institution").map((i) => i.refId);
  const institutions = instSlugs.length
    ? await prisma.institution.findMany({ where: { slug: { in: instSlugs } } })
    : [];

  const themes = items.filter((item) => item.kind === "theme").map((item) => item.refId);
  return { assets, institutions, themes };
}

export async function getAlertsView(userId: string) {
  const rules = await prisma.alertRule.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const events = await prisma.alertEvent.findMany({
    where: { rule: { userId } },
    orderBy: { firedAt: "desc" },
    take: 30,
    include: { rule: true },
  });
  return { rules, events };
}
