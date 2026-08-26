export default function Loading() {
  return (
    <main className="wrap system-state" aria-live="polite" aria-busy="true">
      <div className="eyebrow">Loading</div>
      <h1>Preparing institutional intelligence…</h1>
      <p>Fetching the latest stored research and model outputs.</p>
    </main>
  );
}
