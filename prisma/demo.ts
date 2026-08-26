import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ensureAssets, persistArticle } from "../src/lib/ingest/store";
import { computeConsensus } from "../src/lib/consensus";

const D = (days: number) => new Date(Date.now() - days * 864e5);

interface Demo {
  slug: string;
  title: string;
  text: string;
  url: string;
  daysAgo: number;
  author?: string;
}

const ARTICLES: Demo[] = [
  {
    slug: "goldman-sachs", author: "Commodities Research",
    title: "Gold: raising our 12-month target to $5,000 on fiscal risk and central-bank demand",
    url: "https://www.goldmansachs.com/insights/gold-outlook-2026",
    daysAgo: 0,
    text: "We are strongly bullish on gold and raise our price target from $4,800 → $5,000. Persistent fiscal risk, falling real yields and record central-bank demand form a constructive backdrop. We see meaningful upside and conviction in bullion as a portfolio hedge into 2026.",
  },
  {
    slug: "ubs", author: "Chief Investment Office",
    title: "AI fundamentals remain intact despite tech volatility",
    url: "https://www.ubs.com/insights/ai-fundamentals-2026",
    daysAgo: 0,
    text: "AI capex remains healthy and semiconductor valuations are not materially stretched versus history. We upgrade semiconductors and stay bullish on NVIDIA; the recent selloff reflects positioning, not fundamentals. Beneficiaries include NVDA and the broader chips complex. Risk: US long-term treasury yields rise again.",
  },
  {
    slug: "ubs", author: "CIO Commodities",
    title: "Gold: lifting target to $4,900 as real yields decline",
    url: "https://www.ubs.com/insights/gold-target-4900",
    daysAgo: 1,
    text: "We raise our gold target from $4,700 → $4,900. A bullish setup persists as real yields decline and demand for bullion stays strong. Constructive outlook maintained.",
  },
  {
    slug: "ing", author: "Commodities Strategy",
    title: "Oil: supply glut deepens into Q4, cutting Brent forecast",
    url: "https://think.ing.com/articles/oil-supply-glut-q4",
    daysAgo: 0,
    text: "We are bearish on oil. A deepening supply glut and oversupply from non-OPEC producers weigh on crude. We cut our Brent target from $68 → $62 with clear downside as weak demand persists into Q4.",
  },
  {
    slug: "saxo", author: "Strategy Team",
    title: "Crude oil downside as geopolitical risk premium fades",
    url: "https://www.home.saxo/insights/oil-risk-premium",
    daysAgo: 1,
    text: "The geopolitical risk premium in oil is fading and we turn bearish. Lower target and downside risk as the Hormuz premium unwinds. Reduce exposure to crude.",
  },
  {
    slug: "j-p-morgan", author: "Global Commodities",
    title: "Gold could reach $5,100; we raise our target",
    url: "https://www.jpmorgan.com/insights/gold-5100",
    daysAgo: 3,
    text: "We raise our gold target from $4,900 → $5,100. Bullish drivers include central-bank demand and fiscal risk. Upside remains as bullion outperforms.",
  },
  {
    slug: "blackrock", author: "Investment Institute",
    title: "Staying overweight US equities and the S&P 500",
    url: "https://www.blackrock.com/insights/us-equities-overweight",
    daysAgo: 2,
    text: "We remain constructive and overweight US equities. Earnings strength supports the S&P 500 and we stay bullish on US stocks despite elevated valuations. Tailwind from resilient consumer demand.",
  },
  {
    slug: "morgan-stanley", author: "Global Macro",
    title: "US dollar to weaken as Fed pivots toward rate cuts",
    url: "https://www.morganstanley.com/insights/usd-weaker-2026",
    daysAgo: 1,
    text: "We are bearish on the US dollar. As the Fed pivots toward rate cuts, the greenback faces downside. Underweight USD; we see the dollar lower through 2026.",
  },
  {
    slug: "scotiabank", author: "Economics",
    title: "USD outlook: downside bias as rate differentials narrow",
    url: "https://www.scotiabank.com/economics/usd-outlook",
    daysAgo: 2,
    text: "The US dollar carries a downside bias as rate differentials narrow. We are bearish on USD and expect the dollar to weaken. Reduce dollar longs.",
  },
  {
    slug: "pictet", author: "Asset Management",
    title: "Bitcoin: constructive as institutional adoption builds",
    url: "https://www.pictet.com/insights/bitcoin-adoption",
    daysAgo: 1,
    text: "We turn bullish on bitcoin as institutional adoption builds and ETF inflows accelerate. Upside for BTC with a constructive medium-term view.",
  },
  {
    slug: "nomura", author: "Global Markets Research",
    title: "Treasuries: 10-year yields to drift lower, bullish duration",
    url: "https://www.nomuraconnects.com/articles/treasury-duration",
    daysAgo: 4,
    text: "We are bullish on US treasuries and add duration. We expect the 10-year yield to drift lower as disinflation continues. Constructive on bond yields falling.",
  },
  {
    slug: "mufg", author: "Global Markets",
    title: "USD/JPY: yen to strengthen as BoJ normalises",
    url: "https://www.bk.mufg.jp/research/usdjpy-yen",
    daysAgo: 3,
    text: "We expect the yen to strengthen as the BoJ normalises policy. Bearish USD/JPY with downside as the dollar weakens against the yen.",
  },
  {
    slug: "dbs", author: "CIO Office",
    title: "S&P 500: neutral near-term after strong run",
    url: "https://www.dbs.com/insights/sp500-neutral",
    daysAgo: 5,
    text: "After a strong run we move to neutral on the S&P 500. Valuations are full and we see balanced risk. No strong directional view near-term on US equities.",
  },
  {
    slug: "rbc", author: "Economics",
    title: "Oil: modestly bearish as inventories build",
    url: "https://thoughtleadership.rbc.com/economics/oil-inventories",
    daysAgo: 6,
    text: "We are modestly bearish on oil as inventories build and demand softens. Downside risk to crude with a lower target into year-end.",
  },

  // --- Historical articles: build multi-step target chains + one direction flip ---
  {
    slug: "goldman-sachs", author: "Commodities Research",
    title: "Gold: initiating a bullish view with a $4,600 target",
    url: "https://www.goldmansachs.com/insights/gold-initiation-4600",
    daysAgo: 22,
    text: "We initiate a bullish view on gold with a price target of $4,600. Central-bank demand and falling real yields support upside for bullion.",
  },
  {
    slug: "goldman-sachs", author: "Commodities Research",
    title: "Gold: lifting target to $4,800 as fiscal risk builds",
    url: "https://www.goldmansachs.com/insights/gold-4800",
    daysAgo: 9,
    text: "We remain bullish on gold and raise our target from $4,600 → $4,800 as fiscal risk builds and central-bank demand stays strong. Continued upside expected.",
  },
  {
    slug: "ubs", author: "CIO Commodities",
    title: "Gold: initiating with a $4,700 target",
    url: "https://www.ubs.com/insights/gold-initiation-4700",
    daysAgo: 12,
    text: "We turn bullish on gold with an initial target of $4,700 as real yields decline. Constructive medium-term view on bullion.",
  },
  {
    slug: "morgan-stanley", author: "Global Macro",
    title: "US dollar: staying neutral near-term",
    url: "https://www.morganstanley.com/insights/usd-neutral",
    daysAgo: 16,
    text: "We stay neutral on the US dollar near-term as rate differentials remain balanced. No strong directional view on USD for now.",
  },
];

