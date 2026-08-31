# Tline Macro Intelligence — Coding Agent Prompt Pack

## Prompt 0 — 全局约束 / Master Prompt

你正在修改项目 `Tline / institutional-intelligence`。

首先完整阅读以下文件，再修改任何代码：

- `README.md`
- `ARCHITECTURE.md`
- `DEPLOYMENT.md`
- `plan20260827.md`
- `20260829ST.md`
- `package.json`
- `prisma/schema.prisma`
- `scripts/generate-postgres-schema.mjs`
- `scripts/scheduler.mjs`
- `src/lib/db.ts`
- `src/lib/jobs.ts`
- `src/lib/audit.ts`
- `src/lib/alerts.ts`
- `src/lib/consensus.ts`
- `src/lib/forecast.ts`
- `src/lib/llm/provider.ts`
- `src/lib/ingest/*`

目标是在现有项目中增量加入 `Macro Intelligence` 数据域。

当前项目核心 Research 管线必须保持兼容：

Research → ingest → Article/Analysis/ArticleAsset/AtomicView → Institutional Consensus → Alerts

新增 Macro 管线：

Official Data APIs
→ Macro Provider
→ Normalize
→ MacroObservation
→ MacroRelease
→ Revision/Vintage
→ Macro Signal

Central-bank official documents
→ MacroPolicyDocument
→ deterministic extraction
→ LLM structured parsing

必须遵守：

1. 不把结构化宏观 API 数据写进 `Article`。
2. 不把 BLS/BEA/FRED/ECB 等 API 返回送进现有 article extract pipeline。
3. 不改变现有 `consensus.ts` 的评分意义或算法，除非后续 Prompt 明确要求。
4. 现有 Institutional Consensus 和新增 Macro Signal 必须保持独立。
5. 所有官方数值数据优先 API/SDMX/CSV/JSON，HTML 抓取只用于没有结构化接口的政策声明/公告正文。
6. 不绕过登录、验证码、访问控制、robots 或反爬限制。
7. 官方来源优先于第三方 aggregator。
8. Third-party consensus/forecast 必须有明确 provenance；没有来源时保存 null，绝不让 LLM 猜 forecast。
9. 所有宏观 Observation 必须 revision-aware，不允许覆盖旧 vintage。
10. period time、scheduled release time、actual release time、fetched time、vintage time 必须区分。
11. 数据库内部时间统一 UTC，同时保存来源时区元数据。
12. 数值使用 Prisma Decimal 或不会造成浮点精度损失的表示，禁止无理由使用 JS float 持久化金融/宏观数值。
13. 所有 provider 必须支持 timeout、retry、rate limit、error normalization。
14. API key 只来自环境变量，不进入代码、日志、数据库 raw payload。
15. 所有同步必须幂等。
16. 所有新增表必须有合理 unique constraint/index。
17. 保留数据 provenance：provider、external ID、source URL、fetchedAt、raw/content hash。
18. PostgreSQL schema 必须继续遵守本项目既有 SQLite → PostgreSQL 生成流程。
19. 不进行无关重构。
20. 每个 Phase 完成后运行相关 tests、`npm test`、类型检查和 `npm run build`；若已有失败，明确区分 pre-existing 与新增 regression。
21. 为核心 normalization、revision、idempotency、provider parsing 编写 Node test。
22. 不删除既有测试。
23. 修改 `.env.example`，绝不打印真实 secrets。
24. 更新 `ARCHITECTURE.md` 与必要的部署文档。
25. 每个阶段结束输出：

- 修改文件
- 数据库变化
- 关键设计决定
- tests/build 结果
- 剩余风险
- 下一阶段接口

不要一次实现所有 Phase。只执行当前 Prompt 指定阶段。

# Prompt 1 — Repository Audit + Macro ADR

只执行审计和设计，不改业务代码。

任务：

1. 检查当前 `PriceObservation` 的真实 schema 和使用位置。
2. 检查 `JobRun`、AuditLog、alerts、scheduler、provider abstraction。
3. 检查 SQLite → PostgreSQL schema 生成与迁移机制。
4. 检查现有 HTTP fetch/robots/retry 工具中哪些可以安全复用，哪些应保持在 ingest domain。
5. 查找所有 `consensus.ts` 调用点，确认新增 Macro 模块不会改变其语义。
6. 检查 Web query pattern 和 Server Component pattern。
7. 输出一份 `docs/adr/ADR-macro-intelligence.md`。

