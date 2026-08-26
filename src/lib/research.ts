import { prisma } from "./db";
import { ASSETS, directionLabel } from "./assets";
import { computeConsensus } from "./consensus";
import { getLLMProvider } from "./llm/provider";

// AI Research — answers over the STRUCTURED DB first, never a web search.
// Deterministic intent router; optional LLM synthesis layered on the retrieved evidence.

export interface EvidenceRow {
  institution: string;
  slug: string;
  text: string;
  detail?: string;
  sourceUrl: string;
  researchId: string;
  tone?: "bull" | "bear" | "neu";
  when: Date;
}

export interface Answer {
  intent: string;
  title: string;
  summary: string;
  rows: EvidenceRow[];
  usedLLM: boolean;
  assetTicker?: string;
}

const isCJK = (s: string) => /[一-鿿]/.test(s);

function detectWindow(q: string): number {
  if (/24\s*(小时|h|hour)|昨天|overnight|today|今天/i.test(q)) return 1;
  if (/(7|七)\s*(天|day)|一?周|week/i.test(q)) return 7;
  if (/(90|九十)\s*(天|day)|季度|quarter/i.test(q)) return 90;
  return 30; // default: last month
}

function detectAsset(q: string) {
  const low = q.toLowerCase();
  let best: (typeof ASSETS)[number] | null = null;
  let bestLen = 0;
  for (const a of ASSETS) {
    if (low.includes(a.ticker.toLowerCase()) && a.ticker.length > bestLen) { best = a; bestLen = a.ticker.length; }
    for (const al of a.aliases) {
      if (low.includes(al) && al.length > bestLen) { best = a; bestLen = al.length; }
    }
  }
  return best;
}

function detectDirection(q: string): "bull" | "bear" | null {
  if (/看空|看跌|做空|bearish|downgrade|下调|cut|lower|sell/i.test(q)) return "bear";
  if (/看多|看涨|做多|bullish|upgrade|上调|raise|higher|buy/i.test(q)) return "bull";
  return null;
}

async function assetRow(ticker: string) {
  return prisma.asset.findUnique({ where: { ticker } });
}

// ---- Intent handlers ----

async function targetChanges(q: string, asset: ReturnType<typeof detectAsset>, days: number): Promise<Answer | null> {
  if (!/目标价|target|上调|下调|raise|cut|upgrade|downgrade|price target/i.test(q)) return null;
  const since = new Date(Date.now() - days * 864e5);
  const dir = detectDirection(q);
  const rows = await prisma.articleAsset.findMany({
    where: {
      target: { not: null },
      previousTarget: { not: null },
      article: { publishedAt: { gte: since } },
      ...(asset ? { asset: { ticker: asset.ticker } } : {}),
    },
    include: { article: { include: { institution: true } }, asset: true },
    orderBy: { article: { publishedAt: "desc" } },
  });
  const filtered = rows.filter((r) => {
    if (!r.target || !r.previousTarget) return false;
    if (dir === "bull") return r.target > r.previousTarget;
    if (dir === "bear") return r.target < r.previousTarget;
    return true;
  });
  if (filtered.length === 0) return null;

  const ev: EvidenceRow[] = filtered.map((r) => ({
    institution: r.article.institution.name,
    slug: r.article.institution.slug,
    text: `${r.asset.name}: $${r.previousTarget!.toLocaleString()} → $${r.target!.toLocaleString()}`,
    sourceUrl: r.article.sourceUrl,
    researchId: r.article.id,
    tone: r.target! >= r.previousTarget! ? "bull" : "bear",
    when: r.article.publishedAt,
  }));
  const cn = isCJK(q);
  const scope = asset ? asset.name : (cn ? "多个资产" : "several assets");
  const verb = dir === "bear" ? (cn ? "下调" : "cut") : dir === "bull" ? (cn ? "上调" : "raised") : (cn ? "调整" : "revised");
  return {
    intent: "TARGET_CHANGES",
    title: cn ? `${scope}：过去 ${days} 天的目标价${verb}` : `${scope}: price targets ${verb} in the last ${days}d`,
    summary: cn
      ? `过去 ${days} 天有 ${ev.length} 家机构${verb}了${scope}的目标价。`
      : `${ev.length} institutions ${verb} targets on ${scope} in the last ${days} days.`,
    rows: ev,
    usedLLM: false,
    assetTicker: asset?.ticker,
  };
}