const REVIEWED_DEMO_TRANSLATION = {
  sourceUrl: "https://www.goldmansachs.com/insights/gold-outlook-2026",
  title: "黄金：鉴于财政风险与央行需求，将12个月目标价上调至$5,000",
  text: "我们坚定看多黄金，并将目标价从$4,800上调至$5,000。持续的财政风险、实际收益率下降以及创纪录的央行需求构成了有利背景。展望2026年，我们认为黄金作为投资组合对冲工具具有显著上行空间，且对此判断抱有较高信心。",
};

// Fabricated trend so the UI shows believable 1D / 7D / 30D deltas.
const TREND: Record<string, { d1: number; d7: number; d30: number }> = {
  XAUUSD: { d1: 4, d7: 11, d30: 19 },
  WTI: { d1: -6, d7: -9, d30: -15 },
  BTC: { d1: 3, d7: 8, d30: 12 },
  SPX: { d1: 0, d7: 2, d30: 5 },
  DXY: { d1: -2, d7: -9, d30: -14 },
  US10Y: { d1: 1, d7: 4, d30: 6 },
};

async function main() {
  await ensureAssets();
  const insts = await prisma.institution.findMany({ select: { id: true, slug: true, name: true } });
  const bySlug = new Map(insts.map((i) => [i.slug, i]));

  let created = 0;
  for (const a of ARTICLES) {
    const inst = bySlug.get(a.slug);
    if (!inst) {
      console.warn("  ! missing institution", a.slug);
      continue;
    }
    const res = await persistArticle(inst.id, inst.name, {
      title: a.title,
      text: a.text,
      sourceUrl: a.url,
      author: a.author ?? null,
      publishedAt: D(a.daysAgo),
    });
    // Backdate the article's publishedAt to the intended day.
    if (res === "created") {
      await prisma.article.update({
        where: { urlHash: (await import("../src/lib/hash")).urlHash(a.url) },
        data: { publishedAt: D(a.daysAgo) },
      });
      created++;
    }
  }

  // One manually reviewed bilingual fixture exercises the full translation/PDF UI
  // without pretending that demo text came from a live model.
  const translatedArticle = await prisma.article.findUnique({
    where: { urlHash: (await import("../src/lib/hash")).urlHash(REVIEWED_DEMO_TRANSLATION.sourceUrl) },
    include: { segments: { orderBy: { position: "asc" } } },
  });
  if (translatedArticle) {
    const sourceSegment = translatedArticle.segments[0] ?? await prisma.articleSegment.create({
      data: {
        articleId: translatedArticle.id,
        position: 0,
        heading: null,
        text: translatedArticle.rawText ?? "",
      },
    });
    const translation = await prisma.articleTranslation.upsert({
      where: { articleId_locale: { articleId: translatedArticle.id, locale: "zh-CN" } },
      create: {
        articleId: translatedArticle.id,
        locale: "zh-CN",
        title: REVIEWED_DEMO_TRANSLATION.title,
        text: REVIEWED_DEMO_TRANSLATION.text,
        provider: "human",
        model: "reviewed-demo-fixture",
        promptVersion: "manual-v1",
        glossaryVersion: "finance-zh-cn-v1",
        status: "reviewed",
        qualityScore: 1,
      },
      update: {
        title: REVIEWED_DEMO_TRANSLATION.title,
        text: REVIEWED_DEMO_TRANSLATION.text,
        status: "reviewed",
        qualityScore: 1,
      },
    });
    await prisma.articleTranslationSegment.deleteMany({ where: { translationId: translation.id } });
    await prisma.articleTranslationSegment.create({
      data: {
        translationId: translation.id,
        sourceSegmentId: sourceSegment.id,
        position: 0,
        heading: null,
        text: REVIEWED_DEMO_TRANSLATION.text,
      },
    });
  }

  // Build consensus history with a light trend for featured assets.
  const assets = await prisma.asset.findMany();
  let snaps = 0;
  for (const asset of assets) {
    const c = await computeConsensus(asset.id);
    if (!c) continue;
    const tr = TREND[asset.ticker] ?? { d1: 0, d7: 0, d30: 0 };
    const points: [number, number][] = [
      [30, c.score - tr.d30],
      [7, c.score - tr.d7],
      [1, c.score - tr.d1],
      [0, c.score],
    ];
    for (const [days, score] of points) {
      await prisma.consensusHistory.create({
        data: {
          assetId: asset.id,
          timestamp: D(days),
          consensusScore: Math.max(0, Math.min(100, Math.round(score))),
          institutionCount: c.institutionCount,
          bullishCount: c.bullishCount,
          neutralCount: c.neutralCount,
          bearishCount: c.bearishCount,
        },
      });
      snaps++;
    }
  }

  console.log(`Demo: ${created} articles created · ${snaps} consensus snapshots.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
