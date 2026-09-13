# Deployment

The production baseline is a Node.js application, PostgreSQL 16, a private persistent document volume, one research scheduler, and one Macro Intelligence scheduler. SQLite and the local `storage/` directory remain the zero-infrastructure development path.

## Local development

```bash
npm ci
cp .env.example .env
npm run setup
npm test
npm run dev
```

`npm run env:check` validates the active development configuration. Development data can be recreated with `npm run setup`.

## Docker production baseline

Set secrets in the shell or an untracked `.env` file used by Docker Compose:

```bash
POSTGRES_PASSWORD=<random-database-password>
AUTH_SECRET=<at-least-32-random-characters>
```

Then run:

```bash
docker compose up --build -d
docker compose exec app npm run db:seed
docker compose ps
```

The app starts only after environment validation and `prisma migrate deploy`. The generated PostgreSQL Prisma schema is derived from `prisma/schema.prisma`; the checked-in SQL migration is under `prisma/postgresql/migrations/`.

Macro Intelligence tables are introduced by `20260829000000_macro_intelligence`. They share the application database but remain independent from Article ingest and Consensus tables. Development continues to use `prisma db push`; production must regenerate `prisma/postgresql/schema.prisma` and run the versioned PostgreSQL migrations before any future Macro provider or scheduler is enabled.

Official macro sync is available both on demand and through the dedicated `macro-scheduler` service. Configure `BLS_API_KEY` (optional), plus `BEA_API_KEY`, `FRED_API_KEY`, and `EIA_API_KEY` for the providers being run, then use `npm run macro:sync -- --provider=bls` or `npm run macro:sync -- --all`. Keys are sent only to their provider API and are excluded from structured logs and stored payloads.

Run `npm run macro:calendar` to refresh future releases. It is safe to repeat: official event identities are deterministic, reschedules update the existing row, and events missing from a later feed are retained for review instead of silently cancelled. `FRED_API_KEY` enables date-level fallback when an agency calendar is unavailable; a FRED release date is not treated as proof that observations are already available from FRED. The command reports release families with no future candidate and records its metrics in `JobRun`.

Health: `GET /api/health` returns `200` only when the database responds and the private-storage adapter configuration initializes. A failed or stale Macro job is reported as `status=degraded` without taking the web application out of service.

**The detailed body is gated.** Anonymous callers — including the container healthcheck and any uptime probe — receive `{ "status": "ok" | "degraded" }` and nothing else, because job errors, provider names and sync states describe internal infrastructure. Crawlable-source status, latest ingest metadata, Macro job freshness and provider/release-watcher sync states are returned only to an admin session, or to a caller presenting `Authorization: Bearer $HEALTH_DETAIL_TOKEN`. The gate also keeps the anonymous path down to three cheap queries instead of ten.

## Alert delivery

Fired alerts are POSTed as JSON to the rule owner's webhook (`/watchlist` → Alert delivery),
falling back to `ALERT_WEBHOOK_URL`. Delivery state lives on `AlertEvent`
(`deliveryStatus`, `deliveryAttempts`, `deliveryError`) and is shown next to each trigger, so
an alert that never reached anyone reads as `failed` rather than looking delivered. A rule
whose owner set no destination is marked `skipped`, which is not a failure.

Destinations are user-supplied, so every POST is fenced: https only, no embedded
credentials, no redirect following, and the hostname is rejected if it resolves to loopback,
private, link-local or carrier-grade-NAT space — `169.254.169.254` included. Delivery runs in
the same pass as evaluation (`macro:alerts`) and retries up to `ALERT_DELIVERY_ATTEMPTS`.

## Content reprocessing

Analyses are graded against the article body at parse time (`validateAnalysisGrounding`): a
figure, institution or absolute claim the article never contains marks the analysis
`needs_review`. This flags, it never withholds — publication still turns only on source text
and PDF readiness.

Operators re-run a specific report from the quality notice on its page. The request is
queued on `ContentRetry` and drained by the scheduler ahead of the routine backlog, and the
outcome is recorded with the score before and after, so a rerun that did not help is visible
as such.

