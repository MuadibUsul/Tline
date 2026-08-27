# Deployment

The production baseline is a Node.js application, PostgreSQL 16, a private persistent document volume, and one scheduler process. SQLite and the local `storage/` directory remain the zero-infrastructure development path.

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

Health: `GET /api/health` returns `200` only when the database responds and the private-storage adapter configuration initializes. Docker uses the same endpoint for readiness; storage-vendor monitoring should separately probe its service endpoint.

## Background ingestion

The `scheduler` service runs one robots-compliant ingestion pass at startup and then every six hours. Configure:

- `INGEST_INTERVAL_MS` — minimum 60 seconds, default 21,600,000.
- `INGEST_ARTICLE_LIMIT` — per-institution discovery cap, default 6.
- `JOB_RETRY_LIMIT` / `JOB_RETRY_DELAY_MS` — bounded attempts and linear backoff.
- `JOB_FAILURE_WEBHOOK_URL` — optional internal alert endpoint after all attempts fail.

Every pass creates a `JobRun` record with parameters, final status, metrics, timestamps, and a bounded error message. Source-level results also remain available as structured process logs. Run exactly one scheduler replica unless a distributed lock is introduced.

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
