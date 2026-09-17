import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { canonical, clamp, JsonLd, localizedUrl, ogImage, webPageJsonLd } from "@/lib/seo";

const PAGES = {
  about: { en: ["About Tlines", "Tlines turns public institutional research into comparable, traceable market intelligence. It preserves the original source while adding structured entities, asset links, consensus and change history."], zh: ["关于 Tlines", "Tlines 将公开机构研报转化为可比较、可追踪的市场情报，并保留原始来源，同时补充结构化实体、资产关系、共识和变化历史。"] },
  methodology: { en: ["Methodology", "Research is admitted only from public, source-verifiable pages. Tlines extracts asset, direction, target, horizon, conditions and source evidence, then aggregates consensus using disclosed authority weights and time decay. Missing evidence remains missing; it is never invented."], zh: ["方法论", "仅收录公开且可核验来源的研报。Tlines 提取资产、方向、目标、期限、条件与来源证据，再以公开说明的机构权重和时间衰减聚合共识。缺失证据保持缺失，绝不补造。"] },
  "editorial-policy": { en: ["Editorial Policy", "Original institutional authorship and wording are separated from Tlines summaries and automated analysis. Pages identify publication time, institution and official source. Material claims should be checked against that source."], zh: ["编辑政策", "原机构作者与原文措辞和 Tlines 摘要、自动分析明确分开。页面标明发布时间、机构和官网来源；重要判断应回到原始来源核验。"] },
  "ai-usage": { en: ["AI Usage", "AI may structure, translate and summarize source material. Outputs are quality-checked, labelled as automated and withheld from indexing when they fail the quality gate. AI output is not represented as the institution's own wording or investment advice."], zh: ["AI 使用说明", "AI 可用于结构化、翻译和总结来源材料。输出经过质量检查、明确标注为自动生成；未通过质量闸门时不开放索引。AI 输出不被表述为机构原话，也不构成投资建议。"] },
  sources: { en: ["Sources", "Every research record links to the institution's public page or document. Tlines respects source robots policies, does not bypass login or access controls, and keeps source attribution beside machine-citable conclusions."], zh: ["来源政策", "每条研报记录均链接到机构公开页面或文档。Tlines 遵守来源站 robots 规则，不绕过登录或访问控制，并让机器可引用结论始终伴随来源归属。"] },
  privacy: { en: ["Privacy", "Tlines measures its own audience without a tracking cookie and without storing anyone's IP address. A visitor is counted as a one-way digest of a server-side secret, the calendar day, the requesting address and the browser string: the same reader counts once within a day and cannot be linked to their own next day. Page addresses are recorded without their query string, referrers without their path, and raw records are deleted after the retention window, leaving only daily totals. Signing in associates activity with the account for as long as the account exists."], zh: ["隐私说明", "Tlines 不使用跟踪 Cookie，也不保存任何访客的 IP 地址。访客身份是「服务端密钥 + 自然日 + 来访地址 + 浏览器标识」的单向摘要：同一读者在一天内只计一次，且无法与其次日的访问关联。页面地址不含查询串，来源仅保留域名，原始记录在保留期后删除，只留下按日汇总。登录后，访问活动会在账户存续期间与该账户关联。"] },
  corrections: { en: ["Corrections", "Readers can report an error with the research URL, disputed text and official evidence. Until a dedicated form is available, contact the site operator through the deployment's published support channel. Corrections preserve the source and audit trail."], zh: ["纠错政策", "读者可提交研报网址、有争议文本和官方证据。专用表单上线前，请通过部署方公布的支持渠道联系站点运营者。纠错会保留来源和审计记录。"] },
  "financial-disclaimer": { en: ["Financial Disclaimer", "Tlines provides informational summaries of public institutional research. Content may be delayed, incomplete or incorrect and is not investment, legal, tax or accounting advice. Verify material decisions against the linked official source and consult a qualified professional."], zh: ["金融免责声明", "Tlines 提供公开机构研究的信息性整理。内容可能延迟、不完整或存在错误，不构成投资、法律、税务或会计建议。重要决策应核对页面链接的官方来源，并咨询具备资质的专业人士。"] },
} as const;

type PolicySlug = keyof typeof PAGES;

/**
 * Where each policy is actually applied.
 *
 * A policy page that nothing links to is a footer page; these are the surfaces the rule
 * governs, so a reader arriving from a search result can see it in practice rather than only
 * as a statement.
 */
