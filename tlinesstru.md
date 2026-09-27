# Tline — Institutional Intelligence · 技术架构与项目结构

> **⚠️ 已归档（2026-09-27）。这是 2026-09-13 的快照，不是当前状态。** 最新全量扫描见
> [`20260927.md`](./20260927.md)。已知过时点：§17 说 CI 含 `next build`（已被 `ci.yml` 刻意移除）、
> §18 说发布推 GHCR（现为宿主机构建、不经仓库）、§5 说最新迁移是 `20260913090000`
> （现为 `20260925120000_article_withdrawal`），数据模型此后由 52 个增至 70 个。

> 本文档由对代码库（`main` 分支工作区，2026-09-13）的全量扫描生成，覆盖技术栈、运行时拓扑、数据模型、三条数据管线（研究采集、宏观情报、社交发布）、Web/API 层、目录结构与运维命令。与根目录 `ARCHITECTURE.md`（设计决策）、`DEPLOYMENT.md`（部署操作）互补。

---

## 1. 项目概览

| 项 | 值 |
| --- | --- |
| npm 包名 | `institutional-intelligence`（私有，v0.1.0） |
| 品牌/站点 | Tline（生产站点 `https://tlines.tech`） |
| 定位 | 把公开机构研报转化为可比较、可追溯、可搜索的市场信号：研究共识（Consensus）、宏观数据情报（Macro Intelligence）、交易主线（Market Themes） |
| 形态 | **Next.js App Router 单体应用**：一个 Web 进程承载全部页面与 API，三条离线数据管线由独立调度进程驱动，共享同一个 Prisma 数据层 |
| 语言 | TypeScript（strict），ES2021；少量 Node `.mjs` 运维脚本、一个 Python robots 审计脚本 |
| 运行时 | Node.js 22（Docker）；本地开发 SQLite，生产 PostgreSQL 16 |
| 多语言 | 站点 **英文 + 中文双语在线**，每种语言有独立 URL（`/en/*`、`/zh/*`） |

## 2. 技术栈

| 层 | 选型 |
| --- | --- |
| Web 框架 | Next.js 15（App Router、Server Components、Server Actions、route handlers、middleware） |
| UI | React 19；自写 CSS（`src/app/globals.css`，无 Tailwind）；自绘 SVG 图表（`_components/charts.tsx`）；自托管字体与 pdf.js |
| 语言/构建 | TypeScript 5.6（strict）、ESLint 9 + eslint-config-next、`@/*` → `src/*` |
| 数据层 | Prisma 5（`@prisma/client`）。**双 schema**：`prisma/schema.prisma`（SQLite，本地）→ 由脚本生成 `prisma/postgresql/schema.prisma`（Postgres，生产，30 个 SQL 迁移） |
| 认证 | next-auth v4 + PrismaAdapter；Provider：Azure AD / Google / Email（SMTP）+ 密码登录；开发期可选"不安全演示登录" |
| 内容抓取 | `cheerio`（HTML 解析）、`rss-parser`、`playwright-core`（显式 opt-in 的 JS 渲染，容器内用系统 Chromium） |
| PDF | `pdf-lib`/`pdfkit`（研报双语 PDF 生成）、`pdfjs-dist`（自托管预览）、`@pdf-lib/fontkit`（嵌入 CJK 字体） |
| 存储 | 本地文件系统（`storage/`）或 S3 兼容对象存储（`@aws-sdk/client-s3`，预签名 URL） |
| LLM | 可选多 Provider：Anthropic / OpenAI / DeepSeek / Gemini；按任务路由（翻译、翻译复核、预测、宏观解读）；控制台可配、密钥加密存储、每篇失败退避、预算上限 |
| 市场数据 | Twelve Data（DELAYED/REALTIME/EOD 档位）；官方宏观 API：BEA、BLS、ECB、EIA、Eurostat、FRED（含 SDMX 通用协议） |
| 社交发布 | X（Twitter）OAuth 2.0 + PKCE 发帖；Feishu（飞书）机器人送审卡片与回调审批；全部凭据加密存储 |
| 邮件 | `nodemailer`（登录邮件 + 告警投递） |
| 测试 | `tsx --test`（node:test），测试文件与源码同目录（`*.test.ts`） |
| 部署 | Docker Compose 多服务 + GHCR 镜像（`ghcr.io/muadibusul/tline`）+ Caddy 反代；GitHub Actions CI/部署/运维三套工作流 |

## 3. 总体架构

