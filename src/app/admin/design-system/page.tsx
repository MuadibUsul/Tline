import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "设计系统" };

// The contract, in the order the stylesheet declares it. The first groups are the
// design-system tokens; the final group is the legacy API that existing pages still use.
// Both themes redefine the same semantic names, so these swatches follow the viewer's
// active theme without the page knowing which one that is.
const COLOR_GROUPS = [
  {
    label: "Primitive · neutral / indigo",
    tokens: ["--neutral-0", "--neutral-2", "--neutral-4", "--neutral-6", "--neutral-8", "--neutral-9", "--indigo-2", "--indigo-9", "--indigo-10"],
  },
  {
    label: "Semantic · surfaces / text / line",
    tokens: ["--surface-canvas", "--surface-page", "--surface-subtle", "--surface-selected", "--text-primary", "--text-secondary", "--text-muted", "--text-tertiary", "--border-subtle", "--border-control"],
  },
  {
    label: "Semantic · action / focus / status",
    tokens: ["--action-primary-bg", "--action-primary-fg", "--focus-ring", "--status-positive", "--status-negative", "--status-warning", "--status-gold"],
  },
  {
    label: "Legacy aliases",
    tokens: ["--bg", "--paper", "--panel", "--panel-2", "--ink", "--ink-2", "--muted", "--faint", "--border", "--accent", "--accent-wash", "--bull", "--bear", "--warn"],
  },
] as const;
const COLOR_TOKEN_COUNT = COLOR_GROUPS.reduce((total, group) => total + group.tokens.length, 0);

/**
 * The console's own reference sheet: the variables, typefaces and controls every page is
 * assembled from, rendered exactly as they ship. It exists so a class can be checked
 * against its look — and its look against its neighbours — without reading the stylesheet
 * or hunting for a page that happens to use it.
 */
