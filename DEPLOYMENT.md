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

Health: `GET /api/health` returns `200` only when the database responds and the private-storage adapter configuration initializes. It also exposes crawlable-source status, latest ingest metadata, Macro job freshness, and provider/release-watcher sync states. A failed or stale Macro job is reported as `macro.status=degraded` without taking the web application out of service.

## Macro Intelligence scheduler

`macro-scheduler` is a separate process; the Next.js app never starts timers. It runs calendar refresh, regular provider sync, release watching, two-year revision checks, policy-document sync, and alert evaluation. Configure the corresponding `MACRO_*_INTERVAL_MS` variables from `.env.example`, plus `MACRO_JOB_RETRY_LIMIT` and `MACRO_JOB_RETRY_DELAY_MS`. Each child command records a `JobRun`; the scheduler prevents a second instance of the same job from overlapping within its process and applies bounded linear retry.

Run exactly one `macro-scheduler` replica. Compose declares one service instance; platforms with autoscaling must pin it to one replica until a distributed lease is added. Graceful `SIGTERM`/`SIGINT` handling forwards termination to active jobs and waits for their exit.

## Background ingestion

The `scheduler` service continuously selects due sources. Network-bound sources run with bounded concurrency while sources on the same publisher domain remain serial; RSS, static and rendered sources default to 60, 180 and 600 second checks. Failed sources use bounded exponential backoff. Known article URLs are not downloaded again. A separate processing loop advances pending parse, translation, and document work every five minutes, so publication does not wait for a full source sweep. The scheduler recovers interrupted ingest records on restart and uses a stale-safe local PID lock to prevent duplicate processes within one host/container. Configure:

- `INGEST_INTERVAL_MS` — scheduler heartbeat, minimum and default 60 seconds.
- `INGEST_CONCURRENCY` — cross-domain discovery concurrency, default 8 and maximum 16; each publisher domain remains serial.
- `INGEST_SOURCE_SECONDS` — hard budget per source, default 90 seconds, so one slow publisher cannot monopolize a worker.
- `INGEST_ARTICLE_LIMIT` — per-institution discovery cap, default 6.
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

## Forecast settlement

Import licensed end-of-day observations as `ticker,timestamp,value`, then run settlement:

```bash
npm run prices:import -- --file=/private/path/prices.csv --source=vendor-name
npm run forecasts
```

The settlement job uses observations from the same named source at forecast start and target, rejects gaps beyond `PRICE_SETTLEMENT_TOLERANCE_DAYS` (default 7), and leaves unmatched forecasts pending. The CSV importer is an operational boundary, not a market-data license or downloader.

## Operational checks

Before release:

```bash
npm test
npx tsc --noEmit
npm run build
npm run env:check:production
```

The final environment check intentionally fails when production still uses SQLite, a weak session secret, or an unregistered storage driver.