```text
┌─────────────────────────── 外部输入 ───────────────────────────┐
│ 机构公开研报(RSS/站点/PDF)   官方宏观 API(BEA/BLS/ECB/EIA/...)    │
│ 央行政策文档                市场行情(Twelve Data)                 │
└───────────────────────────────┬────────────────────────────────┘
                                │
        ┌───────────────────────┴──────────────────────────┐
        │              Next.js 单体（app 容器）              │
        │  Web 页面(App Router) · 公开/内部 API · 机器路由    │
        └───────┬──────────────────┬───────────────┬────────┘
                │ 读               │ 读            │ 读
   ┌────────────▼──────┐  ┌────────▼──────────┐  ┌────────▼──────────┐
   │ research scheduler│  │ macro-scheduler   │  │ social-scheduler  │
   │ (scheduler.mjs)   │  │ (macro-scheduler) │  │ (social-scheduler │
   │ 采集→解析→分析→文档│  │ 日历→观测→发布监测 │  │  .ts) 候选草稿→    │
   │ →共识→重试→看门狗 │  │ →解读→修订→政策→   │  │ 飞书送审→X 发布    │
   │ →分析 rollup      │  │ 行情→结算→告警     │  │ (人工审批门闸)     │
   └───────┬──────────┘  └────────┬──────────┘  └────────┬──────────┘
           │ 写                   │ 写                   │ 写
           └──────────────────────┴──────────────────────┘
                                  ▼
              ┌─────────────────────────┐
              │  PostgreSQL 16（db 容器） │
              │  52 个 Prisma 模型        │
              └─────────────────────────┘
   私有文件：本地卷 document-storage 或 S3（研报 PDF、图表、QA 快照）
```

设计要点：

- **单一数据库、多数据域**（见 `docs/adr/ADR-macro-intelligence.md`）：研究文章域（Article/Analysis/AtomicView…）、宏观数据域（MacroObservation/MacroRelease…）与社交发布域（SocialDraft/SocialDelivery…）身份、精度、修订规则不同，各自有独立管线和调度，但共享 Web 与数据层。
- 三条调度管线是 **单例进程**（文件锁 + WorkerHeartbeat 心跳 + JobRun 追踪），Web 进程本身不做定时任务，可独立伸缩。
- 研报与资产页面使用**不可变语义化 slug**（`Article.slug`、资产 slug 如 `gold`/`bitcoin`），旧 URL 由 middleware 308 永久重定向。

## 4. 运行时进程拓扑（Docker Compose）

| 服务 | 入口 | 职责 | 资源上限（prod） |
| --- | --- | --- | --- |
| `db` | postgres:16-alpine | 唯一数据库；prod 限制连接与缓存参数 | 512m |
| `app` | `env:check && db:postgres:deploy && next start` | 页面、API、认证、文件下载 | 1g / heap 768m |
| `scheduler` | `env:check:production && npm run scheduler` | 研究采集与内容处理循环 | 1g |
| `macro-scheduler` | `env:check:production && npm run macro:scheduler` | 宏观/行情/告警任务循环 | 384m |
| `social-scheduler` | `env:check:production && npm run social:scheduler` | 社交发布循环（候选→送审→投递） | 384m |
| `backup`（仅 prod） | 每日 `npm run backup` 循环 | pg_dump + 私有文件清单，保留 N 份 | 256m |
| Caddy（外部 `web` 网络） | `deploy/proxy/` | 唯一 TLS 入口，反代 app | — |

健康检查：app 用 `/api/health`；三个 scheduler 用 `scripts/check-worker-health.mjs` 校验 WorkerHeartbeat 是否新鲜。prod 对全部容器施加 json-file 日志上限（10m×3）。

## 5. 数据模型（Prisma，52 个模型）

生产 schema：`prisma/postgresql/schema.prisma`（由 `scripts/generate-postgres-schema.mjs` 从 SQLite 源 schema 生成）。迁移位于 `prisma/postgresql/migrations/`，按时间戳排序，最新为 `20260913090000_research_slugs`。

| 域 | 模型 |
| --- | --- |
| 机构与文章 | `Institution`（爬取策略/频率/失败退避）、`Article`（urlHash 唯一去重；**slug 唯一索引**；分析/翻译各自失败计数与下次尝试时间） |
| 结构化分析 | `Analysis`、`AtomicView`（双语原子观点）、`ArticleSegment`（章节切分）、`ArticleFigure`（正文图表） |
| 翻译 | `ArticleTranslation`、`ArticleTranslationSegment` |
| 文档资产 | `ArticleDocument`、`Asset`、`ArticleAsset` |
| 重试 | `ContentRetry`（运营手动要求重跑） |
| 共识/预测 | `Forecast`（机构观点提取）、`PriceObservation`、`ConsensusHistory`（共识快照） |
| 宏观数据 | `MacroIndicator`、`MacroSeriesSource`、`MacroObservation`（含 vintage 修订）、`MacroRelease`、`MacroReleaseValue`、`MacroForecast`、`MacroPolicyDocument`、`MacroSyncState` |
| 市场 | `MarketInstrument`、`MarketObservation`、`MacroSignalSnapshot` |
| 社交发布 | `SocialDraft`（候选文案，版本号+状态机）、`SocialAccount`（X 账号，token 加密）、`SocialPlatformCredential`（X 应用凭据）、`SocialRoute`（内容源→账号路由）、`SocialDelivery`（逐账号投递结果） |
| 认证 | `User`、`Account`、`Session`、`VerificationToken`、`WatchlistItem`、`ApiKey` |
| 告警 | `AlertRule`、`AlertEvent` |
| 运维 | `AuditLog`（后台操作审计）、`JobRun`（每任务成败与指标）、`WorkerHeartbeat`（调度器存活） |
| 分析 | `PageView`、`AnalyticsEvent`、`WebVital`、`TrafficDaily`、`ApiUsageDaily` |
| LLM 治理 | `LlmProvider`、`LlmTaskRoute`、`LlmModelPrice`、`LlmCall`（逐调用账单）、`LlmBudget`（scope 粒度花费上限） |

