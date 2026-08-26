import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap system-state">
      <div className="eyebrow">404</div>
      <h1>Nothing is stored at this address.</h1>
      <p>The research item may not exist or may no longer be available to this account.</p>
      <Link className="minibtn p" href="/research">Browse research</Link>
    </main>
  );
}
