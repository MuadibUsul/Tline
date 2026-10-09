# Tlines SEO recovery audit — baseline diagnosis

Date: 2026-10-09 (Asia/Shanghai)

Scope: repository history from 2026-09-09 through 2026-10-06, current production behavior, and read-only tests

Production origin: `https://tlines.tech`

## Executive conclusion

No current P0 crawl blocker was found. Production does **not** expose a site-wide `noindex`, public pages are not blocked by `robots.txt`, the submitted sitemap is healthy, sampled sitemap URLs return the same indexable server-rendered HTML to a browser and Googlebot, and no Cloudflare challenge was observed.

The strongest code/deployment correlation with the reported impression loss is commit `a21bd1f`, deployed on **2026-09-27**, the first day of the decline window. It changed failed-language research URLs from persistent `noindex` pages to permanent redirects or 404s and consolidated publication gating across public surfaces. This can legitimately reduce the discoverable URL population, especially Chinese URLs, but the current repository and public site alone cannot prove that those retired URLs are the URLs that lost impressions. That attribution remains **待验证** against a GSC page/date export and historical access logs.

Current production has two reproducible crawl-quality defects: an arbitrarily high institutions pagination URL returns indexable 200 HTML, and non-canonical asset aliases such as uppercase ticker URLs return indexable 200 HTML instead of a redirect. Production health also currently reports `degraded`; anonymous health output does not identify the stale worker.

The baseline script is dependency-free and makes no LLM/JEV/DeepSeek calls. It is safe to repeat without increasing model spend.

## Inputs and limitations

Confirmed inputs from Search Console supplied for this audit:

- 2026-09-17–09-26: 517 impressions.
- 2026-09-27–10-06: 75 impressions, down 85.5%.
- English research impressions: 348 → 56.
- Chinese research impressions: 164 → 9.
- 28 sampled URLs: 13 indexed, 12 crawled-not-indexed, 2 redirects, 1 unknown to Google.
- One submitted sitemap: `https://tlines.tech/sitemap.xml`.

Limitations marked **待验证**:

- No authenticated GSC export/API was available, so affected queries and individual losing URLs could not be joined to gate decisions.
- No production database write or read with privileged credentials was performed.
- No Caddy/application/Googlebot access-log history was available for the decline window.
- No Cloudflare dashboard or WAF configuration was available. Current DNS and response headers do not show Cloudflare on the request path.
- Google’s September 24–October 8 spam update overlaps the decline, but this audit found no evidence that proves it caused this site’s decline.

## Architecture and SEO control points

| Area | Current implementation |
|---|---|
| Deployment | Self-hosted GitHub Actions/build, Docker Compose, Caddy reverse proxy; runbooks in `DEPLOYMENT.md`, `deploy/README.md`, workflows in `.github/workflows/` |
| Locale and redirects | `src/middleware.ts`; canonical locale prefixes `/en` and `/zh`, `/cn` alias, machine endpoint normalization, retired-route redirects |
| Global robots headers | `next.config.mjs`; `noindex, nofollow` is limited to named API endpoints, not public pages |
| robots.txt | `src/app/robots.ts`, `src/lib/site.ts`; public pages allowed, selected machine APIs disallowed |
| Sitemap | `src/app/sitemap.xml/route.ts`, `src/app/sitemap/[shard]/route.ts`, `src/lib/sitemap.ts`; dynamic index plus pages/research shards |
| Canonical/hreflang | `src/lib/seo.tsx`; self-canonical, `en`, `zh-CN`, and English `x-default`, restricted to actually available report locales |
| Root metadata | `src/app/layout.tsx`; `metadataBase` and default index/follow behavior |
| Research detail | `src/app/research/[id]/page.tsx`; immutable slug redirect, live quality check, SSR Tlines brief/arguments and report/PDF section |
| Research feed | `src/app/research/page.tsx`; locale-aware publication gate and empty-page `noindex` |
| Institutions | `src/app/institutions/page.tsx`, `src/app/institution/[slug]/page.tsx` |
| Assets | `src/app/markets/page.tsx`, `src/app/markets/[ticker]/page.tsx`, `src/app/asset/[ticker]/page.tsx`, `src/lib/assetPath.ts` |
| Ingestion | `src/lib/ingest/run.ts`, `src/lib/ingest/store.ts`, `src/lib/ingest/extract.ts`, document/PDF helpers under `src/lib/documents/` |
| Quality gate | `src/lib/contentQuality.ts`, `src/lib/gate.ts`, `src/lib/publication.ts`, `scripts/gate-recompute.ts` |
| Repair writers | `prisma/reparse.ts`, `prisma/translate.ts`, `prisma/retitle.ts`, admin approval actions; these refresh the stored gate verdict |
| Cache | `src/middleware.ts` for public page cache headers; `src/lib/sitemap.ts` for sitemap cache policy; Caddy observed via the live `Via` header |