## 6. 研究采集与内容管线（Research Pipeline）

调度器 `scripts/scheduler.mjs` 运行三个循环：

1. **采集循环**（默认 60s）：`npm run ingest -- --all --due`（有尝试重试，失败走 webhook 通知）→
2. **处理循环**（默认 60s）：`retries`（运营要求重跑，优先）→ `reparse`（结构化解析，每次≤50 篇）→ `documents`（PDF 生成）→ `watchdog`（静默告警）
3. **分析 rollup 循环**（默认 1h）：`analytics:rollup`（日聚合 + 原始行清理）

采集流水线（`src/lib/ingest/run.ts`，入口 CLI `npm run ingest`）：

- **发现能力阶梯**：RSS → sitemap → 列表页/分页（`extract.ts` 会跟随发布者的全文链接，优先用发布者原始 URL 作为 `sourceUrl`）→ 官方 API（apiSources.ts）→ 浏览器渲染（仅 `requiresRender` 机构，opt-in）。PDF 候选另行发现；部分机构（Schroders/Scotiabank/TD/MUFG 等）在 `sourceRules.ts` 中配置了专属原生 PDF 管线与最小回溯窗口。
- **合规**：`robots.ts` 读取 robots.txt（`crawlPolicy`: allowed|delayed|blocked|manual；尊重 Crawl-delay，最低 1s 礼貌间隔）；`scheduling.ts` 按机构频率排程、连续失败指数退避与熔断（`consecutiveFailures`）。
- **正文提取**：`extract.ts`（cheerio 规则）→ 章节化解析 `atomicViews.ts`/`analysisGrounding.ts`（带小标题与无小标题两套策略）→ 生成 `Analysis` + `AtomicView`；LLM 仅在有 Provider 配置时参与，否则退化为确定性解析器；LLM 分析 token 用量经精简。
- **发布时**：`researchPath.ts` 生成不可变语义化 slug（机构+标题+指纹后缀），供 `/research/[slug]`、sitemap 与社交文案引用。
- **翻译**：`src/lib/translation/`（分块翻译 + 完整性校验 + 抽样付费复核 + 质量门闸）。中文站已恢复在线，翻译管线随调度运行。
- **文档与图表**：`src/lib/documents/`（`documents.ts` CLI）生成双语 PDF；`publication.ts` 的 `preferredEnglishDocuments` **优先采用机构原生 PDF** 而非生成副本；`pdf.ts`/`extractPdf.ts` 解析原生 PDF 并保真排版；图表提取写入 `storage/figures/`；私有文件经 `storage.ts`（本地或 S3）权限化存取。
- **共识**：`src/lib/consensus.ts` 按机构权威权重（`authorityScore`）× 时间衰减（τ=31 天）× 24h 窗口聚合，快照写入 `ConsensusHistory`；`recompute.ts` 重算。
- **费用保护**：`articleBackoff.ts` —— 分析/翻译失败各自计数（上限 `ARTICLE_LLM_MAX_FAILURES`）并按指数退避推迟重试，防止不可处理文章被永久重复计费；`contentRetry.ts` 承接运营手动重跑。

## 7. Macro Intelligence 管线

调度器 `scripts/macro-scheduler.mjs`（npm run `macro:scheduler`）以每任务独立间隔驱动，全部经 `runTrackedJob` 记录到 `JobRun`：

