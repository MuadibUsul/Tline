import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeToggle from "./_components/ThemeToggle";
import { getSessionUser } from "@/lib/auth";
import { doSignOut } from "./actions";
import { isFormalAuthConfigured } from "@/lib/auth-config";
import OAuthSignOutButton from "./_components/OAuthSignOutButton";
import LanguageToggle from "./_components/LanguageToggle";
import { getLocale, tr } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = getLocale();
  return {
    title: tr(locale, "Institutional Intelligence", "全球机构情报"),
    description: tr(locale, "Turn institutional research into actionable signal.", "将全球机构研究转化为可执行信号。"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const formalAuth = isFormalAuthConfigured();
  const locale = getLocale();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <div className="topbar">
          <div className="wrap inner">
            <Link href="/" className="brand">
              <span className="glyph">II</span> <span className="brand-name">{tr(locale, "Institutional Intelligence", "全球机构情报")}</span>
            </Link>
            <nav className="nav">
              <Link href="/">{tr(locale, "Home", "首页")}</Link>
              <Link href="/markets">{tr(locale, "Markets", "市场")}</Link>
              <Link href="/institutions">{tr(locale, "Views", "观点")}</Link>
              <Link href="/research">{tr(locale, "Research", "研报")}</Link>
              <Link href="/consensus">{tr(locale, "Consensus", "共识")}</Link>
              <Link href="/watchlist">{tr(locale, "Monitoring", "监控")}</Link>
            </nav>
            <div className="sp" />
            {user && formalAuth ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{user.email}</span>
                <OAuthSignOutButton label={tr(locale, "Sign out", "退出")} />
              </div>
            ) : user ? (
              <form action={doSignOut} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{user.email}</span>
                <button type="submit" className="minibtn">{tr(locale, "Sign out", "退出")}</button>
              </form>
            ) : (
              <Link href="/signin" className="minibtn">{tr(locale, "Sign in", "登录")}</Link>
            )}
            <LanguageToggle locale={locale} />
            <ThemeToggle label={tr(locale, "Theme", "主题")} ariaLabel={tr(locale, "Toggle theme", "切换主题")} />
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