## Change correlation: 2026-09-17 through 2026-10-06

| Date / commit | SEO-relevant change | Assessment |
|---|---|---|
| Sep 17 `1e758a9`, `220ca64`, `24badba`, `eadf246` | Added per-template search identities/topics, removed the overly broad empty-analysis exclusion, expanded publisher indexing, unified document-label checks | Mostly increases eligibility and improves quality; not a plausible cliff trigger by itself |
| Sep 21 `ee13e8b` | Stopped withholding completed Chinese pages by accepting the effective translated summary | Increases Chinese eligibility |
| Sep 23 `c3e30af` | Homepage presentation redesign | No robots/canonical/sitemap regression found |
| **Sep 27 `a21bd1f`** | Introduced the production release containing language-address retirement: a failed locale now 308s to English or 404s rather than remaining a `noindex` page; withdrawal and public query alignment shipped in the same large commit | **Highest-confidence timing correlation**: commit/deploy is on the first day of the impression decline. Causality is **待验证** |
| Sep 27 `d141c4e`; docs `1e24120` | Production recorded as running immutable image `sha-d141c4e4367e` | Confirms the Sep 27 change was deployed, not merely committed |
| Oct 4 `065f0d0`, `b1252c4`; docs `c3cdfcc` | Persisted `indexableEn/indexableZh` verdicts and made sitemap/listings use them; new columns default false and require `gate:recompute` | Potential transient empty-list/sitemap risk, but deploy notes record the required recompute: 1,554 checked, 1,511 English, 862 Chinese, sitemap 2,373. This occurs after most of the decline window |

The key behavior is visible today at `src/app/research/[id]/page.tsx:242`: locale quality is recomputed, then a failed Chinese page permanently redirects to English and a report failing both locales returns 404. `src/lib/publication.ts:46` makes feeds, related content, APIs and sitemaps depend on the stored locale verdict. The gate rules are in `src/lib/contentQuality.ts:69`.

Historical repository notes reinforce the population-change hypothesis without proving it: the Sep 25 production snapshot records 1,269 English and 675 Chinese eligible research URLs, with roughly 605 Chinese addresses retired by redirect/404. The Oct 4 backfill records 1,511 English and 862 Chinese. These are operational notes, not independent GSC evidence.

## Production baseline

Full reproducible output: [`02-baseline-2026-10-09.md`](./02-baseline-2026-10-09.md).

Command:

```bash
node scripts/seo-baseline.mjs --base=https://tlines.tech --sample=18
```

Observed on 2026-10-09:

- `robots.txt`, sitemap index, and both shards: 200.
- Sitemap: 3,063 URLs total; 1,874 English and 1,189 Chinese; 0 duplicate locs, 0 off-origin locs, 0 alternate targets absent from the loc set, 0 URLs matching a listed Disallow prefix, 0 future `lastmod` values.
- 18 representative sitemap URLs: browser/Googlebot both 200, exact self-canonical, indexable, self hreflang plus `x-default`, and meaningful SSR text.
- Root, locale-less research, prefixed sitemap, and `/cn` aliases resolve in one 308 hop.
- No sampled 403/429/503, bot challenge, or material browser/Googlebot body difference.
- DNS A record: `104.207.82.85`; live responses show `Via: 1.1 Caddy`, no `CF-Ray` and no Cloudflare server header.
- `/api/health`: HTTP 200 with `{"status":"degraded"}`, `Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow`.
- `/en/research` Googlebot response: 200, approximately 124 KB HTML, public `s-maxage=60`, and server-rendered report text.

The script intentionally exits non-zero today because it reproduces two known defects:

1. `/en/institutions?page=9999` → 200, `index, follow`, self-canonical.
2. `/en/markets/SPX` → 200 while canonical points to `/en/markets/sp-500`; expected a permanent redirect.

Focused repository tests passed: 24/24 across canonical/hreflang, sitemap, publication gate, and middleware behavior.