| 任务 | CLI | 默认间隔 | 说明 |
| --- | --- | --- | --- |
| 日历同步 | `macro:calendar` | 6h | 官方发布日历 → `MacroRelease` |
| 观测同步 | `macro:sync --all` | 1h | 各 Provider 拉取序列，vintage 语义写入 `MacroObservation` |
| 发布监测 | `macro:watch` | 10s（prod） | 捕获即时发布，**当场生成双语解读**（`releaseAnalysis.ts`，带退避与放弃上限） |
| 修订同步 | `macro:revision` | 24h | 追踪历史 vintage 修订 |
| 政策同步 | `macro:policy` | 6h | 央行政策文档抓取 + 有来源的解析（`policy/` 子模块） |
| 行情同步 | `macro:market` | 30m | Twelve Data 拉取（30 分钟以适配免费档 800 次/天；`--from` 可回填历史） |
| 预测结算 | `forecasts` | 6h | `prices/bridge.ts` 将宏观/市场观测桥接为 `PriceObservation`，`forecast.ts` 结算到期预测 |
| 告警 | `macro:alerts` | 1m | 规则求值 + 投递 |

数据域注册表（代码内静态数据）：`data/macro/{indicators,sources,release-families}.json`，经 `src/lib/macro/registry.ts` 启动时强校验（无重复 key、引用完整）。Provider 层：`src/lib/macro/providers/`（`bea/bps/ecb/eia/eurostat/fred/sdmx` + fixtures），统一 `MacroProviderError` 错误码；指标规范与异常值计算在 `normalize.ts`/`surprise.ts`；历史回填 `backfill.ts`/`macro:backfill`；审计 `audit.ts`。

## 8. 社交发布管线（Social Publishing，人工审批门闸）

调度器 `scripts/social-scheduler.ts`（npm run `social:scheduler`，`SOCIAL_INTERVAL_MS` 默认 5s），循环调用 `src/lib/social/pipeline.ts` 的 `runSocialCycle`：

1. **候选生成**（`createEligibleDrafts`）：
   - 宏观：24h 内 importance=5、双语解读齐备的发布 → `macroPosts()` 生成推文；
   - 研究：48h 内 `reviewStatus=ok`、重要性/置信度达标、有中文摘要的研报 → `researchPosts()`（每上海自然日上限 3 条）。
   - 写入 `SocialDraft`（PENDING_REVIEW，`routeSnapshot` 固化当时的账号路由）。
2. **送审**（`notifyPendingDrafts`）：`feishu.ts` 向运营发送飞书审批卡片（appId/appSecret 控制台或环境变量配置），最多尝试 3 次。
3. **人工审批**：运营在飞书卡片或 `/admin/social` 控制台批准/驳回（版本号乐观并发，`decideDraft`）；批准后生成 `SocialDelivery`。
4. **投递**（`deliverApprovedDrafts`）：`social/x.ts` 经 X OAuth 2.0（authorization code + PKCE、refresh token 自动续期、凭据经 `secrets.ts` 加密）发布主贴 + 引用回复链接。
5. **安全语义**：`content.ts` 强制 X 加权 280 字符限制、主贴禁 URL、禁保证收益类违禁话术；重启时中断的 PUBLISHING 投递一律置 FAILED 并留给运营人工核对（绝不自动重发，避免重复发帖）；`UncertainPublishError` 区分"结果未知"与"确定失败"。

配套：`/api/social/x/connect` 与 `/api/social/x/callback` 完成 OAuth 授权；`/api/social/feishu` 接收飞书事件回调（签名校验）；`admin/social` 管理 X 应用凭据、飞书设置、账号与草稿。

## 9. Web 应用层

### 9.1 页面路由（App Router，`src/app/`）

| 路由 | 说明 |
| --- | --- |
| `/` | 首页（最新机构观点流 + 本周重要数据（北京时间）+ 最活跃机构 + 热门话题 + 模糊搜索框） |
| `/research`、`/research/[id]` | 研报列表 / 研报详情（接受 id 或 slug，旧 id 永久重定向到 slug；结构分析、原子观点、PDF 下载） |
| `/institutions`、`/institution/[slug]`、`/institution/[slug]/accuracy` | 机构目录 / 机构主页 / 预测准确率页 |
| `/markets`、`/markets/[ticker]` | 资产市场目录（仅列 ≥2 机构 × ≥2 篇研报覆盖的资产）/ 资产详情（按语义化 slug，如 `gold`、`bitcoin`，实现复用 `asset/[ticker]` 页） |
| `/macro`、`/macro/calendar`、`/macro/indicator/[key]`、`/macro/release/[id]` | 宏观数据中心：日历、指标页（含图表）、发布详情（双语解读） |
| `/watchlist` | **Market Themes 交易主线页**（公开）：由 `tradingThemes.ts` 从近期 AtomicView 聚合 8 大命名主题，附强化/分歧/降温状态、机构广度与行情确认 |
| `/alerts` | 告警规则管理（登录） |
| `/signin`、`/account/password` | 登录（邮件/密码表单）、改密 |
| `/admin` | 管理后台：仪表盘、来源监控、内容复核、任务、审计、用户、API 密钥、模型与预算、社交发布、分析报表（`admin/*` 子路由 + Server Actions） |
| `/[policy]` | 静态政策页：about/methodology/editorial-policy/ai-usage/sources/privacy/corrections |

