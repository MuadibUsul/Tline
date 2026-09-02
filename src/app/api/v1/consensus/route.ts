import { prisma } from "@/lib/db";
import { computeConsensusMany, consensusDeltas } from "@/lib/consensus";
import { ApiRequestError, withApiKey } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

// Current cross-institution consensus per asset, with the 1/7/30-day moves that make a
// score readable on its own. Contributors are omitted: the per-report detail belongs to
// /research, and repeating it here would make the payload grow with every asset.
export const GET = withApiKey("consensus:read", async (request) => {
  const ticker = new URL(request.url).searchParams.get("ticker");
  const assets = await prisma.asset.findMany({
    ...(ticker ? { where: { ticker: ticker.toUpperCase() } } : {}),
    orderBy: { ticker: "asc" },
  });
  if (ticker && assets.length === 0) throw new ApiRequestError("not_found", "No asset with that ticker.", 404);

  const ids = assets.map((asset) => asset.id);
  const [scores, deltas] = await Promise.all([computeConsensusMany(ids), consensusDeltas(ids, [1, 7, 30])]);

  return {
    data: assets.flatMap((asset) => {
      const result = scores.get(asset.id);
      if (!result) return [];
      const delta = deltas.get(asset.id) ?? {};
      return [{
        ticker: asset.ticker,
        name: asset.name,
        assetClass: asset.assetClass,
        score: result.score,
        label: result.label,
        tone: result.tone,
        institutionCount: result.institutionCount,
        bullishCount: result.bullishCount,
        neutralCount: result.neutralCount,
        bearishCount: result.bearishCount,
        // True when the window held no research and an older one was used instead, so a
        // consumer can tell a quiet asset from a current reading.
        isFallback: result.isFallback,
        windowStart: result.windowStart.toISOString(),
        windowEnd: result.windowEnd.toISOString(),
        change: { d1: delta[1] ?? null, d7: delta[7] ?? null, d30: delta[30] ?? null },
      }];
    }),
  };
});