```bash
npm run analysis:grounding            # report; --apply writes reviewStatus
npm run translate:rescore             # report; --apply rewrites qualityScore/status
npm run retries -- --enqueue-backlog  # queue everything below the quality bar
npm run retries -- --batch=5          # drain (also runs each scheduler pass)
```

Re-score after any change to `validateTranslation` or `validateAnalysisGrounding`: stored
scores are written at generation time and otherwise keep reflecting the retired rules.

## Macro Intelligence scheduler

`macro-scheduler` is a separate process; the Next.js app never starts timers. It runs calendar refresh, regular provider sync, release watching, two-year revision checks, policy-document sync, and alert evaluation. Configure the corresponding `MACRO_*_INTERVAL_MS` variables from `.env.example`, plus `MACRO_JOB_RETRY_LIMIT` and `MACRO_JOB_RETRY_DELAY_MS`. Each child command records a `JobRun`; the scheduler prevents a second instance of the same job from overlapping within its process and applies bounded linear retry.

Run exactly one `macro-scheduler` replica. Compose declares one service instance; platforms with autoscaling must pin it to one replica until a distributed lease is added. Graceful `SIGTERM`/`SIGINT` handling forwards termination to active jobs and waits for their exit.

## Background ingestion

The `scheduler` service continuously selects due sources. Network-bound sources run with bounded concurrency while sources on the same publisher domain remain serial; RSS, static and rendered sources default to 60, 180 and 600 second checks. Failed sources use bounded exponential backoff. Known article URLs are not downloaded again. A separate processing loop advances pending parse, translation, and document work every five minutes, so publication does not wait for a full source sweep. The scheduler recovers interrupted ingest records on restart and uses a stale-safe local PID lock to prevent duplicate processes within one host/container. Configure:

- `INGEST_INTERVAL_MS` — scheduler heartbeat, minimum and default 60 seconds.
- `INGEST_CONCURRENCY` — cross-domain discovery concurrency, default 8 and maximum 16; each publisher domain remains serial.
- `INGEST_SOURCE_SECONDS` — hard budget per source, default 90 seconds, so one slow publisher cannot monopolize a worker.
- `INGEST_ARTICLE_LIMIT` — per-institution discovery cap, default 6.
- `INGEST_WINDOW_HOURS` — rolling discovery window, default 168 hours (seven days). Anything published earlier is skipped rather than parsed, translated and analysed. `npm run ingest -- --hours=N` or `--since=<date>` overrides it for a one-off backfill.
- `PROCESS_ARTICLE_LIMIT` — maximum queued articles processed per pass, default 50.
- `REPARSE_CONCURRENCY` / `TRANSLATION_CONCURRENCY` — bounded AI concurrency, default 3 and maximum 8; size these against provider RPM/TPM limits.
- `REPARSE_CONCURRENCY` / `TRANSLATION_CONCURRENCY` — bounded model-worker concurrency, default 3 and maximum 8.
- `JOB_RETRY_LIMIT` / `JOB_RETRY_DELAY_MS` — bounded attempts and linear backoff.
- `JOB_FAILURE_WEBHOOK_URL` — optional internal alert endpoint after all attempts fail.

Every pass creates a `JobRun` record with parameters, final status, metrics, timestamps, and a bounded error message. Source-level results also remain available as structured process logs. Run exactly one scheduler replica unless a distributed lock is introduced.

Before enabling or after changing sources, run the read-only coverage audit:

```bash
npm run ingest:probe -- --sample=3 --render --output=data/crawl-probe.json
```

`ready` means at least one sampled candidate passed date, full-body and research-topic gates; `empty` is a discovery/content mismatch; `paused` is a current robots/access/render gate; `refused` is a runtime Disallow. The report does not write articles or mutate source status.

Probe output is never consumed by the scheduler. After acceptance, persist every stable entry point and filter in `data/institutions.json` or `src/lib/ingest/sourceRules.ts`, add a regression test, seed the registry, and rerun the probe once. Runtime ingestion must remain deterministic without an LLM/API token; model keys are used only by the separate parse/translation stages.

## Documents and backups