> 已退役的路由（目录保留为空壳）：`/consensus`、`/consensus/[ticker]`、`/search`（由首页 SearchBox 模糊搜索取代）、`/api/v1/consensus`、旧 `/asset/[ticker]`（308 到 `/markets/[slug]`）。

### 9.2 机器路由与 SEO

`sitemap.xml`（分片 `/sitemap/[shard]`：0 号分片为站点页面，1 号起为研报，chunk 扫描 + 边缘缓存；逻辑在 `src/lib/sitemap.ts`）、`robots.txt`（代码生成，显式放行 GPTBot/ClaudeBot/PerplexityBot 等 AI 爬虫）、`rss.xml`/`feed.xml`、`llms.txt`/`llms-full.txt`（AI 可读站点索引）、`api/og`（edge 运行时动态 OG 图）、`public/sw.js`（Service Worker，构建版本心跳）、`public/pdfjs`（自托管 PDF 预览）。

### 9.3 Middleware 与缓存（`src/middleware.ts`）

- **语言地址化**：`/en/*`、`/zh/*` 均直接服务（rewrite 到无前缀路由，经 `x-pathname` 头传递原始地址）；无前缀地址按 Cookie（`tline_locale`）/ Accept-Language 308 重定向到对应语言段；机器路径（api、_next、sitemap、robots、feeds、llms、pdfjs 等）不参与。
- **旧地址迁移**：`/asset/[ticker]` 308 → `/markets/[slug]`（经 `assetPath.ts` 映射）。
- 缓存策略：未登录的公开 GET → `public, s-maxage=60, stale-while-revalidate=300`；私有页与已登录 → `private, no-store`；Vary: Cookie, Accept-Language。

### 9.4 安全基线

CSP（默认 self、禁外部源、允许内联 script/style 与 pdf.js 的 blob 字体）、HSTS（prod）、X-Frame-Options DENY、COOP、nosniff、API 响应 `X-Robots-Tag: noindex`、poweredByHeader 关闭。`src/lib/secrets.ts` 加密控制台存储的 Provider/社交凭据；`rateLimit.ts` 固定窗口限流（登录、搜索、告警 webhook 投递等）。

## 10. API 层

| 端点 | 说明 |
| --- | --- |
| `/api/v1/research`（游标分页）、`/api/v1/research/[id]`、`/api/v1/institutions` | 公开数据 API（API Key 认证 + 按 key 计量，`ApiUsageDaily`） |
| `/api/search` | 站内搜索（内存索引，独立限流） |
| `/api/health` | 健康检查（匿名仅返回 status；admin 会话或 `HEALTH_DETAIL_TOKEN` 可见详情） |
| `/api/analytics` | 唯一分析信标端点（恒 204、立即返回） |
| `/api/documents/[id]`、`/api/figures/[id]` | 私有 PDF 下载（登录 + 权限 + 审计）/ 图表图片（仅 publication-ready） |
| `/api/feed/pulse` | 前端热更新心跳（构建版本变化 → 整页刷新） |
| `/api/auth/[...nextauth]` | NextAuth 处理器 |
| `/api/og` | 动态 Open Graph 图 |
| `/api/social/x/connect`、`/api/social/x/callback` | X OAuth 授权与回调（admin.social 权限） |
| `/api/social/feishu` | 飞书机器人事件回调（审批按钮） |

公开 API 语义见 `docs/API.md`（认证头、错误格式、限流）。

## 11. 认证 / 权限 / 审计

- **认证**（`src/lib/auth-config.ts`/`auth.ts`）：Azure AD、Google、Email（SMTP）三选一 + 密码登录（独立于邮件配置）；`AUTH_ALLOWED_EMAIL_DOMAINS` 白名单；开发期 `ALLOW_INSECURE_DEMO_AUTH` 演示登录，生产默认禁用。
- **授权**（`permissions.ts`）：admin（`ADMIN_EMAILS` 或 `User.role`）/ 登录用户 / 匿名三级；研报原文（`rawText`）与文档下载受权限门控；社交审批要求 `admin.social`。
- **审计**（`audit.ts`）：后台操作与敏感读取写入 `AuditLog`；管理界面可检索。
- **API Key**（`apiKeys.ts`）：哈希存储、可轮换（`admin/api` 界面）、逐 key 用量统计。

## 12. 搜索（`src/lib/search.ts`）

