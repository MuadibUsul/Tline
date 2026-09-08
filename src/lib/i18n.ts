import { cookies, headers } from "next/headers";

export type Locale = "en" | "zh-CN";
export const LOCALE_COOKIE = "tline_locale";

export function resolveLocale(cookie?: string, acceptLanguage?: string | null): Locale {
  if (cookie === "en" || cookie === "zh-CN") return cookie;
  return /^zh\b/i.test(acceptLanguage?.trim() ?? "") ? "zh-CN" : "en";
}

export const LOCALES: Locale[] = ["en", "zh-CN"];
/** How each locale is written in a URL: /en/research, /zh/research. */
export const LOCALE_SEGMENT: Record<Locale, string> = { en: "en", "zh-CN": "zh" };

/** The locale a path names, or null when it names none. */
export function localeFromPath(pathname: string): Locale | null {
  const segment = pathname.split("/")[1];
  if (segment === "zh") return "zh-CN";
  if (segment === "en") return "en";
  return null;
}

/** A path with any language prefix removed, for comparing against a route. */
export function stripLocale(pathname: string): string {
  if (!localeFromPath(pathname)) return pathname;
  const rest = pathname.split("/").slice(2).join("/");
  return rest ? "/" + rest : "/";
}

/** The same page under a given locale, with any prefix already there replaced. */
export function localePath(locale: Locale, path: string): string {
  if (!path.startsWith("/")) return path;
  if (/^\/(?:api|_next)(?:\/|$)/.test(path)) return path;
  const bare = localeFromPath(path) ? `/${path.split("/").slice(2).join("/")}` : path;
  const suffix = bare === "/" ? "" : bare.replace(/\/$/, "");
  return `/${LOCALE_SEGMENT[locale]}${suffix}`;
}

/**
 * The locale for this request, taken from the address.
 *
 * It used to come from a cookie, so one address served either language depending on who
 * asked — which meant a search engine could only ever index one of them, and every
 * Chinese translation was out of reach of search entirely. The path decides now; the
 * cookie is consulted only to choose where an address without a prefix should go.
 */
export async function getLocale(): Promise<Locale> {
  return "en";
}

/** Retained for the machine-readable routes that still reason about the address. */
export async function getLocaleFromRequest(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const fromPath = localeFromPath(headerStore.get("x-pathname") ?? "");
  if (fromPath) return fromPath;
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
}

export function tr(locale: Locale, en: string, zh: string) {
  return locale === "zh-CN" ? zh : en;
}

const INSTITUTION_ZH: Record<string, string> = {
  "ING THINK": "荷兰国际集团智库",
  "Saxo Bank": "盛宝银行",
  "Scotiabank Economics": "加拿大丰业银行经济研究",
  "UBS CIO": "瑞银首席投资办公室",
  "UOB Research": "大华银行研究",
  "OCBC Research": "华侨银行研究",
  "DBS Insights / CIO": "星展银行研究与首席投资办公室",
  "RBC Economics": "加拿大皇家银行经济研究",
  "Charles Schwab": "嘉信理财",
  BlackRock: "贝莱德",
  "J.P. Morgan": "摩根大通",
  "Goldman Sachs": "高盛",
  "Morgan Stanley": "摩根士丹利",
  Pictet: "百达",
  "BMO Capital Markets": "蒙特利尔银行资本市场",
  "TD Economics / TD Securities": "道明经济研究与道明证券",
  "CIBC Capital Markets": "加拿大帝国商业银行资本市场",
  "Rabobank / RaboResearch": "荷兰合作银行研究",
  Schroders: "施罗德",
  Amundi: "东方汇理",
  "Franklin Templeton": "富兰克林邓普顿",
  Invesco: "景顺",
  "Fidelity International": "富达国际",
  PGIM: "PGIM保德信",
  PIMCO: "品浩",
  "Man Group / Man Institute": "英仕曼集团与英仕曼研究院",
  "ABN AMRO Research": "荷兰银行研究",
  SEB: "瑞典北欧斯安银行",
  Nordea: "北欧联合银行",
  "Danske Bank": "丹麦银行",
  "ANZ Research": "澳新银行研究",
  "Westpac / Westpac IQ": "西太平洋银行研究",
  "NAB Markets": "澳大利亚国民银行市场研究",
  "Commonwealth Bank": "澳大利亚联邦银行",
  MUFG: "三菱日联金融集团",
  HSBC: "汇丰",
  "BNP Paribas": "法国巴黎银行",
  "Standard Chartered": "渣打银行",
  Macquarie: "麦格理",
  Commerzbank: "德国商业银行",
  "State Street": "道富环球",
  "Julius Baer": "瑞士宝盛",
  AQR: "AQR资本管理",
  "Nomura Connects": "野村证券",
  "Neuberger Berman": "路博迈",
  "Wellington Management": "惠灵顿管理",
  Mizuho: "瑞穗",
  Barclays: "巴克莱",
  "Deutsche Bank": "德意志银行",
  "Société Générale": "法国兴业银行",
  "Crédit Agricole CIB": "法国东方汇理银行企业与投资银行",
  UniCredit: "意大利联合信贷银行",
  "Intesa Sanpaolo": "意大利联合圣保罗银行",
  Daiwa: "大和证券",
  SMBC: "三井住友银行",
  "Lloyds Bank": "劳埃德银行",
  Santander: "桑坦德银行",
  Apollo: "阿波罗全球管理",
  KKR: "KKR投资集团",
  Natixis: "法国外贸银行",
  Citi: "花旗",
  "Bank of America": "美国银行",
};

