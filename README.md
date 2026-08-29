# Institutional Intelligence — Phase-1 MVP

> Turn institutional research into actionable signal.
> **Research → Data → Consensus → Signal**

A lightweight institutional-research intelligence platform. It ingests **public, no-login**
research from major financial institutions, structures every article into signals
(asset · direction · target · confidence), and aggregates them into an
**authority-weighted, time-decayed Institutional Consensus score (0–100)** per asset.

This is the Phase-1 slice of the [master product plan](./plan20260827.md) — see `全球机构免费研究源清单_64家.xlsx`
for the 64-source universe (15 flagged as phase-1 priority).

Execution source of truth: [`plan20260827.md`](./plan20260827.md). Technical architecture and
implementation boundaries: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Production containers, PostgreSQL migrations, health checks, scheduler, and backup boundaries:
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Quick start

```bash
npm install
cp .env.example .env          # SQLite by default, zero infra
npm run db:push               # create the schema
npm run db:seed               # 64 institutions + asset dictionary
npm run ingest -- --slug=ing --limit=3  # ingest verified public research
npm run dev                   # http://localhost:3000
```

Or, in one shot after `npm install`: `npm run setup && npm run dev`.

## What runs today

- **Core pages**, all reading live data: Home (Market Consensus + Feed),
  `/asset/[ticker]`, `/institution/[slug]`, `/research/[id]`, plus `/markets`,
  `/institutions`, `/consensus` indexes.
- **Unified Monitoring Center**: production supports database-backed Auth.js OAuth
  with Microsoft Entra ID or Google; local development retains an explicitly gated demo sign-in.
  `/watchlist` combines followed assets, institutions, trading themes, rules and recent triggers;
  legacy `/alerts` redirects there. **Server Actions** (`src/app/actions.ts`) create / toggle / delete rules
  (evaluated immediately). Consensus rules: `CONSENSUS_ABOVE` / `BELOW` / `DROP_24H` /
  `RISE_24H`; new-research rules monitor an asset, institution or theme — see `src/lib/alerts.ts`.
- **Site-wide fuzzy search**: the home search instantly ranks institutions, assets and
  English/Chinese research content. It supports aliases, partial terms and common typos,
  with keyboard navigation and no separate search page or LLM dependency.
- **Consensus engine** (`src/lib/consensus.ts`): only research published in the rolling
  last 24 hours is eligible. `raw = Σ(wᵢ·dᵢ·dirᵢ)/Σ(wᵢ·dᵢ)` → `score = (raw+2)/4×100`;
  authority weighting and within-window recency decay remain. Snapshots to
  `consensus_history` drive the 1D/7D/30D deltas.
- **Ingestion pipeline** (`src/lib/ingest/`): RSS, Sitemap/Sitemap Index, native PDF and
  HTML-listing discovery; publisher-declared feeds; direct/embedded PDFs; static and normally
  rendered public pages; research-path/date/full-body gates; three-hash dedup and per-source
  failure isolation. `ingest:probe` audits all 59 policy-crawlable sources without writing
  articles. Real ingest records `succeeded`, `empty`, `paused`, `refused` or `failed` instead
  of treating a zero-result run as success.
  Stable site exceptions live in `sourceRules.ts`; scheduled crawling never uses an LLM to
  explore sites. Probing is an acceptance/maintenance tool only. Ingest is clamped to the
  current month and stores raw English content before any AI processing.
- **Robots compliance (strict)**: `scripts/robots_audit.py` audits all 64 sources' robots.txt
  → `64机构爬虫合规评估.xlsx` + `data/crawl_policy.json` (allowed/delayed/blocked/manual +
  Crawl-delay). The crawler (`run.ts`) only touches `allowed`/`delayed` institutions, and
  **re-checks robots.txt live at crawl time** (`robots.ts`: User-agent groups, longest-match
  Allow/Disallow, `*`/`$` wildcards) — skipping any disallowed URL and honoring Crawl-delay.
  Result of the maintained source set: 58 crawlable and 4 manual
  (BlackRock/Neuberger/Mizuho/BofA — sites that block automated access; never bypassed).