- 内存倒排索引（标题/别名/正文 trigram），上限 `SEARCH_INDEX_MAX_ARTICLES=5000`（生产容器设 1000 以约束内存），`instrumentation.ts` 在服务启动时预热（`SEARCH_PREWARM=false` 可关）。
- 中文支持：`pinyin.ts`（`pinyin-pro`，拼音查询映射与评分）+ `i18n.ts` 双语本地化。
- 数据版本指纹探测（`SEARCH_VERSION_PROBE_MS`）避免陈旧索引；`/api/search` 固定窗口限流；前端入口为首页 SearchBox。

## 13. 分析（`src/lib/analytics/`）

第一方、无 Cookie：访客身份 = 单向摘要（`AUTH_SECRET` + UTC 日 + IP + UA），同日只计一次、跨日不可关联；不存 IP。`/api/analytics` 收 beacon（PV/事件/WebVitals）→ `collect.ts` 落原始行 → 研究调度器 `analytics:rollup` 聚合成 `TrafficDaily` 并清理原始行（保留 90 天）。支持 Do-Not-Track（`ANALYTICS_RESPECT_DNT`）、整体开关 `ANALYTICS_ENABLED`、信标限流 `ANALYTICS_RATE_LIMIT`。

## 14. 目录结构全览

```text
Tline/
├── package.json              # 依赖与全部 npm scripts（见 §15）
├── next.config.mjs           # CSP/安全头、serverExternalPackages、distDir 覆盖
├── tsconfig.json             # strict；@/* -> src/*
├── eslint.config.mjs         # ESLint 9 flat config
├── Dockerfile                # node:22 + Chromium + CJK 字体 + pg_dump 16 客户端
├── docker-compose.yml        # db/app/scheduler/macro-scheduler/social-scheduler（本地基线）
├── docker-compose.prod.yml   # 生产覆层：GHCR 镜像、内存/日志上限、backup、Caddy 网络
├── .github/workflows/        # ci.yml（类型/测试/构建）、deploy.yml、ops.yml
├── .env / .env.example       # 全部环境变量（分组注释，见 §16）
│
├── src/
│   ├── app/                  # App Router 页面、API、机器路由（见 §9）
│   │   ├── page.tsx layout.tsx globals.css icon.svg error.tsx …
│   │   ├── _components/      # Analytics、LiveFeed、SearchBox、PdfPreview、charts、ui …
│   │   ├── api/              # v1 公开 API + search/health/analytics/documents/figures/og/auth + social/
│   │   ├── admin/            # 管理后台（页面 + actions + _components，含 social/ models/ analytics/）
│   │   ├── macro/            # 宏观数据中心页面
│   │   ├── research/ institutions/ institution/ markets/ asset/
│   │   ├── watchlist/        # Market Themes 交易主线页（LegacyMonitoringPage 保留未启用）
│   │   ├── alerts/ signin/ account/ [policy]/
│   │   ├── robots.ts sitemap.xml rss.xml llms.txt middleware… （见 §9.2）
│   │   └── *.test.ts         # 路由级测试（middleware/machineRoutes/robots）
│   ├── lib/                  # 服务端领域逻辑（详见下方）
│   ├── middleware.ts         # 语言段重写/重定向 + 旧资产地址迁移 + 缓存头
│   ├── instrumentation.ts    # 启动时预热搜索索引
│   └── types/next-auth.d.ts  # 类型扩展
│
│   lib 主要模块：
│   ├── ingest/               # 采集管线：run.ts(CLI) fetch extract store sitemap robots
│   │                         #   scheduling sourceRules render apiSources probe
│   │                         #   atomicViews(+Rules) analysisGrounding parseLLM documentTitle recompute
│   ├── macro/                # 宏观管线：sync calendar watch releaseAnalysis revisions policy
│   │                         #   surprise normalize backfill audit store registry types
│   │                         #   providers/(bea bls ecb eia eurostat fred sdmx)
│   │                         #   market/(provider sync twelveData types)
│   ├── social/               # 社交发布：pipeline(循环) content(文案规则) feishu(送审) x(OAuth+发帖)
│   ├── documents/            # extractPdf pdf pdfSafety storage s3Storage(+tests)
│   ├── translation/          # translate quality titleDates
│   ├── llm/                  # provider config usage budget report types
│   ├── analytics/            # agent collect identity query rollup serverEvent
│   ├── prices/               # bridge（宏观→PriceObservation）
│   ├── auth* / password / permissions / apiKeys / rateLimit / audit / secrets / user
│   ├── consensus / forecast(+Horizon) / alerts / alertDelivery
│   ├── search / pinyin / i18n / localePath / seo / site / sitemap / publication
│   ├── assetPath / researchPath / tradingThemes（新增路径与主题模块，均带测试）
│   ├── pagination / viewRanking / articleBackoff / contentRetry / contentQuality
│   ├── articleText / articleBlocks / hash / db / jobs / queries / apiResponse / apiSerialize
│   └── adminUsers / pipelineHealth / staleBuild / assets
│
├── scripts/                  # 调度器与运维 CLI（.mjs/.ts）
│   ├── scheduler.mjs         # 研究调度器（单例锁 + 心跳 + 3 循环）
│   ├── macro-scheduler.mjs   # 宏观调度器（8 任务）
│   ├── social-scheduler.ts   # 社交发布调度器（5s 循环 + 心跳）
│   ├── worker-heartbeat.mjs check-worker-health.mjs watchdog.ts
│   ├── macro-*.ts            # 宏观任务包装（alerts/audit/backfill/policy-sync/release-watch/revision-sync）
│   ├── market-sync.ts        # 宏观行情同步（macro:market，--from 回填）
│   ├── backup.mjs validate-env.mjs dataset.ts set-password.ts
│   ├── analytics-rollup.ts analysis-grounding.ts content-retries.ts
│   ├── translation-quality.ts mail-test.mjs
│   ├── generate-postgres-schema.mjs robots_audit.py
├── prisma/
│   ├── schema.prisma         # 源 schema（SQLite dev，52 模型）
│   ├── postgresql/           # 生成的 prod schema + 30 个 SQL 迁移
│   ├── seed.ts demo-user.ts  # 种子数据 / 演示用户
│   └── *.ts                  # 内容处理 CLI：reparse retitle translate(-eval)
│                             #   documents forecasts prices macro-forecasts fix-title-dates
├── data/                     # 静态注册表：institutions.json crawl_policy.json
│   │                         #   macro/(indicators sources release-families).json
│   │                         #   financial_glossary.zh-CN.json market-events.json
│   └── cache/http/           # 抓取 HTTP 缓存（按 URL 哈希）
├── storage/                  # 私有文件卷：articles/ figures/ qa qa2 qa3/ quarantine/ .trash/
├── tmp/                      # 临时工作区（claude、pdfs、sheet-audit）
├── public/                   # sw.js、pdfjs 自托管、静态资源
├── docs/                     # ADMIN.md API.md AI-INTEGRATION-PROMPT.md adr/ADR-macro-intelligence.md
├── deploy/                   # bootstrap-vps.sh、proxy/(Caddyfile docker-compose)、备份 cron 示例
├── .runtime/                 # 调度器锁文件
└── *.md                      # ARCHITECTURE.md DEPLOYMENT.md README.md plan20260827.md
                              #   MACRO_IMPLEMENTATION_REPORT.md + 带日期的工作笔记
```

