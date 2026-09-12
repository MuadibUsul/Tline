import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeToggle from "./_components/ThemeToggle";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { doSignOut } from "./actions";
import { isFormalAuthConfigured } from "@/lib/auth-config";
import OAuthSignOutButton from "./_components/OAuthSignOutButton";
import MobileNav, { type MobileNavItem } from "./_components/MobileNav";
import Analytics from "./_components/Analytics";
import { getLocale, tr, localePath, stripLocale } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { ogImage } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = tr(locale, "Institutional Intelligence", "全球机构情报");
  const description = tr(
    locale,
    "Turn institutional research into actionable signal.",
    "将全球机构研究转化为可执行信号。",
  );
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${title}` },
    description,
    applicationName: title,
    openGraph: { type: "website", siteName: title, title, description, locale, images: [{ url: ogImage("Institutional Intelligence", "Tlines Institutional Intelligence", "Research / Data / Signal"), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage("Institutional Intelligence", "Tlines Institutional Intelligence", "Research / Data / Signal")] },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const formalAuth = isFormalAuthConfigured();
  const pathname = stripLocale((await headers()).get("x-pathname") ?? "");
  const locale = pathname.startsWith("/admin") ? "zh-CN" : await getLocale();

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

  const navItems: MobileNavItem[] = ([
    { href: "/", label: tr(locale, "Home", "首页") },
    { href: "/macro", label: tr(locale, "Economic Data", "经济数据") },
    { href: "/institutions", label: tr(locale, "Views", "观点") },
    { href: "/research", label: tr(locale, "Research", "研报") },
    { href: "/watchlist", label: tr(locale, "Monitoring", "监控") },
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
  const policyLinks = [
    ["about", tr(locale, "About", "关于")], ["methodology", tr(locale, "Methodology", "方法论")],
    ["editorial-policy", tr(locale, "Editorial policy", "编辑政策")], ["ai-usage", tr(locale, "AI usage", "AI 使用说明")],
    ["sources", tr(locale, "Sources", "来源说明")], ["privacy", tr(locale, "Privacy", "隐私政策")],
    ["corrections", tr(locale, "Corrections", "更正机制")],
  ];
  const languageSwitch = pathname.startsWith("/admin") ? null : (
    <Link
      className="minibtn"
      href={localePath(locale === "en" ? "zh-CN" : "en", pathname || "/")}
      hrefLang={locale === "en" ? "zh-CN" : "en"}
      aria-label={tr(locale, "Switch to Chinese", "切换到英文")}
    >
      {locale === "en" ? "中文" : "EN"}
    </Link>
  );

  return (
    <html lang={locale}>
      <body>
        <div className="topbar">
          <div className="wrap inner">
            <Link href={localePath(locale, "/")} className="brand">
              <span className="glyph">II</span> <span className="brand-name">{tr(locale, "Institutional Intelligence", "全球机构情报")}</span>
            </Link>
            <nav className="nav" aria-label={tr(locale, "Primary", "主导航")}>
              {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            </nav>
            <div className="sp" />
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
        {children}
        {/* Mounted last and rendering nothing: the beacon must never be on the path to
            first paint of the page it is measuring. */}
        {process.env.ANALYTICS_ENABLED !== "false" && <Analytics />}
        <footer className="footer wrap">
          <span>{tr(locale, "Research → Data → Signal", "研报 → 数据 → 信号")}</span>
          <nav className="footer-links" aria-label={tr(locale, "Policies", "政策说明")}>{policyLinks.map(([path, label]) => <Link key={path} href={localePath(locale, `/${path}`)}>{label}</Link>)}</nav>
        </footer>
      </body>
    </html>
  );
}
