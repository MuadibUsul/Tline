# ADR: Macro Intelligence as an independent data domain

- Status: Accepted
- Date: 2026-08-29
- Scope: Prompt 1 — repository audit and architecture decision only

## Context

Tline currently has one production data path:

```text
Public institutional research
  -> compliant Article ingest
  -> Article / Analysis / ArticleAsset / AtomicView
  -> Institutional Consensus
  -> Alerts and Web
```

Macro Intelligence introduces two different kinds of facts:

```text
Official structured APIs -> observations, releases and vintages
Official policy pages    -> policy documents and source-backed parsing
```

These facts have different identity, precision, revision, timing and provenance rules from research articles. They therefore need a separate domain while remaining in the existing Next.js/Prisma monolith.

## Repository audit

### Current schema and `PriceObservation`

The current Prisma schema contains 22 models, not the 21 referenced by the prompt pack. This count should be treated as the current baseline for later regression checks.

`PriceObservation` is intentionally small:

- `assetId`, `timestamp`, `value Float`, `source`, optional `sourceRef`.
- Unique key: `(assetId, timestamp, source)`.
- Index: `(assetId, timestamp)`.
- It is written only by `prisma/prices.ts`, which imports a licensed `ticker,timestamp,value` CSV and upserts the value.
- It is read only by `src/lib/forecast.ts` to settle `Forecast` rows from start/target prices supplied by the same source.

It does not carry instrument identity independent of `Asset`, interval, quote currency, market-data quality, observed/fetched time separation, decimal-safe values, or vintages. Its upsert also intentionally overwrites an existing price at the same key. Those semantics are suitable for the present forecast-settlement boundary but not for macro observations or a general market-data history.

Decision: do not extend `PriceObservation` for Macro Intelligence. Leave it unchanged for forecast settlement. Macro API values use `MacroObservation`. If the later market-provider phase is implemented, add `MarketInstrument` and `MarketObservation` rather than changing forecast-settlement semantics.

### Jobs, audit, alerts and scheduler

- `runTrackedJob` creates and finalizes `JobRun` with JSON parameters/metrics, bounded error text and timestamps. It is domain-neutral and reusable by macro CLIs.
- `AuditLog` is also domain-neutral. It should record policy-document content changes and later user/admin actions, but it is not an observation-vintage store.
- Alerts currently support Institutional Consensus and new-research rules. Dedupe is either `(ruleId, targetId)` or a 12-hour asset window. Macro alert types should be added only in their dedicated phase, using release/document IDs as deterministic targets; the current evaluation semantics must remain unchanged meanwhile.
- `scripts/scheduler.mjs` serially runs research ingest and its parse/translation/document stages, with bounded retries, graceful signal handling and an optional failure webhook. It has no distributed lock and relies on one scheduler replica. Reuse its process-control pattern, not the research schedule itself; Macro needs a separate scheduler process because release polling has different cadence and failure isolation.

### Consensus isolation

All `consensus.ts` callers were traced. They are the home/query layer, market/asset/consensus pages, user/watchlist views, alert evaluation, consensus tests, and ingest/recompute snapshot commands. `src/lib/ingest/run.ts` also snapshots consensus after research ingest.

Decision: no Macro provider, release, observation or policy document will call or write through `computeConsensus`, `snapshotAll`, `ConsensusHistory` or `ArticleAsset`. Institutional Consensus keeps its existing meaning: authority-weighted institutional research direction in a rolling 24-hour window, with display-only fallback behavior.

### SQLite to PostgreSQL flow

- `prisma/schema.prisma` is the canonical SQLite development schema.
- Local development uses `prisma db push`; there is no versioned SQLite migration directory.
- `scripts/generate-postgres-schema.mjs` copies the canonical schema to `prisma/postgresql/schema.prisma` and changes only the datasource provider.
- Production runs the generated PostgreSQL schema plus versioned SQL under `prisma/postgresql/migrations/` using `prisma migrate deploy`.
- The checked-in generated PostgreSQL schema is structurally aligned with the canonical schema, but currently has one stale comment in `Institution.lastCrawlStatus` (it omits `empty`). The generator would refresh it. Prompt 2 should regenerate the file and add an explicit PostgreSQL migration for the macro tables.
- The project uses `String` status/category fields rather than Prisma enums. Macro models should follow that convention unless cross-database validation proves an enum safe and useful.

### HTTP, robots, retry and provider boundaries

Safe infrastructure ideas to reuse:

- Native `fetch`, `AbortController`/`AbortSignal.timeout`, conditional request headers, bounded retry/backoff, `Retry-After`, a declared user agent, and exact content hashing.
- Existing compliance rule: only public official endpoints/pages; never bypass login, consent, CAPTCHA, WAF or robots restrictions.
- The configured LLM provider boundary can later parse policy-document text after deterministic extraction.

Code that must remain in the Article ingest domain:

- `fetchText`, `fetchPdf`, robots disk cache, sitemap discovery, HTML/PDF article extraction, rendering and source rules under `src/lib/ingest/`.
- `fetchText` has article-oriented content-type/cache behavior and only a narrow retry path; `fetchResource` normalizes network failures to status `0` and does not provide provider-specific rate limiting or structured errors. Importing these functions into Macro would couple official APIs to crawler behavior and lose useful failure detail.
- `src/lib/hash.ts` uses normalized/truncated SHA-1 for article dedupe. Macro raw payloads and policy documents need exact SHA-256 hashes, so only the standard-library hashing approach should be reused.

Decision: create a small Macro-specific HTTP utility when real providers are added. It must support injected `fetch`, timeout, bounded retries, per-provider rate limiting, `Retry-After`, structured/redacted errors and JSON/CSV/SDMX response handling. Policy HTML fetching may reuse compliance concepts, but not the article extraction pipeline.

### Current Web pattern

The Web app uses Next.js 14 App Router server components:

- Dynamic pages export `dynamic = "force-dynamic"` and query Prisma on the server.
- Shared read models live mainly in `src/lib/queries.ts`; simpler pages sometimes query Prisma directly.
- Independent queries are grouped with `Promise.all`.
- Dynamic routes use `notFound()` for absent records.
- Filtering and pagination use URL search parameters and Prisma `where/orderBy/take/skip`.
- UI reuses `src/app/_components/ui.tsx`, global CSS, semantic tables, server-rendered links, and `getLocale`/`tr` for English and Simplified Chinese.
- Unknown values are currently rendered as an em dash in several views. Macro pages need explicit labels where the distinction matters: `N/A`, `Not released`, and `No consensus data` must not collapse to `0` or one generic placeholder.

Decision: add a Macro query module and server-component routes that follow these patterns. Pages read only normalized Macro tables; they never call upstream providers during a request.

## Decision

### Domain boundary

Add `src/lib/macro/` as a peer of `src/lib/ingest/`, not a child or extension of it.

```text
Research domain: Article -> ArticleAsset -> Institutional Consensus
Macro domain:    Indicator/Source -> Observation/Vintage -> Release -> Macro Signal
Policy domain:   Official document -> deterministic fields -> optional LLM fields
```

Both domains share the database client, job tracking, audit infrastructure, deployment image, localization and UI primitives. They do not share business entities, parsing pipelines or scores.

### Observation and revision strategy

- `MacroIndicator` is the stable canonical identity shown in product pages.
- `MacroSeriesSource` maps one provider series/dataset/table/line to that identity and stores source priority and metadata.
- `MacroObservation` is append-only and belongs to a series source, not directly to an article or asset.
- Store values as Prisma `Decimal`; parse from source strings without passing through a JavaScript floating-point number.
- Distinguish `period`, `sourcePublishedAt`, `vintageAt` and `fetchedAt`.
- Enforce uniqueness on `(seriesSourceId, period, vintageAt)` and index latest-by-series/period reads.
- The first accepted value for a period is revision `0` and `isInitial = true`. A changed later value appends revision `1`, then `2`, and so on.
- A later fetch with the same normalized value/status does not create a false revision. It updates only sync-state/freshness metadata, not the old observation.
- Use a provider-supplied vintage/realtime date when one exists. If a latest-only source changes, use the detection/fetch time as Tline's observed vintage and explicitly mark that provenance; never fabricate historical vintages.
- Never update an old observation value in place.

### Release/event model

`MacroRelease` represents the calendar event and keeps `scheduledAt` separate from `releasedAt`, with UTC storage plus `sourceTimezone`. Its deterministic `releaseKey` provides calendar idempotency and allows rescheduling without creating a duplicate event.

`MacroReleaseValue` is a point-in-time snapshot for one indicator in that event. It preserves initial actual, previous-as-known-at-release, revised previous, and any licensed consensus with its provider/as-of time. Later observation revisions do not overwrite this snapshot.

Calendar and watcher logic must reject stale periods and must not infer release completion merely because a fallback provider has some value.

### Policy-document model

