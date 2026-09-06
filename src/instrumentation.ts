export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build" || process.env.SEARCH_PREWARM === "false") return;
  const { warmSearchIndex } = await import("./lib/search");
  try {
    await warmSearchIndex();
  } catch (error) {
    console.error("Search index prewarm failed", error);
  }
}
