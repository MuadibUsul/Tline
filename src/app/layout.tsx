import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ThemeToggle from "./_components/ThemeToggle";
import { getSessionUser } from "@/lib/auth";
import { doSignOut } from "./actions";
import { isFormalAuthConfigured } from "@/lib/auth-config";
import OAuthSignOutButton from "./_components/OAuthSignOutButton";

export const metadata: Metadata = {
  title: "Institutional Intelligence",
  description: "Turn institutional research into actionable signal.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const formalAuth = isFormalAuthConfigured();
  return (
    <html lang="en">
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
              <span className="glyph">II</span> Institutional&nbsp;Intelligence
            </Link>
            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/markets">Markets</Link>
              <Link href="/institutions">Institutions</Link>
              <Link href="/research">Research</Link>
              <Link href="/search">AI Search</Link>
              <Link href="/consensus">Consensus</Link>
              <Link href="/watchlist">Watchlist</Link>
              <Link href="/alerts">Alerts</Link>
            </nav>
            <div className="sp" />
            {user && formalAuth ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{user.email}</span>
                <OAuthSignOutButton />
              </div>
            ) : user ? (
              <form action={doSignOut} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{user.email}</span>
                <button type="submit" className="minibtn">Sign out</button>
              </form>
            ) : (
              <Link href="/signin" className="minibtn">Sign in</Link>
            )}
            <ThemeToggle />
          </div>
        </div>
        {children}
        <footer className="footer wrap">
          <span>Research → Data → Consensus → Signal</span>
          <span>Phase-1 · verified public research</span>
        </footer>
      </body>
    </html>
  );
}