ADR 必须回答：

- 为什么 Macro 是独立领域，而不是 Article ingest extension。
- 哪些基础设施复用。
- 哪些业务模型不能复用。
- PriceObservation 是扩展还是新增 MarketObservation。
- Revision/vintage 策略。
- Release/event 模型。
- PolicyDocument 模型。
- Provider fallback 策略。
- Official vs aggregator precedence。
- Consensus data provenance。
- Scheduler strategy。
- MVP 范围。

当前建议 MVP：

US:

- CPI
- Core CPI
- PPI
- NFP
- unemployment
- JOLTS
- PCE
- Core PCE
- GDP
- Personal Income/Spending
- Fed rate decision
- FOMC statement
- EIA crude inventories

暂不实现综合 Macro score。

完成后停止。

# Prompt 2 — Prisma Macro Schema

根据 ADR 实现宏观数据库模型。

建议至少包含：

MacroIndicator
MacroSeriesSource
MacroObservation
MacroRelease
MacroReleaseValue
MacroPolicyDocument
MacroSyncState

设计要求：

MacroIndicator:

- canonicalKey unique
- nameEn
- nameZh nullable
- countryCode
- currency nullable
- category
- frequency
- unit
- seasonalAdjustment nullable
- importance
- enabled
- createdAt
- updatedAt

MacroSeriesSource:

- indicatorId
- provider enum/string
- externalSeriesId
- dataset nullable
- tableCode nullable
- lineCode nullable
- priority
- sourceUrl nullable
- metadata Json nullable
- enabled
- unique constraints

MacroObservation:

- seriesSourceId
- period
- value Decimal
- vintageAt
- fetchedAt
- isInitial
- revisionNo
- status
- sourcePublishedAt nullable
- rawHash nullable
- metadata Json nullable

关键约束：

同 seriesSource + period + vintageAt 不得重复。
旧 observation 不得 UPDATE 覆盖。

MacroRelease:

- releaseKey unique
- releaseFamily
- countryCode
- currency nullable
- agency
- titleEn
- titleZh nullable
- scheduledAt
- sourceTimezone
- releasedAt nullable
- importance
- status
- sourceUrl nullable
- externalReleaseId nullable
- createdAt
- updatedAt

MacroReleaseValue:

- releaseId
- indicatorId
- observationPeriod
- actualInitial nullable
- previousAtRelease nullable
- revisedPreviousAtRelease nullable
- consensusAtRelease nullable
- consensusProvider nullable
- consensusAsOf nullable
- surpriseRaw nullable
- surprisePct nullable
- fetchedAt
- unique(releaseId, indicatorId)

MacroPolicyDocument:

- releaseId nullable
- centralBank
- docType
- meetingDate nullable
- publishedAt
- sourceUrl unique
- rawText
- contentHash
- parsedJson nullable
- provider nullable
- model nullable
- promptVersion nullable
- reviewStatus
- fetchedAt
- createdAt
- updatedAt

MacroSyncState:

- provider
- scopeKey
- cursor nullable
- etag nullable
- lastModified nullable
- lastAttemptAt nullable
- lastSuccessAt nullable
- lastStatus
- lastError nullable
- metadata Json nullable
- unique(provider, scopeKey)

要求：

- 检查 enum 是否在 SQLite/Postgres generation 下兼容。
- 必要时按照现有项目惯例使用 String 而不是引入不兼容 enum。
- 创建 migration。
- 更新 generated PostgreSQL schema/migration。
- 不改变现有 21 模型的行为。
- 加 schema-level validation tests（如项目已有类似机制）。

完成后运行测试和 build，然后停止。

# Prompt 3 — Macro Core + Registry

建立：

src/lib/macro/

- types.ts
- registry.ts
- normalize.ts
- store.ts
- revisions.ts

建立：

data/macro/sources.json
data/macro/indicators.json
data/macro/release-families.json

定义统一 Provider contract：

