/**
 * The article page waits on the report, its analysis, peers and the reader's bookmark
 * state. This boundary paints immediately on navigation, so a link click is acknowledged
 * even when the server render takes a moment. It mirrors the article's own rhythm: title,
 * byline, then the brief.
 */
export default function LoadingArticle() {
  return (
    <main className="wrap" style={{ maxWidth: 1080, paddingTop: 26 }} aria-busy="true">
      <div className="skeleton" style={{ width: 220, height: 11, marginBottom: 20 }} />
      <div className="skeleton" style={{ width: "72%", height: 42, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: 360, maxWidth: "100%", height: 13, marginBottom: 26 }} />
      <div className="citation-card" style={{ display: "grid", gap: 12 }}>
        <div className="skeleton" style={{ width: 180, height: 12 }} />
        <div className="skeleton" style={{ width: "96%", height: 15 }} />
        <div className="skeleton" style={{ width: "90%", height: 15 }} />
        <div className="skeleton" style={{ width: "84%", height: 15, marginBottom: 6 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[0, 1, 2, 3].map((key) => <div key={key} className="skeleton" style={{ height: 56 }} />)}
        </div>
        <div className="skeleton" style={{ width: "100%", height: 120, marginTop: 4 }} />
      </div>
    </main>
  );
}