`document-storage` is private and must never be published by the web server. Downloads pass through the permission manager and application route. Native PDFs are rejected when they exceed the configured byte limit, are encrypted, or contain active/embedded content tokens.

Back up PostgreSQL and the document volume as one recovery set. `ArticleDocument.storageKey` is metadata only; a database restore without the matching volume is incomplete. Test restores regularly and retain the original file hashes for integrity checks.

The application depends only on the `DocumentStorage` interface. It includes local-volume and S3-compatible private adapters. Select S3 with `DOCUMENT_STORAGE_DRIVER=s3` plus `S3_BUCKET` and `S3_REGION`; optional endpoint and path-style settings support compatible providers. Downloads are authorized first and then redirected to a 30–900 second signed URL. Objects never receive a public ACL or permanent public URL.

## Authentication boundary

The email-only session is a preview mechanism and is disabled in production unless `ALLOW_INSECURE_DEMO_AUTH=true` is explicitly set. Formal database-backed OAuth supports `AUTH_PROVIDER=azure-ad` or `google`; configure its client ID/secret, `NEXTAUTH_URL`, and optionally `AUTH_ALLOWED_EMAIL_DOMAINS`. Keep preview auth disabled on public deployments. Roles (`member`, `reviewer`, `admin`) are separate from future commercial tiers, and state-changing user actions are written to `AuditLog`.

Register `${NEXTAUTH_URL}/api/auth/callback/azure-ad` for Microsoft Entra ID or `${NEXTAUTH_URL}/api/auth/callback/google` for Google. Only one provider is enabled per deployment by the current configuration.

## Market data

`macro:market` provisions the instrument table and pulls one quote per enabled symbol into
`MarketObservation`. It requires `TWELVE_DATA_API_KEY`; without one it reports
`configured: false` and skips, which is a configuration state rather than a failed job.
`TWELVE_DATA_QUALITY` must match the account entitlement (`DELAYED` by default). The
scheduler runs it on `MACRO_MARKET_SYNC_INTERVAL_MS`, 30 minutes by default.

**Watch the request budget.** One pass costs one request per instrument. Twelve Data's
free tier allows 800 a day, which seven instruments at 30 minutes uses ~336 of, leaving
room for a backfill and manual runs. At 15 minutes it is 672 — under the cap with no
headroom. Only raise the frequency on a paid plan.

The recurring pass stores one current quote per instrument. Settlement also needs history,
so backfill a daily series once per deployment:

```bash
npm run macro:market -- --from=2026-01-01
```

`MarketObservation` and `MacroObservation` are both raw provider tables; settlement reads
only `PriceObservation`. `src/lib/prices/bridge.ts` is the join, and it is deliberately
narrow: only macro series that are genuinely the price of a tradeable asset are bridged
(`DCOILWTICO` → WTI), because a CPI index or an unemployment rate is not the price of
anything. Market quotes are rolled up to one price per UTC day, taken from the last quote
observed that day. Each asset draws from exactly one source, since settlement matches a base
and an actual from the same `source` string.

## Forecast settlement

Forecast rows are created from each extracted asset call whose time horizon can be resolved
to a date (`src/lib/forecastHorizon.ts`). Institutions write horizons in prose —
`short_term`, `3-6 months`, `H2 2026`, `2026年12月` — so ranges settle at their midpoint and
qualitative bands use the conventional reading (near/short 30d, medium 90d, long 365d). A
horizon the institution never actually gave (`coming quarters`, `over time`) yields no
forecast: inventing a date would fabricate the accuracy record the table exists to measure.

**Scope.** Only `equity`, `fx`, `commodity` and `crypto` forecasts are scored
(`SETTLEABLE_ASSET_CLASSES`). `rate` and `macro` are excluded on purpose: an institution
"bullish on 10Y Treasuries" means yields *fall*, but the only available series is the yield
itself, so scoring direction against it inverts the verdict; and a Fed or inflation stance
has no price to settle against at all. Those forecasts stay pending and the accuracy page
reports them as out of scope rather than publishing a confidently backwards number.

Settlement itself needs prices. FRED and the market feed cover commodities and FX; equity
indices (SPX, NDX) need a paid index licence. Import licensed end-of-day observations as
`ticker,timestamp,value`, then run it:

```bash
npm run prices:import -- --file=/private/path/prices.csv --source=vendor-name
npm run forecasts
```

The settlement job uses observations from the same named source at forecast start and target, rejects gaps beyond `PRICE_SETTLEMENT_TOLERANCE_DAYS` (default 7), and leaves unmatched forecasts pending. The CSV importer is an operational boundary, not a market-data license or downloader.

## Backup and restore

`npm run backup` writes a timestamped snapshot to `backups/<UTC stamp>/` containing the
database, the local document volume, and a `manifest.json` with SHA-256 checksums.

```bash
npm run backup                      # snapshot, then prune to the newest 7
npm run backup -- --out /srv/backups --keep 30
npm run backup:verify -- backups/20260902T102516Z
```

**Consistency rule.** The database is captured *before* the documents. Documents are
content-addressed and never rewritten, so a file created between the two steps is an
orphan the next snapshot picks up. The reverse order would produce the failure that
actually hurts: rows referencing documents the snapshot never captured.

- **SQLite** uses `VACUUM INTO`, which is consistent while the schedulers keep writing.
- **PostgreSQL** uses `pg_dump --format=custom` (requires `pg_dump` on PATH).
- **S3 document storage** is *not* copied — bucket versioning and replication own it.
  The manifest records this as a skip rather than pretending the files were captured.

Restore checklist:

1. `npm run backup:verify -- <snapshot>` — refuse to restore an unverified snapshot.
2. Stop `app`, `scheduler`, and `macro-scheduler` so nothing writes during the restore.
3. Database — SQLite: copy `database.sqlite` over `prisma/dev.db`. PostgreSQL:
   `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" database.dump`.
4. Documents: copy `documents/` back over `DOCUMENT_STORAGE_ROOT`.
5. `npx prisma migrate deploy --schema prisma/postgresql/schema.prisma` to reapply any
   migrations newer than the snapshot.
6. Restart the services and confirm `/api/health` reports both workers `ok`.

## Operational checks

Before release:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run env:check:production
```

The final environment check intentionally fails when production still uses SQLite, a weak session secret, or an unregistered storage driver. CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull request.
# 行情与宏观预期增量上线

1. 备份数据库并先发布兼容代码；不要对生产执行 `prisma db push`。
2. 生成并核对双 schema：`npm run db:postgres:schema`。
3. 在测试 PostgreSQL 执行 `npm run db:postgres:deploy`，再运行 typecheck/test/build 和只读页面检查。
4. 生产维护窗口执行同一 migrate deploy。新增迁移是 `20260913180000_market_macro_data_loop`，仅新增表、索引、外键和带兼容默认值/可空字段。
5. 在后台录入并核验 `DataLicensePolicy` 后才启用数字用途；旧数据默认 UNKNOWN，不做授权回填。
6. 配置 `TWELVE_DATA_API_KEY` 后启动既有 macro-scheduler。无 key 时行情任务安全跳过，研报与官方宏观功能继续运行。
7. `FRED_DATA_USE_CONFIRMED` 默认 false；只有完成当前 FRED API 条款及具体第三方序列授权复核后才设为 true。BEA/BLS/EIA/ECB/Eurostat 的直接官方管线不依赖此开关。

预算示例：10 个标的，每轮 quote 权重 1、30 分钟一次，理论基础用量约 `10 × 48 = 480 credits/day`，还必须为失败重试和回填留余量。实际计费以供应商账户和端点规则为准。`MARKET_BUDGET_PER_MINUTE` 默认 8，`MARKET_BUDGET_PER_DAY` 默认 800，`MARKET_BUDGET_RESET_TIMEZONE` 默认 UTC；端点权重由 `MARKET_QUOTE_ENDPOINT_WEIGHT` 与 `MARKET_TIME_SERIES_ENDPOINT_WEIGHT` 配置。

停用/回滚：停止 macro-scheduler 或移除 `TWELVE_DATA_API_KEY`；将映射 `enabled=false`；将授权状态改为 RESTRICTED。无需删除观测。应用可回滚到旧版本，但数据库新增结构保留，避免破坏已采集证据。
