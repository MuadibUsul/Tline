import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { canonical, JsonLd, webPageJsonLd } from "@/lib/seo";

const PAGES = {
  about: { en: ["About Tlines", "Tlines turns public institutional research into comparable, traceable market intelligence. It preserves the original source while adding structured entities, asset links, consensus and change history."], zh: ["关于 Tlines", "Tlines 将公开机构研报转化为可比较、可追踪的市场情报，并保留原始来源，同时补充结构化实体、资产关系、共识和变化历史。"] },
  methodology: { en: ["Methodology", "Research is admitted only from public, source-verifiable pages. Tlines extracts asset, direction, target, horizon, conditions and source evidence, then aggregates consensus using disclosed authority weights and time decay. Missing evidence remains missing; it is never invented."], zh: ["方法论", "仅收录公开且可核验来源的研报。Tlines 提取资产、方向、目标、期限、条件与来源证据，再以公开说明的机构权重和时间衰减聚合共识。缺失证据保持缺失，绝不补造。"] },
  "editorial-policy": { en: ["Editorial Policy", "Original institutional authorship and wording are separated from Tlines summaries and automated analysis. Pages identify publication time, institution and official source. Material claims should be checked against that source."], zh: ["编辑政策", "原机构作者与原文措辞和 Tlines 摘要、自动分析明确分开。页面标明发布时间、机构和官网来源；重要判断应回到原始来源核验。"] },
  "ai-usage": { en: ["AI Usage", "AI may structure, translate and summarize source material. Outputs are quality-checked, labelled as automated and withheld from indexing when they fail the quality gate. AI output is not represented as the institution's own wording or investment advice."], zh: ["AI 使用说明", "AI 可用于结构化、翻译和总结来源材料。输出经过质量检查、明确标注为自动生成；未通过质量闸门时不开放索引。AI 输出不被表述为机构原话，也不构成投资建议。"] },
  sources: { en: ["Sources", "Every research record links to the institution's public page or document. Tlines respects source robots policies, does not bypass login or access controls, and keeps source attribution beside machine-citable conclusions."], zh: ["来源政策", "每条研报记录均链接到机构公开页面或文档。Tlines 遵守来源站 robots 规则，不绕过登录或访问控制，并让机器可引用结论始终伴随来源归属。"] },
  corrections: { en: ["Corrections", "Readers can report an error with the research URL, disputed text and official evidence. Until a dedicated form is available, contact the site operator through the deployment's published support channel. Corrections preserve the source and audit trail."], zh: ["纠错政策", "读者可提交研报网址、有争议文本和官方证据。专用表单上线前，请通过部署方公布的支持渠道联系站点运营者。纠错会保留来源和审计记录。"] },
} as const;

function page(slug: string, locale: Locale) { const item = PAGES[slug as keyof typeof PAGES]; return item ? (locale === "zh-CN" ? item.zh : item.en) : null; }

export async function generateMetadata({ params }: { params: Promise<{ policy: string }> }): Promise<Metadata> {
  const { policy } = await params; const locale = await getLocale(); const content = page(policy, locale); if (!content) return {};
  return { title: content[0], description: content[1].slice(0, 160), ...canonical(`/${policy}`, locale) };
}

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params; const locale = await getLocale(); const content = page(policy, locale); if (!content) notFound();
  return <main className="wrap policy-page"><JsonLd data={webPageJsonLd(locale, `/${policy}`, content[0], content[1])} /><div className="page-head"><div className="eyebrow">Tlines</div><h1>{content[0]}</h1></div><section className="card prose"><p>{content[1]}</p><p>{tr(locale, "Financial content is informational, may contain errors, and is not investment advice.", "金融内容仅供信息参考，可能存在错误，不构成投资建议。")}</p><Link className="minibtn" href={localePath(locale, "/research")}>{tr(locale, "Browse sourced research", "浏览有来源的研报")}</Link></section></main>;
}