const ASSET_ZH: Record<string, string> = {
  XAUUSD: "黄金", XAGUSD: "白银", WTI: "WTI原油", NATGAS: "天然气", COPPER: "铜",
  BTC: "比特币", ETH: "以太坊", SPX: "标普500指数", NDX: "纳斯达克100指数",
  NVDA: "英伟达", AAPL: "苹果公司", SOX: "半导体", DXY: "美元指数",
  EURUSD: "欧元兑美元", USDJPY: "美元兑日元", GBPUSD: "英镑兑美元",
  US10Y: "美国10年期国债", US2Y: "美国2年期国债", FED: "美联储政策", CPI: "通胀",
};

const ASSET_NAME_ZH: Record<string, string> = {
  Gold: "黄金", Silver: "白银", "Crude Oil (WTI)": "WTI原油", "Natural Gas": "天然气", Copper: "铜",
  Bitcoin: "比特币", Ethereum: "以太坊", "S&P 500": "标普500指数", "Nasdaq 100": "纳斯达克100指数",
  NVIDIA: "英伟达", Apple: "苹果公司", Semiconductors: "半导体", "US Dollar (DXY)": "美元指数",
  "EUR/USD": "欧元兑美元", "USD/JPY": "美元兑日元", "GBP/USD": "英镑兑美元",
  "US 10Y Treasury": "美国10年期国债", "US 2Y Treasury": "美国2年期国债", "Fed Policy": "美联储政策", Inflation: "通胀",
};

const TERM_ZH: Record<string, string> = {
  equity: "股票", equities: "股票", rate: "利率", rates: "利率", fx: "外汇", commodity: "大宗商品",
  commodities: "大宗商品", crypto: "加密资产", macro: "宏观", bullish: "看多", bearish: "看空",
  neutral: "中性", conditional: "条件性", forecast: "预测", target: "目标", direction: "方向",
  risk: "风险", rationale: "逻辑", market_impact: "市场影响", short_term: "短期", medium_term: "中期",
  long_term: "长期", current: "当前", immediate: "即时", intraday: "日内", weekly: "每周", monthly: "每月",
  quarterly: "每季度", annual: "年度", "short-term": "短期", "medium-term": "中期", "long-term": "长期",
  fed: "美联储", usd: "美元", gold: "黄金", oil: "原油", treasuries: "美国国债", china: "中国", nvidia: "英伟达", "ai capex": "人工智能资本开支",
  "energy transition": "能源转型", "sustainable finance": "可持续金融", "monetary policy": "货币政策",
  inflation: "通胀", policy: "政策", regulation: "监管", market: "市场", earnings: "盈利",
};

const normalizeNameKey = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const INSTITUTION_ZH_NORMALIZED = new Map(Object.entries(INSTITUTION_ZH).map(([name, zh]) => [normalizeNameKey(name), zh]));