`MacroPolicyDocument` stores an official central-bank URL, exact raw text, exact content hash, publication/fetch times and optional parsed JSON. Reliable numeric fields are extracted deterministically first. The LLM may enrich qualitative fields but cannot override deterministic numbers, cannot invent missing values, and must attach source quotes to core judgments.

Policy documents are not `Article` rows: they have official-event identity, update/audit semantics and a narrower parsing contract. A changed document at the same URL keeps the current document record plus an audit trail; if full historical text comparison becomes a product need, add a document-version table in that later phase rather than overloading `Article`.

### Provider precedence and fallback

Precedence is configured per series:

1. Publishing agency official API/data service.
2. Another official public service where appropriate.
3. FRED/ALFRED for backfill, release metadata, vintage fallback and reconciliation.
4. Licensed aggregator only for fields the official source does not publish, especially market consensus.

Fallback never silently overwrites a primary series. Observations remain provider-specific under separate `MacroSeriesSource` rows. Cross-provider differences produce provenance-aware reconciliation warnings. Product queries select the enabled highest-priority eligible source and display it.

Consensus/forecast values are stored only with `consensusProvider` and `consensusAsOf`. If no authorized source exists, the value stays `null`. An LLM must never estimate it.

### Scheduler strategy

Keep one application repository and image, but add a dedicated Macro scheduler in its later phase. It will run calendar sync, regular provider sync, release watch, revision sync and policy sync. Each task uses `JobRun`, bounded retries, no overlapping invocation, graceful shutdown and provider-level rate limits.

The research scheduler remains unchanged. The Web process performs no background synchronization and upstream API failures do not make the Web readiness check fail; health reports Macro freshness as a degraded data condition.

## MVP

The first Macro MVP is United States only:

- Inflation: CPI, Core CPI, PPI, PCE, Core PCE.
- Labor: NFP, unemployment rate, JOLTS openings.
- Growth/income: GDP, Personal Income, Personal Spending.
- Policy: Fed rate decision and FOMC statement.
- Energy: EIA crude inventories.

The MVP includes canonical indicators, official-source observations, release calendar/snapshots, revision history, policy documents and provenance. It explicitly excludes a composite Macro score, automatic fusion into Institutional Consensus, inferred market consensus, investment advice, broad global coverage and a general real-time market-data platform.

## Web integration contract

The website should consume Macro through read-only query functions, not provider calls:

```text
Macro scheduler -> normalized Macro tables -> src/lib/macro/queries.ts -> Server Components
```

Recommended route/read-model split:

- `/macro`: upcoming high-impact events, latest releases and category summaries.
- `/macro/calendar`: release rows with explicit null-state semantics.
- `/macro/indicator/[key]`: selected canonical source, history and all vintages/revisions.
- `/macro/release/[id]`: event snapshot, values, provenance and policy documents.

The home page should initially add only a compact “Upcoming macro events / latest releases” module linking into `/macro`. Existing market-consensus cards remain untouched. Search and watchlist integration should be added after the core pages have stable canonical IDs, so links and alert scopes never depend on provider-specific series names.

## Consequences

Positive:

- Point-in-time correctness and source provenance are explicit.
- Research and Institutional Consensus cannot be contaminated by structured API facts.
- Providers, revisions and release snapshots can evolve independently.
- Existing deployment, UI and operational primitives are reused without introducing a service or queue prematurely.

Costs:

- Some apparently similar data is deliberately stored in separate tables.
- Product queries must choose a canonical source using configured priority rather than assuming one universal series.
- A dedicated scheduler and data-quality checks are required before the pages can be considered operationally complete.

## Follow-up sequence

1. Prompt 2: implement the Macro Prisma schema, PostgreSQL migration and generated schema.
2. Prompt 3: implement registry, deterministic normalization and append-only revision logic with tests.
3. Prompts 4–7: official US providers, calendar/watcher and FOMC policy parsing.
4. Prompt 11: add Macro queries and pages, then expose a compact home-page module.
5. Prompt 12 onward: alerts, dedicated scheduler, backfill and quality audit.
# 2026-09 补充：预期证据语义

系统永久区分四类信息：文章/AtomicView 形成的研究观点共识、发布前调查市场共识、模型预测、实际观测。只有带证据并在发布前已捕获的 `SURVEY_CONSENSUS` 可产生“超预期/不及预期”；模型与研报预测只能单独比较。版本只追加，发布后的历史重建不能追认为当时可用信息。

raw surprise 为首次实际值减冻结调查共识。百分数的差标为百分点，收益率变化标为基点；标准化仅使用此前同口径误差，至少 12 个样本，零方差或样本不足返回空值而非置信度。
