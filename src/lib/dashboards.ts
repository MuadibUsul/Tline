export type DashboardWidgetType = "market" | "macro" | "research" | "note" | "source";
export type DashboardResearchScope = "asset" | "institution" | "topic";

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string;
  ref?: string;
  scopeKind?: DashboardResearchScope;
  text?: string;
  url?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardTemplate {
  key: string;
  nameEn: string;
  nameZh: string;
  descriptionEn: string;
  descriptionZh: string;
  wallpaper: string;
  accent: string;
  widgets: DashboardWidget[];
}

const widget = (
  id: string,
  type: DashboardWidgetType,
  title: string,
  ref: string | undefined,
  x: number,
  y: number,
  extra: Partial<DashboardWidget> = {},
): DashboardWidget => ({ id, type, title, ref, x, y, w: 360, h: 235, ...extra });

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "fed",
    nameEn: "Federal Reserve",
    nameZh: "美联储监控",
    descriptionEn: "Policy range, Treasury yields and the latest Fed research.",
    descriptionZh: "政策利率区间、美债收益率与最新美联储研报。",
    wallpaper: "grid",
    accent: "#b9894d",
    widgets: [
      widget("fed-upper", "macro", "Fed funds upper bound", "US_FED_FUNDS_TARGET_UPPER", 60, 60),
      widget("fed-2y", "macro", "U.S. 2Y yield", "US_2Y_TREASURY_YIELD", 450, 60),
      widget("fed-10y", "macro", "U.S. 10Y yield", "US_10Y_TREASURY_YIELD", 840, 60),
      widget("fed-research", "research", "Federal Reserve research", "federal-reserve", 60, 330, { scopeKind: "institution", w: 750, h: 310 }),
      widget("fed-note", "note", "Desk notes", undefined, 840, 330, { text: "Record the conditions that would change your policy-rate view.", h: 310 }),
    ],
  },
  {
    key: "inflation",
    nameEn: "Inflation",
    nameZh: "通胀监控",
    descriptionEn: "Headline, core and PCE inflation with energy and research context.",
    descriptionZh: "总体、核心与 PCE 通胀，并联动能源和相关研报。",
    wallpaper: "paper",
    accent: "#a16d3d",
    widgets: [
      widget("inf-cpi", "macro", "Headline CPI", "US_CPI_HEADLINE", 60, 60),
      widget("inf-core", "macro", "Core CPI", "US_CPI_CORE", 450, 60),
      widget("inf-pce", "macro", "Core PCE", "US_CORE_PCE_PRICE", 840, 60),
      widget("inf-oil", "macro", "WTI spot", "US_WTI_SPOT", 60, 330),
      widget("inf-research", "research", "Inflation research", "inflation", 450, 330, { scopeKind: "topic", w: 750, h: 310 }),
    ],
  },
  {
    key: "employment",
    nameEn: "Employment",
    nameZh: "就业监控",
    descriptionEn: "Payrolls, unemployment, openings and labour-market research.",
    descriptionZh: "非农、失业率、职位空缺与劳动力市场研报。",
    wallpaper: "blueprint",
    accent: "#587b8f",
    widgets: [
      widget("jobs-nfp", "macro", "Nonfarm payrolls", "US_NFP", 60, 60),
      widget("jobs-unemployment", "macro", "Unemployment rate", "US_UNEMPLOYMENT_RATE", 450, 60),
      widget("jobs-jolts", "macro", "JOLTS openings", "US_JOLTS_OPENINGS", 840, 60),
      widget("jobs-research", "research", "Employment research", "employment", 60, 330, { scopeKind: "topic", w: 750, h: 310 }),
      widget("jobs-note", "note", "Reaction checklist", undefined, 840, 330, { text: "Track revisions, participation and wage pressure alongside the headline print.", h: 310 }),
    ],
  },
  {
    key: "oil",
    nameEn: "Crude Oil",
    nameZh: "原油监控",
    descriptionEn: "WTI, U.S. inventories, energy research and a working thesis.",
    descriptionZh: "WTI、美国原油库存、能源研报与交易假设。",
    wallpaper: "carbon",
    accent: "#927340",
    widgets: [
      widget("oil-wti", "macro", "WTI spot", "US_WTI_SPOT", 60, 60, { w: 500, h: 280 }),
      widget("oil-stocks", "macro", "U.S. crude inventories", "US_EIA_CRUDE_INVENTORIES", 590, 60, { w: 500, h: 280 }),
      widget("oil-research", "research", "Crude oil research", "WTI", 60, 375, { scopeKind: "asset", w: 750, h: 310 }),
      widget("oil-note", "note", "Supply-risk notes", undefined, 840, 375, { text: "Add OPEC+, shipping and geopolitical assumptions here.", h: 310 }),
    ],
  },
  {
    key: "boj",
    nameEn: "Bank of Japan",
    nameZh: "日本央行监控",
    descriptionEn: "BOJ rates, yen, Japanese activity and policy research.",
    descriptionZh: "日本央行利率、日元、日本经济活动与政策研报。",
    wallpaper: "dawn",
    accent: "#a65b5b",
    widgets: [
      widget("boj-rate", "macro", "Japan overnight rate", "JP_CALL_RATE", 60, 60),
      widget("boj-yen", "market", "USD/JPY", "USDJPY", 450, 60),
      widget("boj-gdp", "macro", "Japan GDP", "JP_GDP", 840, 60),
      widget("boj-research", "research", "Bank of Japan research", "bank-of-japan", 60, 330, { scopeKind: "institution", w: 750, h: 310 }),
      widget("boj-note", "note", "Normalization watch", undefined, 840, 330, { text: "Track wages, services inflation and communication around the next hike.", h: 310 }),
    ],
  },
  {
    key: "boe",
    nameEn: "Bank of England",
    nameZh: "英国央行监控",
    descriptionEn: "UK rates, sterling, growth, employment and Bank of England research.",
    descriptionZh: "英国利率、英镑、经济增长、就业与英国央行研报。",
    wallpaper: "blueprint",
    accent: "#6f87a8",
    widgets: [
      widget("boe-rate", "macro", "UK overnight rate", "UK_CALL_RATE", 60, 60),
      widget("boe-pound", "market", "GBP/USD", "GBPUSD", 450, 60),
      widget("boe-gdp", "macro", "UK GDP", "UK_GDP", 840, 60),
      widget("boe-jobs", "macro", "UK unemployment", "UK_UNEMPLOYMENT", 60, 330),
      widget("boe-research", "research", "Bank of England research", "bank-of-england", 450, 330, { scopeKind: "institution", w: 750, h: 310 }),
    ],
  },
  {
    key: "gold",
    nameEn: "Gold",
    nameZh: "黄金监控",
    descriptionEn: "Gold price, ETF flows, yields, policy rates and inflation.",
    descriptionZh: "金价、黄金 ETF 流向、美债收益率、政策利率与通胀。",
    wallpaper: "midnight",
    accent: "#d0a24c",
    widgets: [
      widget("gold-price", "market", "Gold · XAU/USD", "XAUUSD", 60, 60, { w: 500, h: 280 }),
      widget("gold-etf", "source", "Gold ETF holdings & flows", undefined, 590, 60, { url: "https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows", text: "World Gold Council · weekly and monthly holdings and fund flows", w: 500, h: 280 }),
      widget("gold-10y", "macro", "U.S. 10Y yield", "US_10Y_TREASURY_YIELD", 60, 375),
      widget("gold-fed", "macro", "Fed funds upper bound", "US_FED_FUNDS_TARGET_UPPER", 450, 375),
      widget("gold-cpi", "macro", "U.S. headline CPI", "US_CPI_HEADLINE", 840, 375),
      widget("gold-research", "research", "Gold research", "XAUUSD", 60, 645, { scopeKind: "asset", w: 750, h: 310 }),
      widget("gold-note", "note", "Gold thesis", undefined, 840, 645, { text: "Connect real yields, the dollar, ETF demand and risk-off flows.", h: 310 }),
    ],
  },
];

