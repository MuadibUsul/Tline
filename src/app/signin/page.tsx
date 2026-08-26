import { doSignIn } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DEMO_EMAIL } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const user = await getSessionUser();
  if (user) redirect(searchParams.next || "/watchlist");
  const next = searchParams.next || "/watchlist";
  const demoAuthEnabled = process.env.NODE_ENV !== "production" || process.env.ALLOW_INSECURE_DEMO_AUTH === "true";

  return (
    <main className="wrap" style={{ maxWidth: 460 }}>
      <div className="page-head" style={{ borderBottom: "none" }}>
        <div className="eyebrow">Account</div>
        <h1>Sign in</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{demoAuthEnabled
          ? "Preview sign-in identifies your watchlist and alerts without a password."
          : "Account sign-in is unavailable until the production OAuth provider is configured."}</p>
      </div>

      {searchParams.error === "email" && (
        <p className="chip bear" style={{ display: "inline-block" }}>Enter a valid email.</p>
      )}
      {searchParams.error === "disabled" && (
        <p className="chip bear" style={{ display: "inline-block" }}>Preview sign-in is disabled in production.</p>
      )}

      {demoAuthEnabled && <><form action={doSignIn} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="hidden" name="next" value={next} />
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required placeholder="you@fund.com" />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input name="name" type="text" placeholder="Jane Trader" />
        </label>
        <button type="submit" className="minibtn p" style={{ padding: "9px 14px", justifyContent: "center" }}>Continue →</button>
      </form>

      <form action={doSignIn} style={{ marginTop: 14, textAlign: "center" }}>
        <input type="hidden" name="email" value={DEMO_EMAIL} />
        <input type="hidden" name="name" value="Demo Trader" />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="minibtn" style={{ padding: "8px 14px" }}>Continue as demo →</button>
      </form></>}
    </main>
  );
}