interface MacroProvider {
id: string;
fetchSeries(...): Promise<NormalizedObservation[]>;
fetchLatest?(...): Promise<NormalizedObservation[]>;
healthCheck(): Promise;
}

NormalizedObservation 至少：

- canonicalKey
- provider
- externalSeriesId
- period
- value
- unit
- frequency
- seasonalAdjustment
- vintageAt
- sourcePublishedAt?
- fetchedAt
- sourceUrl?
- rawHash?
- metadata?

实现：

1. canonical indicator registry。
2. provider → canonical indicator mapping。
3. deterministic normalization。
4. Decimal-safe numeric conversion。
5. UTC/timezone helpers。
6. content/raw hash。
7. idempotent upsert。
8. append-only vintage logic。
9. revision number calculation。
10. same-value later fetch 不产生虚假 revision。

测试必须覆盖：

- 首次 observation。
- 相同数据重复 ingest。
- 同 period 修订值。
- 第三次 revision。
- 不同 provider 同 canonical indicator。
- null/missing API values。
- precision。
- timezone。

不要接真实 Provider，完成 Core 后停止。

# Prompt 4 — US Official Providers

实现：

src/lib/macro/providers/

- types.ts
- bls.ts
- bea.ts
- fred.ts
- eia.ts

环境变量：

BLS_API_KEY=
BEA_API_KEY=
FRED_API_KEY=
EIA_API_KEY=

要求：

## BLS

至少映射：

US_CPI_HEADLINE
US_CPI_CORE
US_PPI
US_NFP
US_UNEMPLOYMENT_RATE
US_JOLTS_OPENINGS

使用官方 BLS API。
API key optional 时支持低额度模式（如果官方接口允许）。
禁止网页爬取数值。

## BEA

至少支持：

US_PCE_PRICE
US_CORE_PCE_PRICE
US_GDP
US_PERSONAL_INCOME
US_PERSONAL_SPENDING

使用 BEA Data API。
把 dataset/table/line mapping 放在 registry/config，而不是散布 hard-coded magic numbers。

## FRED

用途：

- historical backfill
- release metadata
- vintage/revision fallback
- series cross-check

实现 series observations。
支持 realtime/vintage 参数。
禁止把 FRED 无条件设为实时 Actual 的第一来源。

## EIA

使用 API v2。
至少提供原油/库存相关官方数据 adapter skeleton，并完整实现项目实际选择的一项核心 series。

所有 providers：

- timeout
- retry
- rate limiting
- structured error
- no secret logging
- user-agent
- injectable fetch for tests
- fixture-based tests

禁止在 tests 中依赖 live network。

新增 CLI：

npm run macro:sync -- --provider=bls
npm run macro:sync -- --provider=bea
npm run macro:sync -- --provider=fred
npm run macro:sync -- --provider=eia
npm run macro:sync -- --all

完成后停止。

# Prompt 5 — Economic Release Calendar

实现 release-centric Economic Calendar。

新增模块：

src/lib/macro/release.ts
src/lib/macro/calendar.ts

CLI：

npm run macro:calendar

任务：

1. 从官方/可信 release metadata 建立未来 MacroRelease。
2. releaseKey 必须 deterministic。
3. 重复 calendar sync 不得产生重复事件。
4. scheduledAt 使用 UTC。
5. 保存 sourceTimezone。
6. status 至少：
   SCHEDULED
   WAITING
   RELEASED
   DELAYED
   CANCELLED
   FAILED

首先实现美国：

- BLS CPI
- BLS Employment Situation
- BLS PPI
- BLS JOLTS
- BEA Personal Income and Outlays / PCE
- BEA GDP
- FOMC scheduled meetings
- EIA selected release

规则：

官方 agency calendar > FRED release metadata > manual configuration fallback。

FRED 的 release date 只能作为 metadata/fallback，不假设 scheduledAt 时刻数据一定已经可从 FRED API 获取。

为每个 Release Family 配置：

- canonical release family
- agency
- normal timezone
- indicators
- importance
- polling strategy

测试：

- DST。
- duplicate calendar sync。
- rescheduled event。
- missing release。
- same-day multiple releases。

完成后停止。