async function whyDirection(q: string, asset: ReturnType<typeof detectAsset>, dir: "bull" | "bear" | null, days: number): Promise<Answer | null> {
  if (!asset || !dir || !/为什么|why|原因|reason|driver/i.test(q)) return null;
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.articleAsset.findMany({
    where: {
      asset: { ticker: asset.ticker },
      direction: dir === "bull" ? { gt: 0 } : { lt: 0 },
      article: { publishedAt: { gte: since } },
    },
    include: { article: { include: { institution: true, analysis: true } }, asset: true },
    orderBy: { article: { publishedAt: "desc" } },
  });
  if (rows.length === 0) return null;
  const ev: EvidenceRow[] = rows.map((r) => ({
    institution: r.article.institution.name,
    slug: r.article.institution.slug,
    text: r.article.analysis?.summary?.slice(0, 180) || r.article.title,
    detail: r.article.title,
    sourceUrl: r.article.sourceUrl,
    researchId: r.article.id,
    tone: dir,
    when: r.article.publishedAt,
  }));
  const cn = isCJK(q);
  const word = dir === "bear" ? (cn ? "看空" : "bearish") : (cn ? "看多" : "bullish");
  return {
    intent: "WHY_DIRECTION",
    title: cn ? `为什么机构${word} ${asset.name}` : `Why institutions are ${word} on ${asset.name}`,
    summary: cn
      ? `过去 ${days} 天有 ${ev.length} 家机构${word} ${asset.name}，主要理由见下。`
      : `${ev.length} institutions turned ${word} on ${asset.name} in the last ${days} days. Key reasons below.`,
    rows: ev,
    usedLLM: false,
    assetTicker: asset.ticker,
  };
}

async function whoChanged(q: string, days: number): Promise<Answer | null> {
  if (!/谁|哪些|who|changed|改变|转向|switch|flip/i.test(q)) return null;
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.articleAsset.findMany({
    where: { article: { publishedAt: { gte: since } } },
    include: { article: { include: { institution: true } }, asset: true },
    orderBy: { article: { publishedAt: "desc" } },
  });
  // group by institution+asset, compare two most recent directions
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.article.institutionId}:${r.assetId}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const ev: EvidenceRow[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const [cur, prev] = list;
    if (Math.sign(cur.direction) === Math.sign(prev.direction) && cur.direction === prev.direction) continue;
    ev.push({
      institution: cur.article.institution.name,
      slug: cur.article.institution.slug,
      text: `${cur.asset.name}: ${directionLabel(prev.direction).label} → ${directionLabel(cur.direction).label}`,
      sourceUrl: cur.article.sourceUrl,
      researchId: cur.article.id,
      tone: directionLabel(cur.direction).tone,
      when: cur.article.publishedAt,
    });
  }
  if (ev.length === 0) return null;
  const cn = isCJK(q);
  return {
    intent: "WHO_CHANGED",
    title: cn ? `过去 ${days} 天改变观点的机构` : `Institutions that changed view in the last ${days}d`,
    summary: cn ? `发现 ${ev.length} 处观点变化。` : `${ev.length} view changes detected.`,
    rows: ev,
    usedLLM: false,
  };
}