export const DASHBOARD_WALLPAPERS = ["grid", "paper", "blueprint", "carbon", "dawn", "midnight"] as const;

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const number = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

export function parseDashboardWidgets(value: string): DashboardWidget[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.slice(0, 40).flatMap((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as Record<string, unknown>;
      const type = text(row.type, 20) as DashboardWidgetType;
      if (!["market", "macro", "research", "note", "source"].includes(type)) return [];
      const rawId = text(row.id, 64).replace(/[^a-zA-Z0-9_-]/g, "");
      const id = rawId && !ids.has(rawId) ? rawId : `widget-${index + 1}`;
      ids.add(id);
      const scopeKind = text(row.scopeKind, 20) as DashboardResearchScope;
      const url = text(row.url, 500);
      return [{
        id,
        type,
        title: text(row.title, 100) || type,
        ref: text(row.ref, 100) || undefined,
        scopeKind: ["asset", "institution", "topic"].includes(scopeKind) ? scopeKind : undefined,
        text: text(row.text, 1000) || undefined,
        url: /^https:\/\//i.test(url) ? url : undefined,
        x: number(row.x, 40, -8000, 8000),
        y: number(row.y, 40, -8000, 8000),
        w: number(row.w, 360, 280, 1200),
        h: number(row.h, 235, 180, 900),
      }];
    });
  } catch {
    return [];
  }
}

export const dashboardTemplate = (key: string | null | undefined) => DASHBOARD_TEMPLATES.find((item) => item.key === key) ?? null;

export function validWallpaperUrl(value: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString().slice(0, 500) : null; } catch { return null; }
}

export function validAccent(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#9e7a42";
}

/** Grid snap first, then prefer nearby card edges/centres so layouts line up naturally. */
export function snapDashboardPosition(moving: Pick<DashboardWidget, "id" | "x" | "y" | "w" | "h">, others: DashboardWidget[], threshold = 8) {
  let x = Math.round(moving.x / 12) * 12;
  let y = Math.round(moving.y / 12) * 12;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestX = threshold + 1;
  let bestY = threshold + 1;
  for (const other of others) {
    if (other.id === moving.id) continue;
    for (const target of [other.x, other.x + other.w / 2, other.x + other.w]) {
      for (const offset of [0, moving.w / 2, moving.w]) {
        const delta = target - (moving.x + offset);
        if (Math.abs(delta) < bestX && Math.abs(delta) <= threshold) { bestX = Math.abs(delta); x = Math.round(moving.x + delta); guideX = target; }
      }
    }
    for (const target of [other.y, other.y + other.h / 2, other.y + other.h]) {
      for (const offset of [0, moving.h / 2, moving.h]) {
        const delta = target - (moving.y + offset);
        if (Math.abs(delta) < bestY && Math.abs(delta) <= threshold) { bestY = Math.abs(delta); y = Math.round(moving.y + delta); guideY = target; }
      }
    }
  }
  return { x, y, guideX, guideY };
}