# Prompt 6 — Release Watcher + Actual Snapshot

实现：

scripts/macro-release-watch.ts

目标：

事件临近后动态轮询源 API，并生成 MacroReleaseValue。

polling 默认策略：

> 30m：
> 无需高频

30m–10m：
每 5 分钟

10m–release：
每 60 秒

release 后未取得：
每 30–60 秒有限重试

成功：
停止该事件高频 polling

必须可配置。

成功后写：

actualInitial
previousAtRelease
revisedPreviousAtRelease

要求：

1. actualInitial 永不随后续 revision 覆盖。
2. MacroObservation 继续保存新的 vintage。
3. ReleaseValue 保存“当时世界是什么样”的 snapshot。
4. 数据晚到时 releasedAt 与 scheduledAt 分开。
5. provider 返回异常/旧 observation 时不得把旧值误判为新 release。
6. 根据 target period 和 source published timestamp 判定。
7. 每次 release watch 写 JobRun。
8. 完整 structured logging。

consensusAtRelease 现在保持 null，除非已有合法明确的 provider。

完成后停止。

# Prompt 7 — FOMC Policy Documents + LLM Parser

实现：

src/lib/macro/policy/

- fetch.ts
- extract.ts
- types.ts
- parse.ts

数据源：

Federal Reserve FOMC 官方 calendar 和明确的 Statement / Implementation Note / Minutes 页面。

策略：

- 不做全站 crawler。
- 从 calendar 发现目标 meeting/document URL。
- 只获取相关官方公开页面。
- 保存 rawText。
- contentHash 去重。
- 同 URL 内容变更时留下审计记录。
- 如需 HTML fetching，遵守现有项目合规、限速和 retry 原则。

首先 deterministic extraction：

- target range
- rate change
- decision
- vote counts（可可靠解析时）

然后 LLM 解析：

输出 JSON：

{
"decision": "HIKE|CUT|HOLD|OTHER",
"targetRateLower": null,
"targetRateUpper": null,
"changeBps": null,
"stance": "HAWKISH|DOVISH|NEUTRAL|MIXED|UNKNOWN",
"inflationAssessment": "",
"growthAssessment": "",
"laborAssessment": "",
"forwardGuidance": "",
"balanceSheetAction": "",
"votesFor": null,
"votesAgainst": null,
"sourceQuotes": [
{
"field": "",
"quote": ""
}
],
"confidence": 0
}

约束：

- 数字优先 deterministic parser，LLM 不得覆盖可靠 deterministic value。
- 找不到就是 null。
- 不允许猜测。
- stance 必须有 sourceQuote。
- forwardGuidance 必须有 sourceQuote。
- 每个核心判断都需 provenance。
- 保存 provider/model/promptVersion。
- LLM failure 不影响 raw document publication。
- 无 LLM key 时仍保存原文并提供 deterministic fields。

增加 fixture tests：
至少使用若干历史 FOMC statement fixture。

完成后停止。

# Prompt 8 — Eurozone / SDMX

实现：

src/lib/macro/providers/sdmx.ts
src/lib/macro/providers/eurostat.ts
src/lib/macro/providers/ecb.ts

SDMX core 必须做到：

- dataflow / dataset identifier
- dimensions
- time period
- observation value
- unit
- frequency
- status/metadata
- CSV/JSON 或项目选择的最稳定格式
- deterministic parsing

Eurostat 至少：

EA_HICP_HEADLINE
EA_HICP_CORE
EA_UNEMPLOYMENT
EA_GDP

ECB 至少：

ECB_DEPOSIT_RATE
ECB_MAIN_REFI_RATE
ECB_MARGINAL_LENDING_RATE

可增加 EUR reference FX data，但与市场实时行情明确区分。

特别要求：

Eurostat 上游只提供 latest version 时，Tline 每次检测到 value 改变必须创建自己的新 MacroObservation vintage，不能 UPDATE 历史。

为 SDMX provider 建 fixture tests，不允许 live-network-only tests。

完成后停止。

# Prompt 9 — FX / Commodity Market Provider Layer

先审计现有 `PriceObservation`。

如果它能安全支持：

- multiple providers
- instrument
- timestamp
- interval
- quote currency
- source
- historical observations

