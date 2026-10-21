import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import PdfPreview from "@/app/_components/PdfPreview";
import { getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const SLUG = "food-wholesale-wechat-order-automation-7e2d490718";
// Localized on purpose: the middleware rewrites language-prefixed paths internally, while
// the bare path redirects (and in a local http run the redirect target is https). The
// reader should get the bytes, not a protocol error.
const PDF = `/zh/share/${SLUG}.pdf`;

export const metadata: Metadata = {
  title: { absolute: "食品批发微信自动接单与打单方案" },
  description: "一份关于食品批发客户微信群报货、AI 自动录单与针式打印机出单的内部方案。",
  robots: { index: false, follow: false, noarchive: true },
};

const POINTS = [
  "多群实时盯单，按“群—人—时间”归并补货、引用改价和分条发送的消息。",
  "AI 把客户口语简称对齐到进销存里的标准商品全称、规格和客户协议价。",
  "群内发送待确认清单，客户回复“确认”或“1”之后单据才生效。",
  "确认后自动写入进销存，并驱动针式打印机打出送货联单。",
  "程序可放在独立虚拟桌面或微型主机运行，不占用前台电脑；方案明确不使用微信外挂。",
];

const NUMBERS = [
  { label: "每日人工录单耗时", value: "4–5 小时 → 10 分钟" },
  { label: "确认方式", value: "回复“确认”或“1”" },
  { label: "目标错单率", value: "群内确认后打单" },
];

const RISKS = [
  "方案依赖微信客户端界面和消息格式；微信改版、风控或账号限制可能影响稳定性。",
  "商品简称、规格和客户协议价需要持续维护映射，新品与模糊报货仍需人工核对。",
  "自动录入和打印依赖进销存字段与打印模板的适配，异常单需要人工兜底。",
  "“零错单”是方案目标，不是已经验证的运营结果；正式使用前应小范围试运行。",
];

export default async function SharedProposalPage() {
  const locale = await getLocale();
  if (locale !== "zh-CN") permanentRedirect(`/zh/share/${SLUG}`);

  return (
    <main className="wrap share-page">
      <div className="share-banner">
        <span className="chip gray">仅链接可见</span>
        <span>未列入栏目、搜索或索引；持有本链接的人可阅读。</span>
      </div>

      <header className="art-head">
        <div className="eyebrow">内部审阅版 · 2026/10/21</div>
        <h1 className="art-title">食品批发微信自动接单与打单方案</h1>
        <p className="sub">
          这份内部方案把食品批发客户在微信群里的报货、确认、录入进销存和针式打印串成一条自动化流程：后台按群、人、时间归并消息，AI 将口语品名对齐标准商品与客户协议价，群内发待确认清单，客户回复“确认”或“1”后再自动录单打印。方案声称可把每天 4–5 小时的人工录单压缩到约 10 分钟，并用“先确认后打单”降低错单、漏单风险。
        </p>
      </header>

      <section className="blk share-brief" aria-label="方案摘要">
        <div className="share-grid">
          <div>
            <div className="section-t"><span>方案要点</span></div>
            <ol className="share-points">
              {POINTS.map((point) => <li key={point}>{point}</li>)}
            </ol>
          </div>
          <div>
            <div className="section-t"><span>关键数字</span></div>
            <div className="share-numbers">
              {NUMBERS.map((item) => (
                <div className="share-number" key={item.label}>
                  <b>{item.value}</b>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="blk" aria-label="风险与边界">
        <div className="section-t"><span>风险与边界</span></div>
        <ul className="share-risks">
          {RISKS.map((risk) => <li key={risk}>{risk}</li>)}
        </ul>
      </section>

      <section className="blk">
        <div className="section-t section-t-report">
          <a className="minibtn" href={PDF} download>下载 PDF</a>
          <span>方案原件</span>
        </div>
        <PdfPreview
          src={PDF}
          labels={{ loading: "正在载入文档……", failed: "该文档无法显示，请改用下载。" }}
        />
      </section>
    </main>
  );
}