## 15. npm scripts 索引

| 分组 | 命令 |
| --- | --- |
| 开发 | `dev`（turbopack）、`build`、`start`、`lint`/`lint:fix`、`typecheck`、`test`（tsx --test） |
| 数据库 | `db:push`、`db:postgres:schema`（生成）、`db:postgres:deploy`（迁移）、`db:seed`、`db:studio`、`setup` |
| 采集/内容 | `ingest`、`ingest:probe`、`reparse`、`retitle`、`translate`、`translate:eval`、`documents`、`retries`、`consensus`、`analysis:grounding`、`translate:rescore` |
| 宏观 | `macro:sync`、`macro:calendar`、`macro:watch`、`macro:policy`、`macro:revision`、`macro:alerts`、`macro:market`、`macro:scheduler`、`macro:backfill`、`macro:forecasts`、`macro:audit` |
| 社交 | `social:scheduler` |
| 调度/运维 | `scheduler`、`watchdog`、`backup`/`backup:verify`、`env:check`/`env:check:production`、`mail:test`、`analytics:rollup` |
| 数据/用户 | `prices:import`、`forecasts`、`alerts`（demo 用户）、`dataset:export/import`、`user:password` |

## 16. 环境变量（`.env.example` 分组）

- **LLM**：`LLM_PROVIDER` + 各厂商 key/model（anthropic/openai/deepseek/gemini）；按任务路由（`TRANSLATION_PROVIDER`、`TRANSLATION_REVIEW_PROVIDER`、`FORECAST_PROVIDER`）；`CONFIG_ENCRYPTION_KEY`、`LLM_CALL_RETENTION_DAYS`。
- **成本控制**：`TRANSLATION_CHUNK_CHARS`、`TRANSLATION_REVIEW_SAMPLE_RATE`、`ARTICLE_LLM_MAX_FAILURES`/`BACKOFF_MS`/`BACKOFF_MAX_MS`、`MACRO_RELEASE_ANALYSIS_*`。
- **文档存储**：`DOCUMENT_STORAGE_DRIVER/ROOT/MAX_BYTES`、S3 全组（bucket/region/prefix/endpoint/签名 TTL/加密）、PDF 字体路径（CJK/EN）。
- **抓取**：`PLAYWRIGHT_CHROMIUM_PATH`、`INGEST_INTERVAL_MS/CONCURRENCY/SOURCE_SECONDS/ARTICLE_LIMIT/WINDOW_HOURS`、`PROCESS_INTERVAL_MS/ARTICLE_LIMIT`、`REPARSE_CONCURRENCY`、`TRANSLATION_CONCURRENCY`、`JOB_RETRY_*`、`JOB_FAILURE_WEBHOOK_URL`。
- **宏观调度**：`MACRO_*_INTERVAL_MS` 全套、`BLS/BEA/FRED/EIA_API_KEY`、`TWELVE_DATA_API_KEY/QUALITY`、`MACRO_JOB_RETRY_*`。
- **社交发布**：`X_CLIENT_ID`/`X_CLIENT_SECRET`（OAuth 应用，回调为 `/api/social/x/callback`）、`SOCIAL_INTERVAL_MS`、`SOCIAL_PUBLISH_ATTEMPTS`；飞书设置可在控制台或环境变量提供。
- **认证**：`AUTH_SECRET`、`ADMIN_EMAILS`、`AUTH_PROVIDER`、`NEXTAUTH_URL`、SMTP/Azure/Google 凭据、`AUTH_ALLOWED_EMAIL_DOMAINS`、`ALLOW_INSECURE_DEMO_AUTH`、`PRICE_SETTLEMENT_TOLERANCE_DAYS`。
- **站点/安全**：`SITE_URL`、`BRAND_SAME_AS`、`HEALTH_DETAIL_TOKEN`、`SEARCH_RATE_LIMIT/WINDOW/INDEX_MAX/VERSION_PROBE`、`CONTENT_RETRY_BATCH`、`ALERT_WEBHOOK_URL/ATTEMPTS`、`BACKUP_DIR/KEEP`。
- **分析**：`ANALYTICS_ENABLED/RESPECT_DNT/RAW_RETENTION_DAYS/RATE_LIMIT/ROLLUP_INTERVAL_MS`。