则增量扩展。

如果其语义明显仅服务 Forecast settlement，则新增：

MarketInstrument
MarketObservation

不要为了复用而污染 Forecast settlement。

建立：

src/lib/macro/market/

- types.ts
- provider.ts
- twelveData.ts

统一 contract：

MarketDataProvider {
getQuote(symbol)
getTimeSeries(symbol, interval, start, end)
healthCheck()
}

初始 instrument：

EURUSD
GBPUSD
USDJPY
USDCHF
AUDUSD
USDCAD
XAUUSD

商品支持能力以 provider 实际授权/API capability 为准。

禁止把：

ECB reference rate

标记成：

real-time FX quote。

必须区分：

OFFICIAL_REFERENCE
DELAYED
REALTIME
EOD

所有市场数据记录：

provider
externalSymbol
observedAt
fetchedAt
interval
quality/status

更新 `.env.example`，不得提交 key。

完成后停止。

# Prompt 10 — Macro Surprise + Revision Engine

实现：

src/lib/macro/surprise.ts
src/lib/macro/signal.ts

第一阶段只实现事实层，不制造投资建议。

对于有合法 consensus 的 release：

surpriseRaw = actualInitial - consensusAtRelease

如果 denominator 合理：

surprisePct = surpriseRaw / abs(consensus)

否则 surprisePct = null。

没有 consensus：

surpriseRaw = null
surprisePct = null

禁止使用：

actual - previous

冒充 market surprise。

增加 Revision Metrics：

initial
latest
revisionDelta
revisionPct
revisionCount

构造 Macro Context 四轴接口：

GROWTH
INFLATION
POLICY
LIQUIDITY

但第一版只定义结构和 deterministic input mapping，不把四轴强制融合进现有 Institutional Consensus。

新增数据类型：

MacroSignalSnapshot 或 ADR 决定的等价实现。

保留：

- methodologyVersion
- generatedAt
- input release IDs
- input observation vintage IDs

必须可复算、可追溯。

完成后停止。

# Prompt 11 — Macro Web UI

按现有 Next.js App Router 和 query pattern 新增：

/macro
/macro/calendar
/macro/indicator/[key]
/macro/release/[id]

如产品上更适合，也可将 `/macro` 导航命名为 Economic Data，但内部领域仍叫 macro。

/macro：

展示：

- upcoming high-impact events
- latest releases
- inflation
- growth
- labor
- central-bank policy
- recent revisions

/calendar：

字段：

- time
- country/currency
- event
- importance
- previous
- consensus
- actual
- revision

必须清楚区分：
N/A
Not released
No consensus data

禁止用 0 表示 unknown。

/indicator/[key]：

- latest
- history
- vintage/revisions
- units
- seasonal adjustment
- original source
- source link
- provider
- updated at

/release/[id]：

- scheduled/released time
- all release values
- previous/revised
- policy documents
- source provenance

FOMC release 页面另外展示：

- decision
- target range
- change
- stance
- source-backed analysis

复用现有 UI primitives 和中英语言能力。

不要新增大型 UI dependency。

完成后测试/build。

# Prompt 12 — Watchlist + Alerts Integration

在保持现有 AlertRule 向后兼容情况下，为 macro 增量加入 scope。

目标支持：

MACRO_RELEASE
MACRO_SURPRISE_ABOVE
MACRO_SURPRISE_BELOW
MACRO_REVISION
CENTRAL_BANK_DECISION
POLICY_STANCE_CHANGE

示例：

- CPI released
- Core PCE above consensus
- NFP revised by more than X
- FOMC cuts rates
- new FOMC statement available

原则：

1. 不破坏现有 asset/institution/theme watchlist。
2. 使用现有 scopeKind/scopeRef 思路。
3. AlertEvent 幂等。
4. 同一 release 不重复通知。
5. 没有 consensus 时 SURPRISE rule 不触发。
6. rule evaluation 有测试。
7. 用户权限继续走现有 permissions。

完成后停止。

# Prompt 13 — Dedicated Macro Scheduler + Docker

不要重写现有 research scheduler。

新增：

scripts/macro-scheduler.mjs

职责：