async function consensusLevel(q: string, asset: ReturnType<typeof detectAsset>): Promise<Answer | null> {
  if (!asset) return null;
  const a = await assetRow(asset.ticker);
  if (!a) return null;
  const c = await computeConsensus(a.id);
  if (!c) return null;
  const ev: EvidenceRow[] = c.contributors.slice(0, 12).map((x) => ({
    institution: x.institutionName,
    slug: x.slug,
    text: `${directionLabel(x.direction).label}${x.target ? ` · target $${x.target.toLocaleString()}` : ""}`,
    sourceUrl: "",
    researchId: "",
    tone: directionLabel(x.direction).tone,
    when: x.publishedAt,
  }));
  const cn = isCJK(q);
  return {
    intent: "CONSENSUS_LEVEL",
    title: cn ? `${asset.name} 机构共识` : `${asset.name} institutional consensus`,
    summary: cn
      ? `${asset.name} 当前共识 ${c.score}/100（${c.label}），基于 ${c.institutionCount} 家机构：${c.bullishCount} 看多 / ${c.neutralCount} 中性 / ${c.bearishCount} 看空。`
      : `${asset.name} consensus is ${c.score}/100 (${c.label}) across ${c.institutionCount} institutions: ${c.bullishCount} bull / ${c.neutralCount} neutral / ${c.bearishCount} bear.`,
    rows: ev,
    usedLLM: false,
    assetTicker: asset.ticker,
  };
}

async function keywordFallback(q: string, days: number): Promise<Answer> {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 5);
  const arts = await prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    take: 40,
    include: { institution: true, analysis: true, articleAssets: { include: { asset: true } } },
  });
  const scored = arts
    .map((a) => {
      const hay = `${a.title} ${a.analysis?.summary ?? ""}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 12);
  const cn = isCJK(q);
  const ev: EvidenceRow[] = scored.map(({ a }) => ({
    institution: a.institution.name,
    slug: a.institution.slug,
    text: a.title,
    detail: a.articleAssets.map((x) => x.asset.ticker).join(" · "),
    sourceUrl: a.sourceUrl,
    researchId: a.id,
    when: a.publishedAt,
  }));
  return {
    intent: "KEYWORD",
    title: cn ? `与「${q}」相关的机构观点` : `Institutional views matching “${q}”`,
    summary: ev.length
      ? (cn ? `找到 ${ev.length} 条相关观点。` : `Found ${ev.length} matching views.`)
      : (cn ? "站内暂无匹配的结构化观点。" : "No matching structured views yet."),
    rows: ev,
    usedLLM: false,
  };
}

// Optional LLM synthesis over the retrieved evidence (never a web search).
async function synthesize(query: string, base: Answer): Promise<Answer> {
  const provider = getLLMProvider();
  if (!provider || base.rows.length === 0) return base;
  const evidence = base.rows
    .map((r, i) => `[${i + 1}] ${r.institution}: ${r.text}${r.detail ? ` (${r.detail})` : ""}`)
    .join("\n");
  try {
    const result = await provider.complete({
      maxTokens: 400,
      system: "You summarize institutional views using ONLY the provided evidence lines. Never invent numbers or institutions. Cite with [n]. Answer in the user's language, 2-4 sentences.",
      user: `QUESTION: ${query}\n\nEVIDENCE:\n${evidence}`,
    });
    const txt = result.text.trim();
    if (txt) return { ...base, summary: txt, usedLLM: true };
  } catch { /* keep structured summary */ }
  return base;
}

export async function answerQuery(query: string): Promise<Answer> {
  const q = query.trim();
  if (!q) return { intent: "EMPTY", title: "", summary: "", rows: [], usedLLM: false };
  const days = detectWindow(q);
  const asset = detectAsset(q);
  const dir = detectDirection(q);

  const base =
    (await targetChanges(q, asset, days)) ||
    (await whyDirection(q, asset, dir, days)) ||
    (await whoChanged(q, days)) ||
    (await consensusLevel(q, asset)) ||
    (await keywordFallback(q, days));

  return synthesize(q, base);
}

export const EXAMPLE_QUERIES = [
  "最近30天哪些机构上调了黄金目标价？",
  "为什么机构开始看空原油？",
  "过去24小时谁改变了观点？",
  "黄金当前机构共识如何？",
  "Which institutions are bullish on Nvidia?",
];
