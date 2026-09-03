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
import LanguageToggle from "./_components/LanguageToggle";
import MobileNav, { type MobileNavItem } from "./_components/MobileNav";
import { getLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";

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
    openGraph: { type: "website", siteName: title, title, description, locale },
    twitter: { card: "summary", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const formalAuth = isFormalAuthConfigured();
  const locale = await getLocale();

  // An account enrolled by email link has no password yet. Sending it straight to the
  // page that sets one is what keeps email down to enrolment and recovery: without this
  // the next sign-in would need another message.
  const pathname = (await headers()).get("x-pathname") ?? "";
  // An empty path means the middleware did not run; redirecting on that guess would
  // loop the page onto itself, so the gate stays shut rather than trapping the browser.
  if (pathname && user && formalAuth && !user.passwordHash && !pathname.startsWith("/account/password")) {
    redirect("/account/password");
  }

  const navItems: MobileNavItem[] = [
    { href: "/", label: tr(locale, "Home", "首页") },
    { href: "/markets", label: tr(locale, "Markets", "市场") },
    { href: "/macro", label: tr(locale, "Economic Data", "经济数据") },
    { href: "/institutions", label: tr(locale, "Views", "观点") },
    { href: "/research", label: tr(locale, "Research", "研报") },
    { href: "/consensus", label: tr(locale, "Consensus", "共识") },
    { href: "/watchlist", label: tr(locale, "Monitoring", "监控") },
    ...(can(user, "admin.review") ? [{ href: "/admin", label: tr(locale, "Operations", "运营") }] : []),
  ];

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
    <Link href="/signin" className="minibtn">{tr(locale, "Sign in", "登录")}</Link>
  );

  return (
    <html lang={locale}>
      <body>
        <div className="topbar">
          <div className="wrap inner">
            <Link href="/" className="brand">
              <span className="glyph">II</span> <span className="brand-name">{tr(locale, "Institutional Intelligence", "全球机构情报")}</span>
            </Link>
            <nav className="nav" aria-label={tr(locale, "Primary", "主导航")}>
              {navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            </nav>
            <div className="sp" />
            <div className="topbar-account">{account}</div>
            <LanguageToggle locale={locale} />
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
        <footer className="footer wrap">
          <span>{tr(locale, "Research → Data → Consensus → Signal", "研报 → 数据 → 共识 → 信号")}</span>
          <span>{tr(locale, "Phase-1 · verified public research", "第一阶段 · 已验证公开研究")}</span>
        </footer>
      </body>
    </html>
  );
}