## 17. 测试策略

- 单元测试与源码同目录（`*.test.ts`，node:test via `tsx --test`），覆盖路由（`src/app/*.test.ts`、`middleware.test.ts`）、采集（fetch/extract/robots/sitemap/scheduling/atomicViews…）、宏观（providers/sdmx/surprise/calendar/backfill/audit/watch…）、文档（pdf/pdfSafety/storage/s3Storage）、LLM（provider/budget）、路径与主题（`assetPath.test.ts`、`researchPath.test.ts`、`sitemap.test.ts`、`tradingThemes.test.ts`）、社交文案规则（`social/content.test.ts`）、分析与限流等。
- CI（`.github/workflows/ci.yml`）：`prisma db push`（SQLite 临时库）→ `tsc --noEmit` → `lint` → 全量测试 → `next build` 生产构建。

## 18. 部署与 CI/CD

- **镜像**：`Dockerfile` 多阶段（从 postgres:16 取 pg_dump 客户端）；构建期生成 schema + prisma generate + next build；运行期 `env:check:production && db:postgres:deploy && npm start`。
- **VPS**：`deploy/bootstrap-vps.sh`（Debian/Ubuntu：加固 SSH、UFW、4G swap、Docker + 日志上限）；Caddy 挂外部 `web` 网络做唯一入口（`deploy/proxy/`）。
- **发布**：GitHub Actions 三工作流 —— CI（PR 验证）、deploy（构建并推送 `ghcr.io/muadibusul/tline`）、ops（运维任务）；生产用 `docker-compose.prod.yml` 覆层（镜像、内存、日志、备份服务、健康检查）。
- **备份**：`scripts/backup.mjs` 每日 pg_dump + 文档文件清单，`BACKUP_KEEP` 轮换，`backup:verify` 校验；cron 示例见 `deploy/tline-backup.cron.example`。

## 19. 已有文档索引

| 文档 | 内容 |
| --- | --- |
| `ARCHITECTURE.md` | 详细技术架构决策（目标/边界/采集/解析/双语/共识/演进） |
| `DEPLOYMENT.md` | 本地开发、Docker 生产基线、告警投递、备份恢复、运维检查 |
| `docs/API.md` | 公开 API 语义（认证、错误、限流、各端点） |
| `docs/ADMIN.md` | 管理后台操作手册 |
| `docs/AI-INTEGRATION-PROMPT.md` | 编码代理提示词包 |
| `docs/adr/ADR-macro-intelligence.md` | Macro Intelligence 独立数据域决策记录 |
| `MACRO_IMPLEMENTATION_REPORT.md` | 宏观功能实现报告 |
| `plan20260827.md` | 早期建设计划 |
| 根目录若干日期命名 `.md` | 工作笔记/修复记录（未纳入文档体系） |
