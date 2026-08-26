"use client";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap system-state" role="alert">
      <div className="eyebrow">Error</div>
      <h1>That view could not be loaded.</h1>
      <p>The stored data is unchanged. Retry the request or return later.</p>
      <button className="minibtn p" type="button" onClick={reset}>Retry</button>
    </main>
  );
}