export default async function DesignSystemPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.api")) notFound();
  const locale = await getAdminLocale();

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Design system", "设计系统")}</h1>
          <p className="sub">
            {tr(
              locale,
              "Internal reference: the colour variables, typefaces and controls the site is assembled from, rendered as they ship. Samples are labelled with their class names.",
              "内部参照页：站点所用的颜色变量、字体与控件的实际渲染效果，样例文本即对应的类名。",
            )}
          </p>
        </div>
      </header>

      <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "Colour tokens", "颜色 token")}</span>
          <span className="chip gray">{COLOR_TOKEN_COUNT}</span>
        </div>
        {COLOR_GROUPS.map((group) => (
          <div key={group.label} className="mt-18">
            <div className="section-t">
              <span>{group.label}</span>
              <span className="chip gray">{group.tokens.length}</span>
            </div>
            <div className="macro-stats">
              {group.tokens.map((token) => (
                <div className="macro-stat" key={token}>
                  <div
                    aria-hidden="true"
                    style={{ height: 34, borderRadius: 7, border: "1px solid var(--border)", background: `var(${token})` }}
                  />
                  <span className="k">{token}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="sub">
          {tr(
            locale,
            "Components ask for a semantic name such as border-control or action-primary-fg; primitives hold the values and the legacy aliases keep older classes working. Text is checked at 4.5:1, control borders and the focus ring at 3:1.",
            "组件使用 border-control、action-primary-fg 等语义名；基础变量保存色值，旧别名保证既有类继续工作。正文按 4.5:1 校验，控件边界与焦点环按 3:1 校验。",
          )}
        </p>
      </section>

      <section className="blk">
        <div className="section-t"><span>{tr(locale, "Typefaces", "字体")}</span></div>
        <p className="font-display" style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.01em" }}>
          Global Macro Weekly 全球宏观周报
        </p>
        <p>
          Report bodies and interface copy set in the system sans stack, so each script renders in the reader&rsquo;s own fonts at no network cost.
          正文与界面文案使用系统无衬线字体，中英文各自使用本机字形，不加载网络字体。
        </p>
        <p className="mono">123,456.78 · +2.43% · 4.6% · 09/03 20:30 UTC</p>
        <p className="sub">
          {tr(
            locale,
            "font-display sets the display serif used for Latin titles; body copy is the system sans; mono carries figures, periods and code, with tabular numerals wherever columns must align.",
            "font-display 用于拉丁文标题的展示衬线体；正文使用系统无衬线字体；mono 用于数字、期次与代码，列对齐处配合等宽数字。",
          )}
        </p>
      </section>

      <section className="blk">
        <div className="section-t"><span>{tr(locale, "Type, space and radius roles", "字号、间距与圆角角色")}</span></div>
        <div className="tag-row" style={{ alignItems: "center" }}>
          {["--text-h1", "--text-h2", "--text-h3", "--text-body", "--text-body-sm", "--text-meta", "--text-micro"].map((token) => (
            <span className="chip gray" key={token}>{token}</span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14, marginTop: 14 }}>
          {["--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8", "--space-12", "--space-16"].map((token) => (
            <div key={token}>
              <div aria-hidden="true" style={{ width: `var(${token})`, height: 14, background: "var(--accent)", borderRadius: 2 }} />
              <span className="k mono text-micro">{token}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
          {["--radius-control", "--radius-chip", "--radius-card", "--radius-dialog", "--radius-pill"].map((token) => (
            <div key={token} style={{ width: 96 }}>
              <div aria-hidden="true" style={{ height: 44, border: "1px solid var(--border-control)", borderRadius: `var(${token})`, background: "var(--panel-2)" }} />
              <span className="k mono text-micro">{token}</span>
            </div>
          ))}
        </div>
        <p className="sub">
          {tr(
            locale,
            "Type is a role, not a page-specific size. Spacing follows 4px steps; radius is limited to control, chip, card, dialog and pill. Motion uses 120/180/280ms and yields to prefers-reduced-motion.",
            "字号按角色取值，而不是每页临时决定；间距按 4px 步进；圆角只保留控件、chip、卡片、对话框和胶囊五种；动效使用 120/180/280ms，并遵守 prefers-reduced-motion。",
          )}
        </p>
      </section>

      <section className="blk">
        <div className="section-t"><span>{tr(locale, "Controls", "控件")}</span></div>
        <div className="tag-row" style={{ alignItems: "center" }}>
          <button className="minibtn" type="button">minibtn</button>
          <button className="minibtn p" type="button">minibtn p</button>
          <button className="minibtn" type="button" disabled>disabled</button>
          <span className="chip">chip</span>
          <span className="chip acc">chip acc</span>
          <span className="chip bull">chip bull</span>
          <span className="chip bear">chip bear</span>
        </div>
        <p className="sub mt-12">
          {tr(
            locale,
            "Primary buttons use action-primary-fg, which is dark ink on the lighter dark-theme indigo. Inputs use border-control for a 3:1 boundary; keyboard focus always draws a solid 2px focus ring.",
            "主按钮使用 action-primary-fg，深色主题下为亮靛蓝上的深墨字。输入框使用 border-control 保证 3:1 边界；键盘焦点始终绘制 2px 实色焦点环。",
          )}
        </p>
        <div className="empty-state">
          {tr(locale, "empty-state — a list that has nothing to show yet.", "empty-state · 列表暂无内容时的占位。")}
        </div>
        <div aria-hidden="true" className="skeleton" style={{ height: 14, marginTop: 14, width: "66%" }} />
        <p className="sub">
          {tr(
            locale,
            "minibtn is a secondary action, minibtn p the committed one; chips mark state (acc for editorial emphasis, bull/bear for direction); empty-state stands in for an empty list; skeleton holds a loading row's place.",
            "minibtn 为次级操作，minibtn p 为主操作；chip 用于状态标注（acc 强调、bull/bear 方向）；empty-state 用于空列表占位；skeleton 用于加载中的占位行。",
          )}
        </p>
      </section>
    </>
  );
}