calendar sync
regular provider sync
release watcher
revision sync
policy document sync

环境变量：

MACRO_ENABLED=true
MACRO_CALENDAR_INTERVAL_MS=
MACRO_SYNC_INTERVAL_MS=
MACRO_RELEASE_POLL_MS=
MACRO_RELEASE_LOOKAHEAD_MINUTES=
MACRO_REVISION_INTERVAL_MS=
MACRO_POLICY_INTERVAL_MS=

提供合理 defaults。

Docker Compose 新增独立：

macro-scheduler

继续使用同一：

- application image
- DATABASE_URL
- storage
- provider env
- LLM env（policy parsing 需要时）

要求：

1. app 不运行 background scheduler。
2. research scheduler 行为不改变。
3. macro scheduler 单实例。
4. 所有 job 写 JobRun。
5. graceful shutdown。
6. 防 overlapping execution。
7. bounded retry。
8. failure webhook 复用现有机制（如果适合）。
9. health check 中增加 macro source freshness，但第三方 API 短暂失败不能把整个 Web app 判死。
10. 更新 DEPLOYMENT.md。

完成后停止。

# Prompt 14 — Historical Backfill

实现：

npm run macro:backfill

参数：

--indicator=
--provider=
--country=
--from=
--to=
--all
--dry-run

优先：

US：
BLS
BEA
FRED/ALFRED

Eurozone：
Eurostat
ECB

要求：

1. restartable。
2. idempotent。
3. pagination。
4. bounded concurrency。
5. provider-specific rate limit。
6. JobRun metrics。
7. dry-run 不写 DB。
8. 输出 inserted / unchanged / revisions / failed。
9. 不为缺少 vintage 的 provider 伪造历史 revision。
10. FRED 可获得 historical vintages 时保留。
11. 明确标识 source provenance。

完成后停止。

# Prompt 15 — Data Quality / Reconciliation

实现宏观数据质量审计。

新增：

npm run macro:audit

至少检测：

- duplicate observations
- impossible timestamps
- vintage regression
- missing units
- missing canonical mapping
- stale source
- observation frequency mismatch
- release actual 与 initial observation 不一致
- previousAtRelease look-ahead
- unknown provider
- missing provenance
- invalid decimals

对有 secondary provider 的指标，可 cross-check：

BLS vs FRED
BEA vs FRED

但：

- 不自动覆盖 primary。
- 只产生 reconciliation warning。
- 差异可能来自更新时间/vintage，不立即判错。

输出：
data/macro/audit-YYYYMMDD.json

严重问题以非零 exit code 结束，以便 CI/运维检测。

完成后停止。

# Prompt 16 — Final Integration Audit

不要开发新 feature。

审计整个 Macro Intelligence implementation。

重点：

## Architecture

- Macro 是否独立于 Article ingest。
- Research pipeline 是否零 regression。
- Institutional Consensus 语义是否未改变。

## Database

- migration。
- SQLite。
- PostgreSQL generated schema。
- indexes。
- uniqueness。
- cascade behavior。

## Point-in-time correctness

- initial release。
- revision。
- vintage。
- previousAtRelease。
- consensusAsOf。
- no look-ahead。

## Providers

- timeout。
- retries。
- rate limit。
- fixtures。
- secret redaction。
- official source priority。

## Policy

- no invented fields。
- sourceQuotes。
- deterministic numeric extraction。
- LLM fallback。

## Scheduler

- no overlap。
- bounded retry。
- shutdown。
- JobRun。
- no accidental 24/7 high-frequency polling。

## UI

- null semantics。
- provenance。
- timezone。
- revision visibility。

## Alerts

- idempotency。
- backwards compatibility。

## Operations

- env example。
- Docker Compose。
- health endpoint。
- docs。
- production migration。

运行：

npm test
npm run build
相关 macro CLI dry-run

修复本次实现造成的 regression。

最后生成：

```
MACRO_IMPLEMENTATION_REPORT.md
```

内容：

1. implemented architecture
2. schema
3. providers
4. indicator coverage
5. release coverage
6. policy coverage
7. scheduler
8. point-in-time guarantees
9. tests
10. known gaps
11. recommended next phases

然后停止。