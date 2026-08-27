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
- **Auth + interactive Watchlist/Alerts**: production supports database-backed Auth.js OAuth
  with Microsoft Entra ID or Google; local development retains an explicitly gated demo sign-in.
  `/watchlist` and `/alerts` are gated and interactive via **Server Actions** (`src/app/actions.ts`):
  ＋Watch / remove on asset & institution pages, create / toggle / delete alert rules
  (evaluated immediately). Consensus rules: `CONSENSUS_ABOVE` / `BELOW` / `DROP_24H` /
  `RISE_24H`, 12h de-dup — see `src/lib/alerts.ts`. Roles and commercial tiers are independent.
- **AI Research (Phase 2)**: `/search` answers natural-language questions **over the
  structured DB, never a web search** (`src/lib/research.ts`). A deterministic intent
  router (`TARGET_CHANGES` / `WHY_DIRECTION` / `WHO_CHANGED` / `CONSENSUS_LEVEL` /
  keyword) retrieves evidence with source citations; when `ANTHROPIC_API_KEY` is set,
  an LLM synthesizes the summary from that evidence only. Bilingual (CN/EN) queries.
- **Consensus engine** (`src/lib/consensus.ts`): `raw = Σ(wᵢ·dᵢ·dirᵢ)/Σ(wᵢ·dᵢ)` → `score = (raw+2)/4×100`.
  Weight = institution authority (5★=1.0 / 4★=0.85 / 3★=0.7); decay = `exp(-ageDays/31)`
  (7d≈0.80, 30d≈0.39). Snapshots to `consensus_history` drive the 1D/7D/30D deltas.
- **Ingestion pipeline** (`src/lib/ingest/`): RSS, Sitemap/Sitemap Index, native PDF and
  HTML-listing discovery; research-path/date quality gates; three-hash dedup; source-run status;
  structured persistence and per-source failure isolation. Live validation currently contains
  31 complete articles from 15 institutions: ING, UBS, Scotiabank, J.P. Morgan, RBC, Saxo, UOB,
  OCBC, Nomura, Pictet, MUFG, Apollo, TD, Standard Chartered and SEB.
- **Robots compliance (strict)**: `scripts/robots_audit.py` audits all 64 sources' robots.txt
  → `64机构爬虫合规评估.xlsx` + `data/crawl_policy.json` (allowed/delayed/blocked/manual +
  Crawl-delay). The crawler (`run.ts`) only touches `allowed`/`delayed` institutions, and
  **re-checks robots.txt live at crawl time** (`robots.ts`: User-agent groups, longest-match
  Allow/Disallow, `*`/`$` wildcards) — skipping any disallowed URL and honoring Crawl-delay.
  Result of the audit: 59 crawlable, 1 robots-blocked (Janus Henderson), 4 manual
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
- **Forecast accuracy foundation**: supported horizons become pending forecasts, CSV price
  observations settle against one vendor source, and `/institution/[slug]/accuracy` discloses
  directional accuracy and target error. Publishing scores waits for a licensed price feed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run db:seed` | Load the 64 institutions + asset dictionary |
| `python scripts/robots_audit.py` | Re-audit robots.txt for all 64 → Excel + `data/crawl_policy.json` |
| `npm run ingest` | Live-crawl compliant priority-1 sources (`-- --slug=ubs`, `-- --all`, `-- --limit=3`); blocked/manual are refused |
| `npm run consensus` | Recompute + snapshot all asset consensus, then evaluate alerts |
| `npm run translate` | Translate/review pending articles and build ready bilingual PDFs |
| `npm run documents` | Rebuild article PDF assets |
| `npm run forecasts` | Sync supported forecast horizons and settle due observations |
| `npm run prices:import -- --file=prices.csv --source=vendor` | Import `ticker,timestamp,value` observations |
| `npm run alerts` | Seed/refresh the demo user's watchlist + rules and fire alerts |

> **Live ingest note:** the application does not seed synthetic research. A source appears
> only after its public article passes URL, publication-date, full-body and document checks.
> Per-institution `rssUrl`/`sitemapUrl` + tuned selectors are the natural next step.

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
src/app/                  Next.js App Router pages + components
```

## Roadmap

The maintained milestone sequence, acceptance gates, bilingual-content policy, PDF contract,
and page matrix live in [`plan20260827.md`](./plan20260827.md).
