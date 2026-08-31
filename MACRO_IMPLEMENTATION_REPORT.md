# Tline Macro Intelligence Implementation Report

Generated: 2026-08-30

## 1. Implemented architecture

Macro Intelligence is a separate domain under `src/lib/macro`, `data/macro`, and the `Macro*`/`Market*` database models. It does not write Article, Analysis, ArticleAsset, or ConsensusHistory. The existing research ingestion and Institutional Consensus calculation remain unchanged. The completed flow is: canonical registry → official provider adapters → append-only observations → release watcher/policy documents → point-in-time release values → presentation and alerts. `/macro`, `/macro/calendar`, indicator detail, and release detail read this domain directly.

The website uses the data without a second copy or client-side data join: server-rendered pages query canonical indicators, releases, observations, and provenance through Prisma. The existing Monitoring Center reuses `AlertRule.scopeKind/scopeRef`, permissions, and `AlertEvent` rather than creating a parallel account feature.

## 2. Schema

Implemented models: `MacroIndicator`, `MacroSeriesSource`, `MacroObservation`, `MacroRelease`, `MacroReleaseValue`, `MacroPolicyDocument`, `MacroSyncState`, `MacroSignalSnapshot`, `MarketInstrument`, and `MarketObservation`. Economic values and prices use Prisma Decimal. JSON-like metadata remains validated JSON strings for SQLite compatibility.

Uniqueness protects canonical keys, provider series, period/vintage pairs, revision numbers, release keys, release/indicator values, policy content, sync cursors, and market bars. Restrictive foreign keys protect observation history and indicator mappings; release values and market bars cascade with their owning release/instrument; policy documents retain evidence and set a deleted release reference to null. The canonical SQLite schema, generated PostgreSQL schema, and migration `20260829000000_macro_intelligence` validate and are covered by consistency tests.

## 3. Providers

Official macro providers: BLS, BEA, FRED/ALFRED, EIA, Eurostat SDMX, and ECB SDMX. Adapters implement timeout, bounded retry, request pacing, secret-safe errors, injected HTTP boundaries, normalized UTC periods, Decimal-safe values, raw hashes, status, and provider metadata. Registry priority keeps primary agencies ahead of FRED fallback. FRED historical backfill requests all vintages through ALFRED output type 4.

Licensed market data is deliberately independent. Twelve Data supports EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, and XAUUSD with explicit delayed/realtime/EOD quality; it cannot be mislabeled as an official reference price.

## 4. Indicator coverage

The registry contains 21 canonical indicators and 31 source mappings. U.S. coverage includes headline/core CPI, PPI, payrolls, unemployment, JOLTS, headline/core PCE prices, GDP, personal income/spending, federal-funds target bounds, and crude inventories. Euro-area coverage includes headline/core HICP, unemployment, GDP, and the three ECB standing policy rates.

Units, frequency, seasonal adjustment, country, currency, importance, provider series, and source URLs are stored centrally. Multiple providers remain separate vintages under one canonical indicator; they are not averaged or silently overwritten.

## 5. Release coverage

Eight release families are registered: CPI, Employment Situation, PPI, JOLTS, Personal Income and Outlays, GDP, FOMC Decision, and Weekly Petroleum Status Report. Official BLS iCal, BEA schedule, Federal Reserve calendar, and EIA schedule are primary; configured FRED release dates are fallback only.

Release identities are deterministic and independent of scheduled time, so rescheduling updates the existing event. Missing calendar entries are retained for review. The watcher uses family-specific warm/hot/late windows and captures the exact target period, actual initial value, previous value available at release, and any revised previous value.

## 6. Policy coverage

FOMC statements, implementation notes, and minutes are discovered from official Federal Reserve pages. Raw text, content hash, source URL, publication time, parser/model provenance, review status, parsed JSON, and exact source quotes are retained.

Rate range, decision, basis-point change, and votes use deterministic extraction first. Optional LLM semantics are constrained to the stored text, require exact supporting quotes, cannot replace deterministic numeric fields, and fall back to `UNKNOWN`/empty rather than inventing facts. Other central banks are schema-ready but do not yet have policy-document collectors.

## 7. Scheduler