const APPLIES_TO: Record<PolicySlug, Array<{ path: string; en: string; zh: string }>> = {
  about: [
    { path: "/methodology", en: "How research is structured", zh: "研报如何结构化" },
    { path: "/sources", en: "Which sources are accepted", zh: "收录哪些来源" },
    { path: "/editorial-policy", en: "How authorship is separated", zh: "作者归属如何区分" },
  ],
  methodology: [
    { path: "/markets", en: "Consensus by asset", zh: "按资产查看共识" },
    { path: "/institutions", en: "Views ranked by heat", zh: "按热度排列的观点" },
    { path: "/institution/saxo/accuracy", en: "How a forecast record is settled", zh: "预测记录如何结算" },
    { path: "/topics", en: "Topics and their thresholds", zh: "主题与门槛" },
  ],
  "editorial-policy": [
    { path: "/research", en: "Reports labelled as structured, not quoted", zh: "标注为结构化而非原文的研报" },
    { path: "/institution/ing", en: "An institution page and its sources", zh: "机构页与来源" },
  ],
  "ai-usage": [
    { path: "/research", en: "Where AI output is labelled", zh: "AI 输出的标注位置" },
    { path: "/methodology", en: "What is extracted and what is withheld", zh: "提取与保留的边界" },
  ],
  sources: [
    { path: "/institutions", en: "The publishers being indexed", zh: "已收录的机构" },
    { path: "/corrections", en: "Dispute a source or a claim", zh: "对来源或主张提出异议" },
  ],
  privacy: [
    { path: "/about", en: "Who operates the site", zh: "站点运营方" },
  ],
  corrections: [
    { path: "/methodology", en: "The method being corrected against", zh: "更正所依据的方法" },
    { path: "/institution/saxo/accuracy", en: "Settled forecasts and their disputes", zh: "已结算预测与争议" },
  ],
  "financial-disclaimer": [
    { path: "/methodology", en: "What the summaries are", zh: "摘要的性质" },
    { path: "/sources", en: "Where the original text is", zh: "原文所在" },
  ],
};

function page(slug: string, locale: Locale) { const item = PAGES[slug as keyof typeof PAGES]; return item ? (locale === "zh-CN" ? item.zh : item.en) : null; }

export async function generateMetadata({ params }: { params: Promise<{ policy: string }> }): Promise<Metadata> {
  const { policy } = await params; const locale = await getLocale(); const content = page(policy, locale); if (!content) return {};
  const description = clamp(content[1], 158);
  return {
    title: content[0],
    description,
    ...canonical(`/${policy}`, locale),
    openGraph: { type: "website", title: content[0], description, url: localizedUrl(`/${policy}`, locale), locale, images: [{ url: ogImage("Policy", content[0]), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: content[0], description },
  };
}

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params; const locale = await getLocale(); const content = page(policy, locale); if (!content) notFound();
  const applies = APPLIES_TO[policy as PolicySlug] ?? [];
  return <main className="wrap policy-page">
    <JsonLd data={webPageJsonLd(locale, `/${policy}`, content[0], content[1])} />
    <div className="page-head"><div className="eyebrow">Tlines</div><h1>{content[0]}</h1></div>
    <section className="card prose"><p>{content[1]}</p><p>{tr(locale, "Financial content is informational, may contain errors, and is not investment advice.", "金融内容仅供信息参考，可能存在错误，不构成投资建议。")}</p></section>
    {applies.length > 0 && <section className="card prose">
      <h2>{tr(locale, "Where this applies", "这条规则体现在哪里")}</h2>
      <ul>{applies.map((item) => <li key={item.path}><Link href={localePath(locale, item.path)}>{locale === "zh-CN" ? item.zh : item.en}</Link></li>)}</ul>
    </section>}
    <section className="card prose">
      <h2>{tr(locale, "Other policies", "其他政策")}</h2>
      <ul>{(Object.keys(PAGES) as PolicySlug[]).filter((slug) => slug !== policy).map((slug) => (
        <li key={slug}><Link href={localePath(locale, `/${slug}`)}>{locale === "zh-CN" ? PAGES[slug].zh[0] : PAGES[slug].en[0]}</Link></li>
      ))}</ul>
    </section>
    <Link className="minibtn" href={localePath(locale, "/research")}>{tr(locale, "Browse sourced research", "浏览有来源的研报")}</Link>
  </main>;
}
