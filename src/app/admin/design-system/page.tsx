import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "设计系统" };

// The palette, in the order the stylesheet declares it: surfaces, text, line, accent,
// directional states. Both themes redefine the same names, so these swatches follow the
// viewer's active theme without the page knowing which one that is. `--warn` is referenced
// directly; the tokens are the contract, not the current hex values.
const COLOR_TOKENS = [
  "--bg", "--paper", "--panel", "--panel-2",
  "--ink", "--ink-2", "--muted", "--faint",
  "--border", "--accent", "--accent-wash",
  "--bull", "--bear", "--warn",
] as const;

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
          <span className="chip gray">{COLOR_TOKENS.length}</span>
        </div>
        <div className="macro-stats">
          {COLOR_TOKENS.map((token) => (
            <div className="macro-stat" key={token}>
              <div
                aria-hidden="true"
                style={{ height: 34, borderRadius: 7, border: "1px solid var(--border)", background: `var(${token})` }}
              />
              <span className="k">{token}</span>
            </div>
          ))}
        </div>
        <p className="sub">
          {tr(
            locale,
            "Every surface, line and status colour resolves through these variables; the dark theme redefines the same names, so components never hard-code a value.",
            "所有背景、描边与状态色都通过这些变量取值；深色主题只重定义同名变量，组件内不写死颜色值。",
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
        <div className="section-t"><span>{tr(locale, "Controls", "控件")}</span></div>
        <div className="tag-row" style={{ alignItems: "center" }}>
          <button className="minibtn" type="button">minibtn</button>
          <button className="minibtn p" type="button">minibtn p</button>
          <span className="chip">chip</span>
          <span className="chip acc">chip acc</span>
          <span className="chip bull">chip bull</span>
          <span className="chip bear">chip bear</span>
        </div>
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
