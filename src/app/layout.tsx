import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeToggle from "./_components/ThemeToggle";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { doSignOut } from "./actions";
import { isFormalAuthConfigured } from "@/lib/auth-config";
import OAuthSignOutButton from "./_components/OAuthSignOutButton";
import MobileNav, { type MobileNavItem } from "./_components/MobileNav";
import SearchOverlay from "./_components/SearchOverlay";
import { TlinesMark } from "./_components/Icon";
import TopbarScroll from "./_components/TopbarScroll";
import NavigationProgress from "./_components/NavigationProgress";
import Analytics from "./_components/Analytics";
import CookieConsent from "./_components/CookieConsent";
import { classify } from "@/lib/analytics/agent";
import { recordBotHit } from "@/lib/analytics/botHits";
import { redesignAtLeast } from "@/lib/redesign";
import { getLocale, tr, localePath, stripLocale } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { brandName, localizedUrl, ogImage, TITLE_SUFFIX } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = brandName(locale);
  const description = tr(
    locale,
    "Institutional Research, Consensus & Market Signals",
    "机构研报、市场共识与资产信号",
  );
  return {
    metadataBase: new URL(siteUrl()),
    // The suffix is short on purpose: the full brand name costs 26 characters of every
    // composed title. Pages that own their full width pass `absolute` instead — see TITLE_SUFFIX.
    title: { default: title, template: `%s${TITLE_SUFFIX}` },
    description,
    // Search-engine ownership proofs are optional; the codes are deployment values, not
    // markup that should be guessed here.
    ...(process.env.GOOGLE_SITE_VERIFICATION || process.env.BING_SITE_VERIFICATION ? {
      verification: {
        ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
        ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
      },
    } : {}),
    applicationName: title,
    openGraph: { type: "website", siteName: title, title, description, locale, url: localizedUrl("/", locale), images: [{ url: ogImage("Institutional Intelligence", "Tlines Intelligence", "Research / Data / Signal"), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage("Institutional Intelligence", "Tlines Intelligence", "Research / Data / Signal")] },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const formalAuth = isFormalAuthConfigured();
  const requestHeaders = await headers();
  const requestedPath = requestHeaders.get("x-pathname") ?? "";
  const pathname = stripLocale(requestedPath);
  const locale = pathname.startsWith("/admin") ? "zh-CN" : await getLocale();

  /**
   * Crawlers and agents mostly do not run JavaScript, so the beacon never sees them. The
   * page render does. Record the HTML fetch after the response instead of blocking the
   * reader's paint; human renders do no database work here.
   */
  if (process.env.ANALYTICS_ENABLED !== "false") {
    const agent = classify(requestHeaders.get("user-agent"));
    const accept = requestHeaders.get("accept") ?? "";
    const acceptsHtml = !accept || accept.includes("text/html") || accept.includes("*/*");
    const isRsc = requestHeaders.get("rsc") === "1" || requestHeaders.get("next-router-prefetch") === "1";
    if (agent.trafficClass !== "human" && acceptsHtml && !isRsc && !pathname.startsWith("/admin")) {
      after(() => recordBotHit({
        path: requestedPath || "/",
        trafficClass: agent.trafficClass,
        agentName: agent.agentName,
        source: "server",
      }).catch(() => {}));
    }
  }

  // An account enrolled by email link has no password yet. Sending it straight to the
  // page that sets one is what keeps email down to enrolment and recovery: without this
  // the next sign-in would need another message.
  // Compared without its language prefix: the header carries the address as asked for,
  // so "/zh/account/password" would otherwise never match the page it redirects to.
  // An empty path means the middleware did not run; redirecting on that guess would
  // loop the page onto itself, so the gate stays shut rather than trapping the browser.
  if (pathname && user && formalAuth && !user.passwordHash && !pathname.startsWith("/account/password")) {
    redirect(localePath(locale, "/account/password"));
  }

  const redesign = redesignAtLeast("design-system");
  const navItems: MobileNavItem[] = (redesign
    ? [
        // The premium-media IA (PRD §3.1). The legacy tools keep their addresses and move
        // to the footer: same pages, same URLs, quieter placement — nothing was removed.
        { href: "/", label: tr(locale, "Home", "首页") },
        { href: "/news", label: tr(locale, "News", "新鲜事") },
        { href: "/research", label: tr(locale, "Latest research", "最新研究") },
        { href: "/categories", label: tr(locale, "Categories", "分类") },
        { href: "/macro", label: tr(locale, "Data & charts", "数据与图表") },
        { href: "/about", label: tr(locale, "About", "关于") },
      ]
    : [
        { href: "/", label: tr(locale, "Home", "首页") },
        { href: "/news", label: tr(locale, "News", "新鲜事") },
        { href: "/markets", label: tr(locale, "Markets", "资产") },
        { href: "/macro", label: tr(locale, "Economic Data", "经济数据") },
        { href: "/economies", label: tr(locale, "Economies", "经济体") },
        { href: "/institutions", label: tr(locale, "Views", "观点") },
        { href: "/research", label: tr(locale, "Research", "研报") },
        { href: "/watchlist", label: tr(locale, "Market Themes", "交易主线") },
        { href: "/dashboards", label: tr(locale, "Dashboards", "看板") },
        ...(can(user, "admin.access") ? [{ href: "/admin", label: tr(locale, "Operations", "运营") }] : []),
      ] as MobileNavItem[]).map((item) => ({ ...item, href: localePath(locale, item.href) }));

  const account = user && formalAuth ? (
    <div className="account-controls">
      <span className="mono account-email">{user.email}</span>
      <OAuthSignOutButton label={tr(locale, "Sign out", "退出")} />
    </div>
  ) : user ? (
    <form action={doSignOut} className="account-controls">
      <span className="mono account-email">{user.email}</span>
      <button type="submit" className="minibtn">{tr(locale, "Sign out", "退出")}</button>
    </form>
  ) : (
    <Link href={localePath(locale, "/signin")} className="minibtn">{tr(locale, "Sign in", "登录")}</Link>
  );
  const footerColumns: Array<{ title: string; links: Array<[string, string]> }> = [
    {
      title: tr(locale, "Product", "产品"),
      links: [
        ["research", tr(locale, "Latest research", "最新研究")],
        ["news", tr(locale, "News", "新鲜事")],
        ["categories", tr(locale, "Categories", "分类")],
        ["market-themes", tr(locale, "Market themes", "交易主线")],
      ],
    },
    {
      title: tr(locale, "Data", "数据"),
      links: [
        ["markets", tr(locale, "Markets", "资产")],
        ["macro", tr(locale, "Macro", "宏观")],
        ["macro/calendar", tr(locale, "Calendar", "经济日历")],
        ["institutions-directory", tr(locale, "Institutions", "机构目录")],
      ],
    },
    {
      title: tr(locale, "Company", "关于"),
      links: [
        ["about", tr(locale, "About", "关于")],
        ["methodology", tr(locale, "Methodology", "方法论")],
        ["editorial-policy", tr(locale, "Editorial policy", "编辑政策")],
        ["ai-usage", tr(locale, "AI usage", "AI 使用说明")],
      ],
    },
    {
      title: tr(locale, "Connect", "接入"),
      links: [
        ["mcp", tr(locale, "MCP for AI", "MCP 接入")],
        ["newsletter", tr(locale, "Newsletter", "订阅")],
        ...(user ? [["account/bookmarks", tr(locale, "Saved", "我的收藏")] as [string, string]] : []),
        ["sources", tr(locale, "Sources", "来源说明")],
      ],
    },
  ];
  const legalLinks: Array<[string, string]> = [
    ["privacy", tr(locale, "Privacy", "隐私政策")],
    ["corrections", tr(locale, "Corrections", "更正机制")],
    ["financial-disclaimer", tr(locale, "Financial disclaimer", "金融免责声明")],
  ];
  // A plain <a>, not <Link>: the two languages share this root layout, and a client-side
  // navigation across locales would swap the page content but leave the chrome (nav, this
  // button, <html lang>) rendered in the previous language — the reader ends up on /zh with
  // an English navbar whose Home still points at /en. A full document load re-renders the
  // whole layout in the target language, so each language stays a clean, self-contained set.
  const languageSwitch = pathname.startsWith("/admin") ? null : (
    <a
      className="minibtn"
      href={localePath(locale === "en" ? "zh-CN" : "en", pathname || "/")}
      hrefLang={locale === "en" ? "zh-CN" : "en"}
      aria-label={tr(locale, "Switch to Chinese", "切换到英文")}
    >
      {locale === "en" ? "中文" : "EN"}
    </a>
  );

  return (
    <html lang={locale}>
      <body className={pathname === "/" ? "page-home" : undefined}>
        <NavigationProgress />
        <div className="topbar">
          <div className="wrap inner">
            <Link href={localePath(locale, "/")} className="brand">
              <span className="glyph"><TlinesMark /></span> <span className="brand-name">{brandName(locale)}</span>
            </Link>
            <nav className="nav" aria-label={tr(locale, "Primary", "主导航")}>
              {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            </nav>
            <div className="sp" />
            {redesign && (
              <SearchOverlay
                locale={locale}
                labels={{
                  placeholder: tr(locale, "Search institutions, assets, topics or views…", "搜索机构、资产、主题或观点……"),
                  trigger: tr(locale, "Search", "搜索"),
                  aria: tr(locale, "Search the site", "全站搜索"),
                  all: tr(locale, "See all results", "查看全部结果"),
                  none: tr(locale, "Nothing matched — try another wording.", "没有匹配结果,换个说法试试。"),
                  hint: tr(locale, "↑↓ to choose · Enter to open · Esc to close", "↑↓ 选择 · Enter 打开 · Esc 关闭"),
                }}
              />
            )}
            <div className="topbar-account">{account}</div>
            {languageSwitch}
            <ThemeToggle label={tr(locale, "Theme", "主题")} ariaLabel={tr(locale, "Toggle theme", "切换主题")} />
            <MobileNav
              items={navItems}
              openLabel={tr(locale, "Open menu", "打开菜单")}
              closeLabel={tr(locale, "Close menu", "关闭菜单")}
              menuLabel={tr(locale, "Site navigation", "站点导航")}
            >
              {account}
            </MobileNav>
          </div>
        </div>
        {redesign && <TopbarScroll />}
        {children}
        {/* Mounted last and rendering nothing: the beacon must never be on the path to
            first paint of the page it is measuring. */}
        {process.env.ANALYTICS_ENABLED !== "false" && <Analytics />}
        {process.env.ANALYTICS_ENABLED !== "false" && !pathname.startsWith("/admin") && <CookieConsent locale={locale} />}
        <footer className="site-footer">
          <div className="wrap site-footer-inner">
            <div className="site-footer-top">
              <div className="site-footer-brand">
                <Link href={localePath(locale, "/")} className="site-footer-logo">
                  <TlinesMark />
                  <span>{brandName(locale)}</span>
                </Link>
                <p>{tr(locale, "Institutional research, made traceable. Every view keeps its source, its date and the report behind it.", "可核验的机构研究。每条观点都保留来源、日期与原始研报。")}</p>
                <Link className="site-footer-cta" href={localePath(locale, "/research")}>
                  {tr(locale, "Browse the latest research", "浏览最新研报")} <span aria-hidden="true">→</span>
                </Link>
              </div>
              <div className="site-footer-cols">
                {footerColumns.map((column) => (
                  <div className="site-footer-col" key={column.title}>
                    <h2>{column.title}</h2>
                    {column.links.map(([path, label]) => <Link key={path} href={localePath(locale, `/${path}`)}>{label}</Link>)}
                  </div>
                ))}
              </div>
            </div>
            <div className="site-footer-bottom">
              <span>© {new Date().getFullYear()} Tlines</span>
              <span>{tr(locale, "Research → Data → Signal", "研报 → 数据 → 信号")}</span>
              <nav aria-label={tr(locale, "Legal", "法律与政策")}>
                {legalLinks.map(([path, label]) => <Link key={path} href={localePath(locale, `/${path}`)}>{label}</Link>)}
              </nav>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
