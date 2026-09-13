import { prisma } from "../../db";
import { evaluateMarketUse, type MarketDataUse } from "./quality";

const samplingSeconds = () => Math.max(60, Number(process.env.MACRO_MARKET_SYNC_INTERVAL_MS || 30 * 60_000) / 1000);

async function license(datasetKey: string | null) {
  if (!datasetKey) return null;
  return prisma.dataLicensePolicy.findUnique({ where: { datasetKey }, select: { status: true, allowedUses: true, confirmedAt: true, expiresAt: true } });
}

export async function getAssetMarketSnapshot(ticker: string, use: MarketDataUse = "public_display", now = new Date()) {
  const instrument = await prisma.marketInstrument.findFirst({
    where: { enabled: true, OR: [{ symbol: ticker }, { asset: { ticker } }] },
    include: { observations: { orderBy: { observedAt: "desc" }, take: 1 } },
  });
  if (!instrument) return { available: false as const, reason: "unsupported" as const };
  const observation = instrument.observations[0];
  if (!observation) return { available: false as const, reason: "no_matching_data" as const, instrument };
  const decision = evaluateMarketUse({ ...observation, license: await license(observation.licenseKey), samplingIntervalSeconds: samplingSeconds() }, use, now);
  if (!decision.usable) return { available: false as const, reason: decision.reason!, instrument, asOf: observation.observedAt, decision };
  const history = await prisma.marketObservation.findMany({
    where: { instrumentId: instrument.id, provider: observation.provider, externalSymbol: observation.externalSymbol, interval: observation.interval, status: "PUBLISHED", observedAt: { gte: new Date(now.getTime() - 30 * 864e5), lte: observation.observedAt } },
    orderBy: { observedAt: "asc" },
    select: { id: true, observedAt: true, close: true },
  });
  return { available: true as const, instrument, observation, history, decision };
}

export async function getMarketMovesForUse(since: Date, now = new Date(), use: MarketDataUse = "public_display") {
  const rows = await prisma.marketObservation.findMany({
    where: { observedAt: { gte: since, lte: now }, status: "PUBLISHED", instrument: { enabled: true } },
    orderBy: { observedAt: "asc" },
    include: { instrument: { select: { symbol: true } } },
  });
  const licenses = new Map<string, Awaited<ReturnType<typeof license>>>();
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const symbol = row.instrument.symbol.toUpperCase();
    const key = [symbol, row.provider, row.externalSymbol, row.interval, row.priceType, row.unit, row.licenseKey ?? ""].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const candidates = [] as Array<{ symbol: string; changePct: number; observationIds: string[]; span: number }>;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const latest = group.at(-1)!;
    if (!licenses.has(latest.licenseKey ?? "")) licenses.set(latest.licenseKey ?? "", await license(latest.licenseKey));
    const decision = evaluateMarketUse({ ...latest, license: licenses.get(latest.licenseKey ?? "") ?? null, samplingIntervalSeconds: samplingSeconds() }, use, now);
    if (!decision.usable) continue;
    const valid = group.filter((row) => Number.isFinite(Number(row.close)) && Number(row.close) > 0);
    if (valid.length < 2) continue;
    const first = valid[0];
    const last = valid.at(-1)!;
    candidates.push({ symbol: latest.instrument.symbol.toUpperCase(), changePct: (Number(last.close) / Number(first.close) - 1) * 100, observationIds: valid.map((row) => row.id), span: last.observedAt.getTime() - first.observedAt.getTime() });
  }
  const best = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) if (!best.has(candidate.symbol) || best.get(candidate.symbol)!.span < candidate.span) best.set(candidate.symbol, candidate);
  return [...best.values()].map(({ symbol, changePct, observationIds }) => ({ symbol, changePct, observationIds }));
}