## Prioritized findings

### P0 — none confirmed

No evidence currently supports a site-wide crawl or indexing outage. A blanket rollback, mass deletion, or mass `noindex` would remove healthy URLs and is not justified.

### P1-1 — Sep 27 gate/address retirement is the leading decline correlation; affected GSC URLs are unjoined

**Evidence**

- The decline begins Sep 27; `a21bd1f` was committed and deployed Sep 27.
- The commit explicitly changes failed locale URLs from persistent noindex pages to 308/404 behavior.
- Chinese impressions fell more sharply, and historical notes record hundreds of Chinese addresses leaving the 200 population.
- Current live sitemap and pages are internally consistent, so the likely question is historical URL-population change or content-quality selection rather than a current global block.

**Affected scope**: research detail URLs in either language that failed `contentQuality`; likely larger on Chinese translations. Exact losing URL count is **待验证**.

**Next fix/validation**

1. Export GSC Pages × Date for Sep 17–Oct 6 and URL Inspection results for the 28 sampled URLs.
2. Join each URL to current/historical gate verdict and issue (`gateIssuesEn`, `gateIssuesZh`).
3. Add a daily, non-LLM gate cohort report: total eligible by locale, newly admitted, newly retired, and reasons.
4. Change only a demonstrated false-positive rule; do not weaken the complete gate speculatively.

**Rollback**: snapshot verdict counts first; revert only the false-positive predicate in `src/lib/contentQuality.ts`, refresh only affected IDs, and confirm sitemap/page parity. A whole-image rollback to the pre-gate behavior is not recommended because it revives pages already judged incomplete.

### P1-2 — Production health is degraded

**Evidence**: `https://tlines.tech/api/health` returns 200 with `{"status":"degraded"}`. Code marks the rollup degraded when the research, macro, or social heartbeat is stale, or a job has run for more than 20 minutes (`src/app/api/health/route.ts:43-55`). Anonymous output deliberately hides the component.

**Affected scope**: **待验证**. A stale research worker could reduce discovery/freshness; a macro/social worker would not directly block Googlebot. Public pages and sitemap currently respond normally.

**Next fix/validation**: use an authorized health request or production logs to identify the worker, then check its heartbeat, last successful ingest, and stuck job count. No code change should be made before that read-only diagnosis.

**Rollback**: restart only the affected worker. If a recent worker code regression is confirmed, roll that service back to the last healthy immutable image; do not touch the database.

### P1-3 — Out-of-range institutions pagination is an indexable soft-404 surface

**Evidence**: `/en/institutions?page=9999` returns 200, `index, follow`, and a self-canonical URL. The page calculates `pages` but never rejects or noindexes `page > pages` (`src/app/institutions/page.tsx:16-32`, `:82-85`, `:136`). The equivalent research pagination correctly noindexes empty pages (`src/app/research/page.tsx:44`).

**Affected scope**: unbounded `?page=N` variants in both locales. They are not emitted by valid pagination, but external links and crawler parameter discovery can create unlimited empty URLs.

**Fix**: return 404 for out-of-range positive pages after computing total, and make generated metadata noindex an empty page as defense in depth. Add route/helper tests and retain canonical pagination for valid pages.

**Rollback**: revert the single route change; no data migration is involved.

### P1-4 — PDF-backed report pages omit the full source body from server HTML

**Evidence**: sampled PDF reports return substantial SSR HTML (about 2,884–3,478 visible characters) with a Tlines-written brief, arguments and source link, so they are **not** empty client-only pages. However, when a publisher-native PDF exists, only `PdfPreview` is rendered and the extracted English source is deliberately omitted (`src/app/research/[id]/page.tsx:255-260`, `:346-373`). Six sampled research pages had a PDF preview without “Complete English original” in HTML.

**Affected scope**: research pages with a `source_native` PDF. The exact share and its overlap with GSC crawled-not-indexed URLs are **待验证**.

**Fix**: do not copy entire publisher reports into HTML merely for SEO. Measure the crawled-not-indexed cohort first; strengthen original server-rendered Tlines analysis, comparisons, key evidence, and unique conclusions where thin. If licensing permits excerpts, render bounded cited excerpts, not wholesale source text.

**Rollback**: keep any new analytical block behind a small component/feature switch and remove it if quality or rights review fails.

### P2-1 — Asset alias/case URLs return 200 instead of consolidating by redirect