`macro-scheduler` is a separate process/container. It schedules calendar refresh, regular provider sync, release watch, two-year revision refresh, policy sync, and macro alert evaluation. Defaults avoid continuous high-frequency polling: only the lightweight due-release watcher and alert evaluator run each minute; provider sync defaults hourly, calendar/policy six-hourly, and revision checks daily. Child-process startup is portable across Windows and Unix-like production hosts.

Each child CLI writes `JobRun`, including retry attempt. The scheduler prevents same-job overlap within the singleton, serializes all writers for the local SQLite development database, and prevents observation-writing jobs from overlapping on PostgreSQL. It applies bounded linear retry, optionally calls the existing failure webhook, forwards shutdown signals, waits for active children, and marks interrupted runs failed on restart so health reporting cannot remain permanently stale. Production must run exactly one scheduler replica until a distributed lease is introduced.

## 8. Point-in-time guarantees

Observations are append-only by source, period, vintage, and revision number. Repeated identical values are unchanged; genuine changes append a revision. Initial release values never get overwritten by later observations. `previousAtRelease`, `consensusAtRelease`, and `consensusAsOf` are independent snapshot fields and null remains meaningful. Surprise is calculated only from actual plus legitimate consensus; previous is never substituted.

Release watching requires a fresh target-period observation after the scheduled event. Revision histories retain every input ID. Signal snapshots record methodology version and explicit release/observation inputs. The audit detects timestamp impossibilities, vintage regression, look-ahead in previous values, release/initial mismatches, duplicate observations, frequency mismatch, provenance gaps, and cross-provider disagreement without auto-correcting facts.

## 9. Tests

Final acceptance on 2026-08-30:

- `npm test`: 117 passed, 0 failed.
- `npm run build`: passed; all four Macro routes compiled. Google Fonts download optimization was skipped because the external stylesheet was unavailable, with no compile failure.
- `npx tsc --noEmit`: passed.
- SQLite and generated PostgreSQL `prisma validate`: passed.
- Docker Compose expansion: passed with validation-only secrets.
- Formal BLS, FRED, BEA, EIA, Eurostat, and ECB backfills plus a complete autonomous scheduler cycle completed; the local database contains 7,491 observations across 31 enabled sources.
- `npm run macro:audit`: passed with 0 severe issues and 0 warnings.

Fixture coverage includes calendar identity/reschedule behavior, point-in-time watch rules, provider parsing/errors/key redaction, SDMX metadata, revision idempotency, FOMC evidence constraints, market quality, null presentation, macro alerts, backfill chunking, audit frequency checks, schema parity, and legacy research/consensus regression tests.

## 10. Known gaps

- Consensus ingestion is intentionally nullable because no licensed economic-consensus provider has been selected. Surprise alerts do not fire without it.
- Twelve Data requires a licensed account/key; market prices are not official settlement/reference data.
- Policy-document ingestion currently covers the Federal Reserve only. ECB policy rates are covered, but ECB statement/minutes parsing is not.
- Euro-area release calendars are not yet registered, although their time series and website indicator pages are available.
- Scheduler overlap protection is process-local. Production is safe at one replica; horizontal scheduler scaling needs a distributed database lease.
- Historical vintages depend on what each official provider exposes. ALFRED supports explicit vintages; providers that return only current history receive Tline fetch-time vintages from the first managed backfill onward.

## 11. Recommended next phases

1. Run a staged production backfill by country/provider, oldest-first, with audit after each batch; keep concurrency at 1–2 until provider quotas are observed.
2. Add a licensed economic-consensus feed and persist provider/as-of evidence before enabling surprise alerts in production.
3. Add Eurostat/ECB release-calendar families and ECB policy-document collection while preserving the same release and source-quote contracts.
4. Add chart-ready server queries or cached read models only after production volume proves Prisma page queries insufficient; do not duplicate facts in frontend state.
5. Establish freshness SLOs and alert on `macro.status=degraded`, failed JobRuns, stale sync states, and severe audit output.
6. Introduce a PostgreSQL advisory-lock/lease only if more than one scheduler replica becomes operationally necessary.
7. After real data accumulates, calibrate revision windows and source-specific stale thresholds from observed publication behavior, without changing historical vintages.
