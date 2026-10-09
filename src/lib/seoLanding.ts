import type { Locale } from "./i18n";
import { assetSeoTitle, clamp, institutionSeoTitle } from "./seo";

export interface SeoLandingProfile {
  title: string;
  h1: string;
  description: string;
}

type AssetCopy = { titleEn: string; titleZh: string; subjectEn: string; subjectZh: string };

/**
 * Only entities with a real canonical page and corpus coverage get query-specific copy.
 * A year is deliberately absent: it belongs in metadata only after the stored evidence has
 * a supported horizon, not because a keyword candidate happens to contain one.
 */
const ASSET_COPY: Record<string, AssetCopy> = {
  XAUUSD: {
    titleEn: "Gold Price Forecasts by Banks | Targets & Outlook",
    titleZh: "黄金价格预测：机构目标与观点对比",
    subjectEn: "Gold price forecasts",
    subjectZh: "黄金价格预测",
  },
  WTI: {
    titleEn: "WTI Crude Oil Forecasts | Bank Targets & Outlook",
    titleZh: "WTI原油价格预测：机构目标与观点对比",
    subjectEn: "WTI crude oil forecasts",
    subjectZh: "WTI原油价格预测",
  },
  EURUSD: {
    titleEn: "EUR/USD Bank Forecasts | Targets & Outlook",
    titleZh: "欧元兑美元预测：机构目标与观点对比",
    subjectEn: "EUR/USD forecasts",
    subjectZh: "欧元兑美元预测",
  },
  US10Y: {
    titleEn: "US 10-Year Treasury Yield Forecasts | Bank Outlook",
    titleZh: "美国10年期国债收益率预测：机构观点与变化",
    subjectEn: "US 10-year Treasury yield forecasts",
    subjectZh: "美国10年期国债收益率预测",
  },
  DXY: {
    titleEn: "US Dollar Index (DXY) Outlook | Institutional Views",
    titleZh: "美元指数DXY展望：机构观点与变化",
    subjectEn: "US Dollar Index (DXY) outlook",
    subjectZh: "美元指数DXY展望",
  },
  NDX: {
    titleEn: "Technology Stock Outlook | Nasdaq-100 Institutional Views",
    titleZh: "科技股前景：纳斯达克100机构观点",
    subjectEn: "Technology stock and Nasdaq-100 outlook",
    subjectZh: "科技股与纳斯达克100前景",
  },
};

export function assetSeoProfile(ticker: string, name: string, locale: Locale, institutionCount: number, reportCount: number): SeoLandingProfile {
  const copy = ASSET_COPY[ticker.toUpperCase()];
  if (!copy) return {
    title: assetSeoTitle(name, locale, ticker),
    h1: locale === "zh-CN" ? `${name}：机构正在预测什么` : `${name} — what institutions are forecasting`,
    description: locale === "zh-CN"
      ? `${name}（${ticker}）的机构公开研报与近期观点。`
      : `Source-linked institutional research and recent views on ${name} (${ticker}).`,
  };
  const subject = locale === "zh-CN" ? copy.subjectZh : copy.subjectEn;
  const title = locale === "zh-CN" ? copy.titleZh : copy.titleEn;
  const h1 = locale === "zh-CN"
    ? `${subject}：${institutionCount}家机构的可溯源观点`
    : `${subject}: source-linked views from ${institutionCount} institutions`;
  const description = locale === "zh-CN"
    ? `比较${institutionCount}家机构在${reportCount}篇公开研报中的${subject}、发布日期、明确给出的目标与观点变化，并核对原始来源。`
    : `Compare ${subject.toLocaleLowerCase()} across ${institutionCount} institutions and ${reportCount} public reports, with publication dates, stated targets, view changes and original sources.`;
  return { title: clamp(title, 60), h1, description: clamp(description, 158) };
}

type InstitutionCopy = { titleEn: string; titleZh: string; subjectEn: string; subjectZh: string };
const INSTITUTION_COPY: Record<string, InstitutionCopy> = {
  westpac: {
    titleEn: "Westpac IQ Economic Outlook & Rate Forecasts",
    titleZh: "西太平洋银行研究：经济展望与利率观点",
    subjectEn: "Westpac IQ economic outlook and rate views",
    subjectZh: "西太平洋银行经济展望与利率观点",
  },
  saxo: {
    titleEn: "Saxo Bank Research | Market Outlook & Asset Views",
    titleZh: "盛宝银行研究：市场展望与资产观点",
    subjectEn: "Saxo Bank research and market outlook",
    subjectZh: "盛宝银行研究与市场展望",
  },
  "wellington-management": {
    titleEn: "Wellington Management Market Outlook & Research",
    titleZh: "惠灵顿管理市场展望与公开研究",
    subjectEn: "Wellington Management market outlook",
    subjectZh: "惠灵顿管理市场展望",
  },
};

export function institutionSeoProfile(slug: string, name: string, locale: Locale, reportCount: number): SeoLandingProfile {
  const copy = INSTITUTION_COPY[slug];
  const subject = copy ? (locale === "zh-CN" ? copy.subjectZh : copy.subjectEn) : name;
  const title = copy ? (locale === "zh-CN" ? copy.titleZh : copy.titleEn) : institutionSeoTitle(name, locale);
  const h1 = locale === "zh-CN"
    ? `${subject}：${reportCount}篇可溯源公开研报`
    : `${subject}: ${reportCount} source-linked public ${reportCount === 1 ? "report" : "reports"}`;
  const description = locale === "zh-CN"
    ? `${reportCount === 1 ? "查看" : "比较"}${reportCount}篇${name}公开研报，包含发布日期、实际提取到的资产观点、明确给出的目标以及原始出处。`
    : `${reportCount === 1 ? "Read" : "Compare"} ${reportCount} public ${name} ${reportCount === 1 ? "report" : "reports"}, with publication dates, extracted asset views, stated targets and original sources.`;
  return { title: clamp(title, 60), h1, description: clamp(description, 158) };
}

export function subjectInstitutionSeoProfile(slug: string, name: string, locale: Locale, reportCount: number, publisherCount: number): SeoLandingProfile {
  if (slug !== "federal-reserve") return {
    title: locale === "zh-CN" ? `${name}政策与相关研报` : `${name} policy and related research`,
    h1: name,
    description: locale === "zh-CN"
      ? `以${name}为内容主体的政策文件与研报，并与研报发布机构明确区分。`
      : `Policy documents and research whose subject is ${name}, kept distinct from each report publisher.`,
  };
  return {
    title: locale === "zh-CN" ? "美联储利率路径：机构观点与政策展望" : "Federal Reserve Rate Path | Institutional Outlook",
    h1: locale === "zh-CN" ? `美联储利率路径：${publisherCount}家机构的观点` : `Federal Reserve rate path: views from ${publisherCount} institutions`,
    description: clamp(locale === "zh-CN"
      ? `汇总${publisherCount}家发布机构的${reportCount}篇可溯源研报，比较其对美联储政策与利率路径的观点；官方决定与第三方预测分开标示。`
      : `Review ${reportCount} source-linked reports from ${publisherCount} publishers on Federal Reserve policy and the rate path, with official decisions kept distinct from third-party forecasts.`, 158),
  };
}