**Evidence**: `/en/markets/SPX` returns 200/index and canonicalizes to `/en/markets/sp-500`. `src/app/asset/[ticker]/page.tsx:17-40` emits the correct canonical but does not compare the requested segment with `assetPath(asset.ticker)`; the render path likewise proceeds at `:46-54`.

**Affected scope**: ticker, uppercase, and other accepted asset slug variants in both locales. Canonical tags reduce duplicate risk, so this is not a P0/P1 index blocker.

**Fix**: after resolving the asset, permanent-redirect any non-canonical segment to `assetPath(asset.ticker)` while retaining existing legacy redirects.

**Rollback**: revert the route-only redirect check.

### P2-2 — Static sitemap `lastmod` is stale and shared

**Evidence**: `src/lib/sitemap.ts:107` hard-codes `STATIC_UPDATED_AT` to 2026-09-13, although static/page-template content changed afterward. Live sitemap integrity is otherwise healthy.

**Affected scope**: static routes and taxonomy entries that fall back to that value. Research entries use content timestamps.

**Fix**: use explicit per-route content dates or a build/deploy revision date supplied at build time; do not emit request time, which would falsely mark every URL changed on every crawl.

**Rollback**: restore the fixed fallback date.

### P2-3 — Intended cache variation differs from live response headers

**Evidence**: middleware sets `Vary: Cookie, Accept-Language` and public cache control (`src/middleware.ts:21-28`), and sets `tline_locale` on first prefixed visits (`:124-139`). Live `/en/research` has `Set-Cookie` and public caching, but its final `Vary` contains Next router fields and `Accept-Encoding`, not Cookie/Accept-Language.

**Affected scope**: cache effectiveness and possibly intermediary behavior. Locale-prefixed page content is path-stable, and browser/Googlebot bodies matched, so no indexing defect is demonstrated.

**Fix**: inspect Caddy/Next header merging and decide whether prefixed responses need those variation keys at all. Avoid adding high-cardinality `Vary: Cookie` unless the response actually varies by cookie.

**Rollback**: revert header-only configuration.

## Checks that passed

- No public-page `X-Robots-Tag: noindex` was found; API noindex rules are narrowly scoped in `next.config.mjs:37-66`.
- robots rules allow public content and advertise the canonical sitemap (`src/app/robots.ts:4-17`).
- Canonicals and hreflang are locale-prefixed and self-reciprocal in sampled pages (`src/lib/seo.tsx:22-32`).
- Sitemap shards have no sampled omissions, duplicates, broken alternate references, blocked URLs, or invalid origins.
- Research slugs are canonicalized by permanent redirect; locale-less and legacy paths use one-hop 308s.
- Server HTML contains real page/report content. The site is not dependent on client rendering for its indexable summary/analysis.
- Browser and Googlebot samples received the same statuses and materially equivalent bodies.
- No current Cloudflare edge/challenge signal was found. Dashboard policy remains **待验证**.

## Next-stage concrete file list

The following is the smallest recommended implementation set; no production database write is required for the first two fixes.

1. `src/app/institutions/page.tsx` — reject/noindex out-of-range pagination.
2. `src/app/asset/[ticker]/page.tsx` — redirect resolved non-canonical asset segments.
3. `src/lib/assetPath.test.ts` and a focused pagination helper/route test — lock both regressions.
4. `scripts/seo-baseline.mjs` — keep as the live regression probe; optionally add a package script in `package.json`.
5. `src/lib/sitemap.ts` and `src/lib/sitemap.test.ts` — replace the stale shared static `lastmod` with truthful per-route/build metadata.
6. `scripts/seo-status.ts`, `src/lib/gate.ts`, and `src/lib/contentQuality.ts` — only after GSC export, add cohort reporting and adjust a proven false-positive gate rule.
7. `src/app/research/[id]/page.tsx` plus a small presentation component/test — only after content/rights review, strengthen unique SSR analysis for PDF-backed pages.
8. `src/app/api/health/route.ts`, worker scheduler files, or Compose config — only if authorized health detail identifies a code/config defect.

## Phase boundary

This phase added diagnostics and documentation only. It did not deploy, modify production data, mass-delete URLs, mass-noindex content, or change the application’s architecture. The next phase should first fix the two deterministic URL defects, retrieve the GSC URL/date export, and identify the degraded worker before changing gate policy.