export function institutionName(name: string, locale: Locale) {
  return locale === "zh-CN" ? INSTITUTION_ZH[name] ?? INSTITUTION_ZH_NORMALIZED.get(normalizeNameKey(name)) ?? name : name;
}

export function assetName(name: string, locale: Locale, ticker?: string | null, zhFallback?: string) {
  if (locale === "en") return name;
  return (ticker ? ASSET_ZH[ticker.toUpperCase()] : undefined) ?? ASSET_NAME_ZH[name] ?? TERM_ZH[name.trim().toLocaleLowerCase()] ?? zhFallback ?? name;
}

export function domainTerm(value: string, locale: Locale, zhFallback?: string) {
  if (locale === "en") return value.replaceAll("_", " ");
  return TERM_ZH[value.trim().toLocaleLowerCase()] ?? zhFallback ?? value;
}

export function containsChinese(value: string | null | undefined) {
  return /\p{Script=Han}/u.test(value ?? "");
}

export function localeSafeText(value: string, locale: Locale, fallback: string) {
  return locale === "en" && containsChinese(value) ? fallback : value;
}

export function localizedDataValue(value: string | null | undefined, locale: Locale) {
  const clean = value?.trim();
  if (!clean) return null;
  if (locale === "en") return containsChinese(clean) ? null : clean;
  if (containsChinese(clean)) return clean;
  const tokens = clean.toLocaleLowerCase().match(/[a-z]+|\d+(?:\.\d+)?|[^a-z\d\s]+/g) ?? [];
  const allowed = new Set(["usd", "eur", "gbp", "jpy", "cny", "cad", "aud", "bp", "bps", "bn", "mn", "tn", "k", "m", "b", "t", "x"]);
  return tokens.every((token) => !/^[a-z]+$/.test(token) || allowed.has(token)) ? clean : null;
}

const CHINESE_CONTENT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Isabel Schnabel/gi, "伊莎贝尔·施纳贝尔"],
  [/Westpac Banking Corporation/gi, "西太平洋银行股份有限公司"],
  [/Westpac IQ/gi, "西太平洋银行研究平台"],
  [/Bank of Melbourne/gi, "墨尔本银行"],
  [/St George/gi, "圣乔治银行"],
  [/BankSA/gi, "南澳银行"],
  [/Westpac Group/gi, "西太平洋银行集团"],
  [/Westpac/gi, "西太平洋银行"],
  [/ING Think/gi, "荷兰国际集团智库"],
  [/\bdiscretionary\b/gi, "可选消费"],
];

export function localizeChineseContent(value: string) {
  return CHINESE_CONTENT_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function formatDate(value: Date | string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/**
 * Effective, minute-precise timestamp for an article: the publisher's own time when it
 * provided one (a non-midnight `publishedAt`); otherwise the crawler discovery time
 * (`createdAt`) carried onto the publication day, so the day stays correct while
 * same-day items differentiate down to the minute.
 */
export function articleTimestamp(publishedAt: Date | string, createdAt: Date | string): Date {
  const published = new Date(publishedAt);
  const dateOnly = published.getUTCHours() === 0 && published.getUTCMinutes() === 0 && published.getUTCSeconds() === 0 && published.getUTCMilliseconds() === 0;
  if (!dateOnly) return published;
  const discovered = new Date(createdAt);
  const composed = Date.UTC(published.getUTCFullYear(), published.getUTCMonth(), published.getUTCDate(), discovered.getUTCHours(), discovered.getUTCMinutes(), discovered.getUTCSeconds());
  // Never later than discovery: a date-only item can't read as newer than when we found it
  // (guards a post-dated publication discovered before its date from showing a future time).
  return new Date(Math.min(composed, discovered.getTime()));
}

export function relativeTime(value: Date | string, locale: Locale) {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 3600) return tr(locale, `${Math.max(1, Math.round(seconds / 60))}m`, `${Math.max(1, Math.round(seconds / 60))}分钟前`);
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds - hours * 3600) / 60);
    return minutes ? tr(locale, `${hours}h ${minutes}m`, `${hours}小时${minutes}分钟前`) : tr(locale, `${hours}h`, `${hours}小时前`);
  }
  return tr(locale, `${Math.round(seconds / 86400)}d`, `${Math.round(seconds / 86400)}天前`);
}
