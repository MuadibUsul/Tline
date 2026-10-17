/**
 * A route transition should acknowledge the click before the server answers. Pages with a
 * closer boundary (the article page) render their own; this is the fallback for every
 * other navigation, leaving the header in place and painting the content area.
 */
export default function Loading() {
  return (
    <main className="wrap" style={{ paddingTop: 30 }} aria-busy="true">
      <div className="skeleton" style={{ width: 170, height: 11, marginBottom: 18 }} />
      <div className="skeleton" style={{ width: "56%", maxWidth: 620, height: 34, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: "100%", height: 14, marginBottom: 9 }} />
      <div className="skeleton" style={{ width: "86%", height: 14 }} />
    </main>
  );
}