- **Cleaning**: aggressive boilerplate stripping + paragraph-density body selection
  (`extract.ts`), gates that reject nav/menu dumps, thin JS shells, disclaimer-only pages,
  unrelated footer PDFs and non-research operational documents
  (`isJunk`/`looksLikeArticle`, enforced in `store.ts`), word-boundary alias matching, and
  scored+capped asset tagging (`parseLLM.ts`). Accurate per-asset direction needs the real
  LLM parser (set `ANTHROPIC_API_KEY`).
- **Bilingual documents**: permanent clean English text and reviewed Chinese translations in
  the database, plus private English/Chinese PDFs. Native source PDFs remain byte-identical;
  their Chinese versions preserve page structure where quality checks allow it.
- **Pluggable LLM boundary** (`src/lib/llm/`): deterministic parser without a key; Anthropic,
  OpenAI or DeepSeek for parsing, translation, correction and review when configured.
- **Evidence-backed atomic views**: configured LLMs decompose a report into bilingual,
  independently searchable views. Every row must retain a direct quote found in the stored source;
  unsupported numbers, invalid labels, duplicates and weakened conditional language are rejected.
- **Explainable view ranking**: `/institutions` is an institutional-view wire ranked strictly by
  seven-day asset/topic heat (including active official events and cross-institution coverage),
  then institution authority/rating, then exponential freshness. Each row exposes the components.
- **Forecast accuracy foundation**: supported horizons become pending forecasts, CSV price
  observations settle against one vendor source, and `/institution/[slug]/accuracy` discloses
  directional accuracy and target error. Publishing scores waits for a licensed price feed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run db:seed` | Load the 64 institutions + asset dictionary |
| `python scripts/robots_audit.py` | Re-audit robots.txt for all 64 → Excel + `data/crawl_policy.json` |
| `npm run ingest` | Live-crawl compliant sources (`-- --slug=ubs`, `-- --all`, `-- --limit=3`, `-- --resume-minutes=60`); blocked/manual are refused |
| `npm run ingest:probe -- --sample=3 --render --output=data/crawl-probe.json` | Read-only live coverage audit with discovery, quality-gate and access-failure evidence |
| `npm run consensus` | Recompute + snapshot all asset consensus, then evaluate alerts |
| `npm run translate` | Translate articles missing Chinese output and build ready bilingual PDFs (`--retry-review` is explicit) |
| `npm run documents` | Rebuild article PDF assets |
| `npm run forecasts` | Sync supported forecast horizons and settle due observations |
| `npm run prices:import -- --file=prices.csv --source=vendor` | Import `ticker,timestamp,value` observations |
| `npm run alerts` | Seed/refresh the demo user's watchlist + rules and fire alerts |
| `npm run reparse -- --limit=20` | Parse articles missing analysis; use `--retry-review` or `--all` only when explicitly intended |

> **Live ingest note:** the application does not seed synthetic research. A source appears
> only after its public article passes URL, publication-date, full-body and document checks.
> A current robots/access gate can still pause a source that passed the historical spreadsheet
> audit. The crawler never clicks consent/login gates or bypasses WAF/CAPTCHA; rerun
> `ingest:probe` to distinguish a code regression from an external access-state change.

## Deviations from the blueprint (deliberate, for a runnable MVP)

| Blueprint | MVP | Why |
|---|---|---|
| Python crawler worker | All-TypeScript | One language, one `npm run` |
| PostgreSQL + pgvector | SQLite locally, PostgreSQL 16 in production | Zero-infra development; versioned production migrations; pgvector only when needed |
| Real LLM parse | Mock parser default, real when key set | Pipeline runs with no API key |

## Layout

```
prisma/schema.prisma      application data model; generated PostgreSQL schema + migrations
data/institutions.json    64 sources derived from the source-list xlsx
src/lib/                  auth, storage, documents, translation, forecast, consensus, queries
src/lib/ingest/           fetch, robots, sitemap, extract, parse, store, jobs
src/lib/ingest/sourceRules.ts  committed, tested exceptions for accepted existing sources
src/app/                  Next.js App Router pages + components
```

## Roadmap

The maintained milestone sequence, acceptance gates, bilingual-content policy, PDF contract,
and page matrix live in [`plan20260827.md`](./plan20260827.md).
