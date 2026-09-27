# Tlines SEO 重构方案

目标站点：https://tlines.tech/
代码库：`E:\Codes\Tline`（Next.js 15 App Router，单一代码库即站点本身）
方案日期：2026-09-17
本方案所有"现状"均来自对生产站点的实测（Googlebot UA 抓取 + 源码核对），非推测。

---

## 0. 方法与证据边界（先读这一节）

### 0.1 我实际做了什么

| 动作 | 覆盖 |
|---|---|
| 代码审计 | 全部公开路由模板、`src/lib/seo.tsx`、`src/middleware.ts`、`src/app/robots.ts`、`src/lib/sitemap.ts`、`src/lib/contentQuality.ts` |
| 生产站点实测 | 以 Googlebot UA 抓取 30+ URL，记录 status / TTFB / title / canonical / robots / hreflang / H1/H2/H3 / 正文字数 / JSON-LD / 内链数 |
| 全量站点地图解析 | `sitemap.xml` → 2 个 shard，共 1649 个 URL，逐类计数 |
| 抽样式内容审计 | 从英文研报 shard 每 33 条抽 1 条，共 30 篇研报页，逐页解析渲染后的 HTML |
| SERP 侦察 | 22 个查询词 |

审计脚本留在仓库内可复跑：`.preview/seoaudit/audit.mjs`、`.preview/seoaudit/links.mjs`。

### 0.2 必须声明的数据边界

- **本方案不含任何 Search Volume、Keyword Difficulty、CTR、排名位置或流量数字。** 我没有 GSC / Ahrefs / Semrush / Keyword Planner 的第一方数据。所有"该词值得做"的判断都是 **Keyword hypothesis（待验证）**，需要你用 GSC 与关键词工具确认。凡是需要数字的地方我都写了"待验证"，没有编号。
- **SERP 结果质量受限，必须说明**：本次 SERP 侦察所用搜索工具对 22 个查询中的 17 个只返回了 AI 归纳的实体名而非真实排序链接。因此：**排名顺序不可信**；"某域名未出现"属于推断而非观察。可靠的部分是**页面类型分布**（该项在多次查询中一致），不可靠的部分是**具体排名**。强烈建议用 Ahrefs/Semrush 的 SERP 快照复核第七章的关键结论。
- **事实与建议严格分离**：标"实测"的是事实，标"建议"的是我的判断。

---

## A. 当前 SEO 核心问题

按"对搜索可见性的实际伤害"排序。每条都给出实测证据。

### A1. 站点 86% 的 URL 是研报叶子页，但叶子页彼此不连接

实测：
- 站点地图共 **1649 个 URL**：**1417 个**是研报页（英文 988 / 中文 429），仅 **232 个**是实体与栏目页（每语言 116 个：50 机构 + 19 资产 + 22 经济指标 + 22 准确率 + 首页 + 2 宏观）。
- 30 篇研报抽样中：
  - **57%（17/30）不链接任何资产页**
  - **100%（30/30）不链接任何其他研报**
  - **100%（30/30）不链接任何经济指标或宏观发布页**

后果：Google 只能通过"研报流分页"和 sitemap 发现这 988 个页面。研报流是每页 20 条的列表，第 988 篇位于第 50 页附近。**这就是一个 988 页、深度 50 层、几乎没有横向连接的漏斗**——正是 Google 会判定为"低质量程序化内容"结构的形态。你在需求里担心的"1000 个互相没有关系的 Research URL"，**不是风险，是既成事实**。

### A2. 标题体系失控，垃圾标题正在被索引

实测抽样 30 篇研报页：

| 指标 | 实测值 |
|---|---|
| `<title>` 超过 60 字符（SERP 截断） | **90%（27/30）** |
| `<title>` 与 `<h1>` 不一致 | **23%（7/30）** |
| `<h1>` 为全小写（提取损坏） | **17%（5/30）** |

正在被索引的真实页面（`index, follow`）：

| URL | `<title>` | `<h1>` |
|---|---|---|
| `/en/research/intesa-sanpaolo-pdf-777-kb-kri5ezklyp` | `PDF 777 Kb · Tlines Institutional Intelligence` | `PDF 777 Kb` |
| `/en/research/daiwa-file-of-entire-text-6myh2ob7r4` | `file of entire text · …` | `file of entire text` |
| `/en/research/uob-research-uob-group-research-fimfbrd3vs` | `UOB Group Research · …` | `UOB Group Research` |
| `/en/research/deutsche-bank-equity-portfolio-finanzportfolioverwaltung-…` | 170 字符德语标题 | 同 |
| `/en/research/ing-think-monthly-debt-sustainability-dashboard-who-comes-off-worst-…` | `monthly debt sustainability dashboard who comes off worst · …` | 同 |
| `/en/research/intesa-sanpaolo-calendar-of-macroeconomic-data-and-events-28-august-2026-…` | `Calendar of macroeconomic data and events · 28 August 2026 …` | 同 |

`src/lib/contentQuality.ts:15` 的 `BAD_TITLE` 正则只拦 `untitled|title|document|report|research|go to article|download…`，**拦不住"PDF 777 Kb""file of entire text"这类 PDF 抽取噪声**。这些页面通过质量门禁、进入 sitemap、被 `index, follow`。

### A3. 核心栏目页内容过薄，且没有 H2

实测：

| 页面 | 正文字数 | H2 数 | JSON-LD |
|---|---|---|---|
| `/en`（首页） | **197 词** | **0** | Organization, WebSite |
| `/zh`（中文首页） | **532 汉字** | **0** | Organization, WebSite |
| `/en/markets` | **98 词** | **0** | **无** |
| `/en/macro` | 166 词 | 1 | **无**（且**无 H1**） |
| `/en/institution/saxo` | 247 词 | 0 | ProfilePage, BreadcrumbList |
| `/en/institution/saxo/accuracy` | 111 词 | 0 | **无** |
| `/en/macro/indicator/US_CPI_HEADLINE` | 416 词 | 0 | **无** |
| `/en/macro/release/…` | 542 词 | 0 | **无** |

首页是品牌的门面，只有 197 个英文词、零个 H2；`/en/markets` 这个"资产总览"只有 98 个词、零个 H2、零 Schema。这两页是 Tlines 最重要的两个非研报落地页。

标题层级还有一个结构缺陷：首页与 `/en/markets` 把区块标题渲染成 `<div class="section-t">` 而非 `<h2>`，而研报卡片的标题却是 `<h3>`。**结果是 H1 → H3 的跳级**，中间没有 H2。

### A4. 目录类页面完全没有结构化数据

实测 JSON-LD 分布：

| 页面类型 | 现有 JSON-LD |
|---|---|
| 首页 | Organization, WebSite |
| 研报详情 | AnalysisNewsArticle, BreadcrumbList |
| 资产页 | WebPage, Dataset（仅当 ≥2 机构）, BreadcrumbList |
| 机构页 | ProfilePage, BreadcrumbList |
| 政策页 | WebPage |
| **`/markets`** | **无** |
| **`/research`（列表）** | **无** |
| **`/institutions`（Views 流）** | **无** |
| **`/macro` 及其全部子页** | **无** |
| **`/institution/[slug]/accuracy`** | **无** |
| **`/watchlist`** | **无** |

`/en/institutions` 实测有 50 个 H2、2015 词，是一个货真价实的观点流，却零 Schema。`/en/markets` 列出 19 个资产却零 Schema。

### A5. 最具差异化的产品（Market Themes）对 Google 完全不可见

实测 `/en/watchlist`：
```
HTTP 200 · <title> 空 · description 113 字符 · canonical 无
robots: noindex, nofollow, nocache
hreflang: 0 个
```
`src/app/watchlist/page.tsx:24` 无条件套用 `noIndex`；`/watchlist` 同时在 `middleware.ts:19` 的 `PRIVATE_PREFIXES` 里，且不在 sitemap 的 `STATIC_ROUTES` 中。

"今天的市场主线是什么、由什么证据支持、哪里会失效"——这是 Tlines 区别于 Bloomberg/Reuters/一般 AI 摘要的核心产品，也是 SERP 上（见 §C）明显供不应求的内容形态。**它现在对搜索完全不存在。** 这是本方案里最大的一处战略漏损。

### A6. 站内搜索不可索引，且 `?q=` 是死参数

实测 `/en/research?q=gold`：
- `robots: noindex, follow`
- 正文 1140 词，与 `/en/research` **完全相同**——`q` 参数被计入 `filtered` 判断（触发 noindex）但**从未进入 Prisma 查询**（`src/app/research/page.tsx:20` 计数，`:50-65` 的 where 不读 `q`）。

后果：既有"参数触发 noindex 却不过滤"的无效行为，又完全没有一个可被索引的搜索结果落地页。`src/lib/seo.tsx:118` 注释也确认 `SearchAction` 因"不存在可抓取的搜索页"而主动省略——**等于放弃站内搜索这一整类长尾入口**。

### A7. 没有 Topic 层；Fed / CPI 被错误建模为"资产"

实测存在的资产页（19 个）中包含：
- `/en/markets/fed` → title `Fed Policy Institutional Outlook & Bank Forecasts`
- `/en/markets/cpi` → title `Inflation Institutional Outlook & Bank Forecasts`

也就是说"美联储政策"和"通胀"被当作 ticker 处理，与 `/macro/indicator/US_CPI_HEADLINE`、`/macro/release/…` 语义重叠且互相竞争。同时站点**完全没有** `/topics/*` 路由（`src/app/` 下不存在该目录），也没有 `/tag`。

后果：宏观主题词（Fed、通胀、加息路径——SERP 侦察显示这是最强的共识型意图）没有任何专用落地页承接。

### A8. 中文覆盖只有 43%，且质量失败是静默的

实测：
- 研报 shard 中英文 URL **988** 个，中文 URL **429** 个 → 中文可索引覆盖率 **43%**。
- 抽样命中一个典型：`/zh/research/standard-chartered-navigating-divergence-…` 正文 **1919 汉字**（内容充足），但 `robots: noindex, follow`，且 **meta description 长度 = 4 字符**。

机制：`src/lib/contentQuality.ts:49` 的 `translation_below_threshold`（`qualityScore < 0.8`）使中文整体降级为 `NOINDEX_FOLLOW`。这个门禁本身是对的（宁缺毋滥），但**没有配套的修复回路**——被降级的 559 篇中文页面对运营不可见，也没有重译触发条件；同时 description 在降级路径上退化到 4 个字符这种无意义值。

### A9. Information Gain 的真实形态：不是"重复源文"，而是"独特内容太少"

这是对你第五节的直接回答，且结论与预设相反。

我实测的机制（`src/app/research/[id]/page.tsx:148-150`、`:224-244`）：当研报存在出版方 PDF（`source_native` 文档）时，**机构原文根本不出现在 HTML 里**——它由 `PdfPreview` 在 hydration 后用 pdf.js 画到 canvas 上。实测 `intesa-sanpaolo-macro-weekly-economic-monitor-viewpoint`：HTML 中只有 **3 个 `<p>`**，最长的 154 词，其余全是 Tlines 的结构化分析。

所以：
- **风险不是"Google 认为内容来自机构"**——HTML 里机构正文基本不存在，不存在搬运式重复。
- **真实风险是反向的**：每个研报页的可索引文本 = Tlines 分析（抽样中位数量级约 400–900 词）+ 一套**每页完全相同的模板骨架**（One-sentence conclusion / Key arguments / Key numbers / Main risks / Conditions）。988 个页面共享同一模板与同一批 H2/H3 标签。差异只来自分析正文本身。
- 抽样中最薄的研报页：**282 词**（UOB Group Research）、280 词（Intesa 日历页）、272 词、3112 词（Daiwa 正文）。薄页与"标题即机构名"的页大面积存在。

结论：**要解决的不是"洗原创"，而是给这 988 个页面各自足够的、可被搜索理解的独特增量，并把不达标的挡在索引之外。**

### A10. 实体信息与站点资产不完整

实测：
- `Organization` JSON-LD 只有 `name / alternateName / url / logo / sameAs`；`sameAs` 依赖环境变量 `BRAND_SAME_AS`，**当前生产输出为空数组**（实测 JSON-LD 中 `sameAs: []`）。无 `description`、无 `foundingDate`、无 `publishingPrinciples`。
- **缺 `favicon.ico`**：`public/` 目录只有 `sw.js` 与 `pdfjs/`，`src/app/` 只有 `icon.svg`。
- **缺 `apple-touch-icon`**、**缺 `manifest.webmanifest`**（但 `next.config.mjs:20` 的 CSP 里已写了 `manifest-src 'self'`）。
- 全站 **0 个 `<img>`**（实测每页 `imgCount: 0`），OG 图全部走 `/api/og` 动态生成，没有静态兜底图。

### A11. E-E-A-T 页面是孤岛

实测内链数：

| 页面 | 内链总数 | 其中站内语境链接 |
|---|---|---|
| `/en/methodology` | 16 | 0（全部是导航 + 页脚） |
| `/en/about` | 16 | 0 |
| `/en/sources` | 16 | 0 |
| `/en/institution/saxo` | 45 | — |
| `/en` | 41 | — |

Methodology / Sources / Corrections / AI Usage 每页只有 16 个内链，全部来自站点 chrome。**没有任何一篇研报、资产页或机构页在正文语境里链接到它们。** 对一个 YMYL 金融站点，"方法论可被验证"这件事目前只有站点结构层面的声明，没有内容层面的连接。

### A12. 技术层面已做对的部分（不要动）

为避免误导，明确列出实测正常、且比多数站点做得好的地方：

- **robots.txt**：`/api/*` 精确白名单式 disallow；登录页**故意不 disallow**（`src/lib/site.ts:11-22` 有正确推理：被禁止抓取的页面其 noindex 也读不到，反而会被外链带进索引）。这个判断是对的。
- **canonical / hreflang**：公开页均输出 canonical + `en` / `zh-CN` / `x-default` 三组 alternate，双向声明完整。`src/lib/seo.tsx:22-33` 逻辑正确。
- **中文无译文时的处理**：`src/app/research/[id]/page.tsx:134-136` 对 2026-09-15 之后的新文章，无译文的中文请求 302 到英文页，而不是给空壳页。
- **sitemap 与 noindex 一致**：实测 noindex 的中文页**不在** sitemap 中（`src/lib/sitemap.ts:54-56` 与页面 robots 共用同一门禁）。这是很多站点做错的点。
- **`<link rel="alternate" hrefLang="en">` 属性名大小写**：实测输出为 `hrefLang`（大写 L）。**这不是缺陷**——HTML 属性名大小写不敏感，Google 正常解析。列出来是为了避免有人当成 bug 去"修"。
- **重定向**：实测 `/ → /en` **308**、`/cn → /zh` 308、`/en/asset/gold → /en/markets/gold` 308、`/en/consensus/gold → /en/research` 308、`/en/search?q=… → /en/research` 308、`/en/research/ →（去尾斜杠）` 308、`http://` 与 `www.` 均跳转规范域。**全部正确。**（308 保留请求方法与语义，对重定向等价于 301 的 SEO 效果，无需修改。）
- **404**：实测 `/en/nonexistent-page-xyz` 与 `/en/research/does-not-exist-xyz` 均返回真 **404**（非 soft 404），并带 `noindex`。
- **缓存**：HTML `public, s-maxage=60, stale-while-revalidate=300`（中间件）；登录态 `private, no-store`；sitemap 1 小时。TTFB 实测 226–650ms。**首页 JS 传输约 158 KB（gzip，11 个 chunk）**，对一个数据密集型站点属正常范围。

---

## B. Tlines 推荐 SEO Positioning

### B1. 定位结论（基于 SERP 实测）

SERP 侦察给出两条**强结论**（多次一致）：

1. **`institutional research` 与 `macro research` 两个 head term 无法争夺。** 实测结果 100% 是高等教育行政（"院校研究办公室"）与社会科学学术文献，零金融意图。Tlines 用这两个词做定位，等于在别人的战场打。
2. **`market consensus data` 与 `institutional investment research platform` 是干净的 vendor landing page SERP。** 前者被 Visible Alpha、Capital IQ、LSEG/Reuters Polls、FocusEconomics 占据；后者被 Morningstar Direct、FactSet、AlphaSense 类平台占据。**这两个词需要 Landing Page 形态。**

以及一条最强的机会信号：**`gold institutional outlook` 这类查询，SERP 上没有任何一个页面在真正回答"各机构目标价分布是什么、共识在哪、过去 30 天怎么变"**——搜索工具本身被迫在结果里"现场汇总"了一个机构目标价表。**这正是 Tlines 已经有能力直接输出的东西。**

### B2. 推荐定位表述

对外（可用于首页 H1、OG、Organization description）：

> **EN**：`Institutional research, turned into comparable, traceable market signals.`
> **ZH**：`把机构研报变成可比较、可追踪的市场信号。`

实体定位（喂给 Google 的 Entity 栈，用于 Organization / WebSite / 站点主题）：`Bank research` + `Institutional market views` + `Market consensus` + `Macro research` + `Cross-asset outlooks` + `Economic data releases`。

**明确不要用的词**：Institutional research（学术词）、Financial news（无差异）、AI summary（自降价值）、Macro research（学术词）、News aggregator（自贬）。

### B3. 面向搜索的差异化陈述（三类页面必须各自讲清）

SERP 侦察显示，用户在这些查询上的真实意图是"别让我读几十份报告"。因此每个落地页首屏需要回答同一个问题，用不同证据：

| 用户问题 | Tlines 的证据 |
|---|---|
| 为什么不用自己读几十份机构报告？ | 一页聚合 N 家机构的同一资产观点，附目标价分布与共识方向 |
| Tlines 替我做了什么？ | 结构化：观点方向、目标价、期限、依据、失效条件，逐条可溯源 |
| 和 Bloomberg / Investing / TradingView / 普通 AI 摘要的区别？ | 那些是"更多新闻 + 报价"或"无出处的摘要"；Tlines 是**带原始链接的机构观点数据库 + 变化追踪 + 可核验的预测结算记录** |

第三行里的"预测结算记录"（`/institution/[slug]/accuracy`）是 SERP 上**没有任何竞品具备**的资产——它把一个观点站点变成可审计的观点站点。这是 E-E-A-T 的核心筹码，见 §E.10。

---

## C. Keyword Architecture

> **全表标记为 Keyword hypothesis。** 我没有 Search Volume / KD 数据（见 §0.2）。优先级依据是 **SERP 页面类型分布 + 站点已有能力**，不是流量估算。上线后用 GSC 的查询报告回填真实优先级。

### C1. 第一层：Category Keywords（产品类别）

| Keyword | Search Intent | Landing Page | Content Type | Priority |
|---|---|---|---|---|
| institutional investment research | 找平台/找来源 | 首页 | Landing page | P0 |
| bank research reports | 想读报告内容本身 | `/research` + `/institutions` | Feed / hub | P0 |
| institutional market views | 想看机构在说什么 | `/institutions` | Feed hub | P0 |
| market consensus | 想要共识读数 | `/markets` + `/markets/{asset}` | Landing + data page | P0 |
| market consensus data | 想拿结构化共识数据 | `/markets` + `/methodology` | Landing + dataset page | P1 |
| investment bank research | 找特定投行研究（含"如何获取"意图） | `/institutions` + `/methodology` | Hub + explainer | P1 |
| institutional research intelligence | 品类定义词（低量，做定位用） | 首页 | Landing page | P1 |
| market intelligence platform | 品类词 | 首页 | Landing page | P2 |

**不建议争夺**（实测被学术/高教占据）：`institutional research`、`macro research`、`global macro research`（后者被 World Bank / IMF / NBER 占据，仅 SSGA 一个商业页）。若要碰，只做 `global macro research` 的**观点型长尾**，不做 head term。

### C2. 第二层：Asset Keywords（资产）

| Keyword | Intent | Landing Page | Content Type | Priority |
|---|---|---|---|---|
| gold research / gold market outlook | 找黄金展望 | `/markets/gold` | Landing + consensus page | P0 |
| gold institutional outlook | **要机构逐家目标价**（实测无页面真正满足） | `/markets/gold` | Landing + target table | P0 |
| institutional gold outlook | 同上 | `/markets/gold` | 同上 | P0 |
| bank gold price forecasts | 要预测表 | `/markets/gold` | 同上 | P1 |
| oil market outlook | 找原油展望 | `/markets/crude-oil-wti` | Landing | P0 |
| US Treasury outlook | 找美债展望 | `/markets/us-10-year-treasury` | Landing | P0 |
| EUR/USD outlook | 找汇率预测 | `/markets/eur-usd` | Landing | P1 |
| dollar outlook / DXY | 找美元方向 | `/markets/us-dollar-index` | Landing | P1 |
| S&P 500 outlook | 找股指展望 | `/markets/sp-500` | Landing | P1 |
| bitcoin institutional outlook | **要机构立场**（实测被 Grayscale/Ark/WisdomTree 自家报告 + 交易所聚合占） | `/markets/bitcoin` | Landing | P1 |
| silver / copper / natural gas outlook | 同族资产 | `/markets/xagusd` 等 | Landing | P2 |
| NVDA / AAPL outlook | 个股机构观点 | `/markets/nvda`、`/markets/aapl` | Landing | P2 |

**注意**：实测 19 个资产页中 `xagusd`、`natgas`、`gbpusd`、`nvda`、`aapl`、`sox` 使用 ticker 小写作为 slug，其余 12 个有语义 slug（`gold`、`crude-oil-wti`、`us-10-year-treasury`…）。语义 slug 与搜索词更接近，**建议补齐 `ASSET_SLUGS` 映射**（`src/lib/assetPath.ts:1-18` 目前只有 12 条）。

### C3. 第三层：Macro Topic Keywords

| Keyword | Intent | Landing Page | Content Type | Priority |
|---|---|---|---|---|
| Fed rate outlook | **要逐家机构的利率路径**（实测：结果全是央行路径汇总，零解释型内容） | **新增 `/topics/fed`** | Topic hub | P0 |
| Federal Reserve analysis | 要分析与解读 | `/topics/fed` | Topic hub | P0 |
| Fed interest rate outlook | 同上 | `/topics/fed` | Topic hub | P1 |
| US inflation outlook | **实测工具自行汇总了多家机构预测表** | **新增 `/topics/inflation`** | Topic hub + data | P0 |
| US economy outlook | 宏观展望 | `/topics/us-economy` | Topic hub | P1 |
| Treasury yield outlook | 利率路径 | `/topics/rates` | Topic hub | P1 |
| central bank outlook | 多央行 | `/topics/central-banks` | Topic hub | P2 |
| Fed rate hike impact on gold | 事件 × 资产 | `/topics/fed` + `/markets/gold` | Topic↔asset | P1 |

### C4. 第四层：Institution Keywords（务必合规）

| Keyword | Intent | Landing Page | Content Type | Priority |
|---|---|---|---|---|
| Goldman Sachs research | 找该行观点 | `/institution/goldman-sachs` | Profile/hub | P0 |
| UBS research / UBS outlook | 同上（实测 SERP 混入"关于 UBS 股票的评级"，需在页面上明确区分） | `/institution/ubs` | Profile/hub | P0 |
| ING research / ING think | 同上 | `/institution/ing` | Profile/hub | P1 |
| Saxo market outlook | 同上 | `/institution/saxo` | Profile/hub | P1 |
| MUFG research / PIMCO outlook | 同上 | 对应机构页 | Profile/hub | P2 |

**合规要求（必须落实到页面，不是套话）**：
1. 每个机构页首屏必须有一句显式声明，且**在 H1 正下方、非折叠区**：
   > EN: `Tlines indexes and structures publicly available research published by {Institution}. Tlines is not affiliated with, endorsed by, or acting on behalf of {Institution}.`
   > ZH: `Tlines 仅对 {机构} 公开发布的研究进行索引与结构化整理，与 {机构} 无关联、未经其授权或背书。`
2. `<title>` 中机构名后必须带限定词（现为 `Market Outlook, Forecasts & Research | Tlines`，已合格，保留）。
3. Schema 中机构是 `publisher`／`mainEntity`，**Tlines 是 `sdPublisher`**（`src/lib/seo.tsx:89-116` 已正确实现，保留——这是该站做得最好的一处结构化数据设计）。
4. 机构 Logo 不得使用，避免来源混淆。

### C5. 第五层：Long-tail Research Queries

组合公式：`{Institution} + {Asset}` / `{Asset} + consensus|institutional views|outlook` / `{Macro event} + {Asset}`。

| Keyword 模式 | 落到哪个页面 | 现有能力 |
|---|---|---|
| `Goldman Sachs gold outlook` | `/institution/goldman-sachs` 的该资产观点块 + `/markets/gold` | 数据已有，缺页面聚合 |
| `UBS gold outlook` | 同上 | 同上 |
| `institutional views on US Treasuries` | `/markets/us-10-year-treasury` | 已有 |
| `Wall Street gold outlook` / `bank gold price forecasts` | `/markets/gold` | 已有 |
| `Fed rate hike gold impact` | `/topics/fed` ↔ `/markets/gold` 双向链接 | 缺 topic 页 |
| `how to read institutional research reports` | 新增解释型文章 | **实测该词无第一方示例、无跨机构评级口径对照——明显内容缺口** |

**中文层单独研究，不直译**（见 §E.12）。中文的真实意图偏向"某资产机构怎么看""机构对某数据的预期"，`中文标题` 应使用 `机构+资产+展望/预测/观点` 结构，而不是英文关键字的字面翻译。

---

## D. Site Architecture

### D1. 目标结构：Hub → Cluster → Detail

```
Tlines
├─ / (品牌 + 品类 + 入口)
├─ /markets (资产 Hub)  ────────► /markets/{asset} (Cluster: 共识/分布/变化/机构)
│                                        │
│                                        ├─► /institution/{slug} (Detail)
│                                        └─► /research/{slug} (Detail)
├─ /topics/{topic} (新增：主题 Hub) ─► /markets/{asset} + /macro/* + /research/*
│      fed · inflation · rates · us-economy · central-banks · ai-capex · china
├─ /institutions (观点流 Hub) ──────► /institution/{slug}(+ /accuracy)
├─ /research (研报 Hub) ───────────► /research/{slug}
├─ /macro (数据 Hub) ──────────────► /macro/indicator/{key} · /macro/release/{id} · /macro/calendar
├─ /watchlist (Market Themes) ─────► 公开快照页（新增，见 §E.11）
└─ /about /methodology /sources /corrections /ai-usage /editorial-policy /financial-disclaimer
```

### D2. 关键结构改动（四项）

**改动 1：新增 `/topics/[topic]` 主题层。**
理由：Fed / 通胀 / 利率是实测中最强的共识型意图，而当前它们或不存在、或被塞进 `/markets/fed`、`/markets/cpi`（与 `/macro` 语义冲突）。这是整个架构最大的空洞。

**改动 2：`/markets/fed`、`/markets/cpi` 迁移到 `/topics/fed`、`/topics/inflation`，并 301。**
理由：这两个 URL 把"宏观主题"建模为"可交易资产"，既不符合事实，也让 `/markets` 这个"资产"集合的语义被污染。迁移在 `src/middleware.ts` 加一条 308 规则即可（已有 `/asset/*`、`/consensus/*` 的先例）。

**改动 3：`/watchlist` 拆成"公开快照页 + 登录完整页"。**
理由：Market Themes 对 Google 完全不存在（实测 noindex+nofollow+无 canonical+不在 sitemap）。建议：`/market-themes` 作为**公开可索引**的概览页（当期主线的标题、方向、证据数量、更新时间、方法论摘要），完整证据链与实时跟踪留在登录后的 `/watchlist`。这样既保住产品付费墙，又拿到搜索入口。

**改动 4：新增可索引的搜索结果页 `/search?q=`（或不做搜索页，改为在 `/research` 支持 `q` 并允许 `noindex,follow` 之外的正常索引——但二者必居其一）。**
理由：当前 `?q=` 既不搜索也不可索引（实测），同时 `WebSite` Schema 因缺失搜索页而放弃 `SearchAction`（`src/lib/seo.tsx:118`）。最小改法是**修掉 `?q=` 不生效的 bug** 并保留 noindex（消除不一致），更完整的做法是提供带服务端渲染结果的 `/search` 并允许索引。倾向后者，因为站内搜索长尾是 Tlines 这种数据库型站点的天然优势。

### D3. 索引 / 非索引 / 禁止抓取 三类 URL 清单

这三个概念必须分开（你的第二十节要求）：

**应 index（允许抓取 + 允许索引 + 进 sitemap）**
- `/`、`/markets`、`/markets/{asset}`（≥2 机构覆盖）、`/topics/{topic}`（达到门槛）、`/research`（仅第 1 页）、`/research/{slug}`（达质量门禁）、`/institutions`、`/institution/{slug}`（≥1 篇）、`/institution/{slug}/accuracy`（≥1 条已结算）、`/macro`、`/macro/calendar`、`/macro/indicator/{key}`、`/macro/release/{id}`、全部政策页、`/market-themes`（新增）
- **补**：`/institutions?page=N`（分页保持可索引，但需加 `rel=prev/next`）

**应 noindex, follow（允许抓取 + 禁止索引 + 不进 sitemap）**
- `/research` 的**任何过滤态 URL**（现行为正确，保留）
- 覆盖率不足的资产页、无观点机构页（现行为正确，保留）
- 未通过质量门禁的研报页与中文译文页（现行为正确，保留）
- 空分页、`?utm_*` 等跟踪参数变体（canonical 已处理，保留）
- **`/watchlist`（登录后完整页）**：保留 noindex，但**必须补 canonical** 指向 `/market-themes`
- **修正**：`/research?q=` 要么实现真实过滤，要么从 `filtered` 判断中移除 `q`（消除"noindex 但内容不变"的不一致）

**应禁止抓取（robots.txt Disallow）**
- 保持现状即可：`/api/auth`、`/api/documents`、`/api/feed`、`/api/health`、`/api/search`、`/api/social`、`/api/v1`
- **不要**把 `/watchlist`、`/signin`、`/account` 加进 disallow——它们靠 `noindex` 生效，一旦禁抓，`noindex` 就读不到（`src/lib/site.ts:11-22` 已正确论证，保持不变）
- **已知矛盾点**：研报页 HTML 中链接到 `/api/documents/{id}`（实测每页 1 个），而该路径在 robots 中被 disallow。若希望原始 PDF 作为可抓取的证据文件，需为 PDF 单独开一条可抓取路径；否则保持现状（Google 不会抓它，也不影响页面索引）。

---

## E. Page-by-Page SEO Map

格式：`Current`（实测原值）→ `Recommended` → `Reason`。中英双版给出。

### E.1 首页 `/`

**Current（实测）**
- `<title>`：`Tlines Institutional Intelligence | Bank Research & Market Consensus`（68 字符）
- `description`：`Track market views from global banks and asset managers. Compare institutional forecasts, consensus signals and changes across equities, FX, commodities, rates and crypto.`（**171 字符，会被截断**）
- `H1`：`Tlines Institutional Intelligence`
- 正文 **197 词**，**H2 = 0**，H1 后直接 H3（跳级）
- JSON-LD：Organization（`sameAs: []`）、WebSite
- 内链 41

**Recommended**

| 项 | 值 |
|---|---|
| SEO Title (EN) | `Institutional Research & Bank Consensus — Tlines` |
| SEO Title (ZH) | `机构研报与市场共识 · Tlines` |
| Meta Description (EN) | `Compare what banks and asset managers say about gold, oil, rates, FX and crypto. One page per asset: consensus, targets, recent changes, original sources.`（**155 字符**） |
| Meta Description (ZH) | `逐家比较银行与资管机构对黄金、原油、利率、外汇与加密资产的公开观点：共识方向、目标价分布、近期变化与原始来源。`（**约 55 汉字**） |
| H1 (EN) | `Institutional research, turned into market signal` |
| H1 (ZH) | `把机构研报，变成市场信号` |
| Eyebrow | `Institutional Research Intelligence` / `机构研报情报` |
| Hero 副文案 (EN) | `Tlines reads the research global banks publish every day and turns it into comparable, source-linked views — so you can see where institutions agree, where they diverge, and what changed this week.` |
| Hero 副文案 (ZH) | `Tlines 每天读取全球银行公开发布的研报，转换成可比较、可溯源的观点，让你看清机构在哪里一致、在哪里分歧，以及这周变了什么。` |
| Primary CTA | `Browse markets` → `/markets`（先给价值，不先要注册） |
| Secondary CTA | `See latest research` → `/research` |

**Reason**
- 现 Title 把最长的品牌名放在最前（`Tlines Institutional Intelligence`，32 字符）而没有品类词与资产词，浪费首屏可见区；改为品类词前置、品牌后置。
- 现 Description 171 字符，SERP 约 155–160 截断，末尾的 `crypto` 会丢。压缩到 155 内并把"每资产一页 + 原始来源"这个差异点写进去。
- **现 H1 只有品牌名，零品类信息**——这是首页最大的语义浪费。H1 应承担"Tlines 是什么"的定义职责，品牌名交给 `Organization` Schema 与 OG 承担。
- 197 词、0 个 H2：见下方"H2 结构"。

**首页前 8 屏结构（每屏解决什么问题 / 承载什么词 / 是否留在 HTML）**

| # | 屏 | 解决的用户问题 | 应出现的关键词 | H2 | 留在 HTML？ |
|---|---|---|---|---|---|
| 1 | Hero | Tlines 是什么、凭什么信 | institutional research, market consensus, bank research | （H1 所在屏） | **是**（静态文案） |
| 2 | 今天机构在看什么 | 现在市场在争论什么 | market views, institutional outlook | `What institutions are saying now` | **是**（服务端取最新 8 条，已有） |
| 3 | 共识读数（按资产） | 机构对黄金/原油/利率到底偏多还是偏空 | gold outlook, oil outlook, rate outlook, consensus | `Consensus across major assets` | **是**（服务端渲染，N 家机构、多空分布） |
| 4 | 本周经济数据 | 这周有什么数据、预期是多少 | economic calendar, Fed, CPI, consensus expectations | `Key data this week` | **是**（已有 `importantReleasesThisWeek`） |
| 5 | 机构覆盖 | 覆盖了哪些机构、多少篇 | Goldman Sachs research, UBS research, bank research reports | `Institutions covered` | **是**（已有 `mostActive`，建议扩为机构名列表文本） |
| 6 | 主题主线（新增入口） | 当前市场在交易什么逻辑 | market themes, market narratives | `Live market narratives` | **是**（概要，链到 `/market-themes`） |
| 7 | 方法透明（E-E-A-T） | 这些结论怎么来的、错了怎么办 | methodology, sources, corrections | `How Tlines works` | **是**（3–4 句摘要 + 链接，从页脚上提到首屏区） |
| 8 | 转化 | 为什么要注册 | watchlist, alerts, market themes | — | 可动态 |

**需要改的代码位置**：`src/app/page.tsx:48`（H1）、`:47`（eyebrow）、`:49`（sub）、`:55/:62/:74/:85` 的 `div.section-t` → **改为 `<h2>`**（同时修掉 H1→H3 跳级）；`src/lib/seo.tsx:55-57`（`homeSeoTitle`）与 `src/app/page.tsx:15-19`（description）。

### E.2 资产页 `/markets/{asset}`（当前最重要的落地页）

**Current（实测 `/en/markets/gold`）**
- Title：`Gold Institutional Outlook & Bank Forecasts | Tlines`（52 字符，良好）
- H1：`Gold`（**仅资产名，零语义**）
- 正文 **204 词**，H2 = 0，H3 = 8
- JSON-LD：WebPage, Dataset, BreadcrumbList
- 结构：Market observation / Institutional Views (24h) / Recent View Changes / Target Distribution / Related Research

**Recommended**

| 项 | 值 |
|---|---|
| Title (EN) | `Gold (XAUUSD) Institutional Outlook, Forecasts & Consensus — Tlines` |
| Title (ZH) | `黄金机构展望、目标价与共识 · Tlines` |
| H1 (EN) | `Gold — what institutions are forecasting` |
| H1 (ZH) | `黄金：机构正在预测什么` |
| Intro（150–200 词，**必须新增**） | 见下方 |
| H2 结构 | `Consensus now` / `How the view changed` / `Institutional forecasts and targets` / `What is driving gold` / `Related research` / `How this page is built` |
| Schema | 保留 WebPage + Dataset + BreadcrumbList；**新增 `ItemList`**（机构预测条目）与 `about: Thing{name:"Gold"}` |
| Index | ≥2 机构 → index；否则 `noindex, follow`（**现逻辑正确，保留**） |
| Canonical | `/markets/{asset}`（正确，保留） |

**Intro 文案（EN，放 H1 下方，服务端渲染）**
> `Gold (XAUUSD) is covered by {N} institutions in Tlines' index. Below is what they currently forecast: the balance of bullish and bearish views, each published target price with its horizon, and every view change recorded in the last 30 days. Every figure links to the original public report it came from.`

**Intro 文案（ZH）**
> `Tlines 已收录 {N} 家机构对黄金（XAUUSD）的公开观点。以下是它们当前的预测：看多与看空的分布、每一条目标价及其期限，以及过去 30 天记录到的每一次观点变化。每一项数据都可回溯到原始公开研报。`

**Reason**
- H1 从 `Gold` 改为含意图的句子：`Gold` 一词无法与商品报价站区分，也无法承载 `institutional outlook` 这类查询。这是**全站最容易摘取的改进之一**（19 个资产页同改）。
- 204 词对一个 `P0` 落地页太少。新增的 Intro 不是"堆字"，它正好回答了实测中 SERP 迫使用户自己解决的那个问题（逐家目标价 + 共识）。
- 补 `ItemList`：目标价分布这一块本质上是列表数据，Schema 化后有机会进入富结果。

**需要改的代码位置**：`src/app/asset/[ticker]/page.tsx:64`（H1）、`:63`（eyebrow 已是覆盖率句子，可保留）、`:87-170` 的 `div.section-t` → `<h2>`；`src/lib/seo.tsx:58-60`（`assetSeoTitle`）。

### E.3 资产 Hub `/markets`

**Current（实测）**：Title `Institutional Market Outlooks · Tlines Institutional Intelligence`（65 字符）；H1 `Markets`；正文 **98 词**；**H2 = 0**；**JSON-LD 无**；19 个资产链接。

**Recommended**
- Title：`Institutional Market Outlooks by Asset — Tlines`
- H1：`Markets — institutional coverage by asset`
- Intro（新增 120–180 词）：说明"只列出有 ≥2 家机构公开研报支持的资产"，并点名覆盖范围（黄金、原油、铜、天然气、标普、纳指、半导体、比特币、美元指数、EUR/USD、USD/JPY、GBP/USD、美债 10Y/2Y…）。
- **新增 `CollectionPage` + `ItemList`**，每个 asset 一个 `ListItem`，指向 `/markets/{asset}`。
- 每个资产卡片显示：资产名、覆盖机构数、最近更新时间、当前共识方向——这些数据站点已有，只是没渲染成文本。

### E.4 资产页的"观点变化"块（差异化资产，需重命名+Schema 化）

**Current**：区块标签 `Recent View Changes`（`div.section-t`），列出机构、方向变化、时间。

**Recommended**：升级为独立 H2 `How institutional views changed`，并给每条变化输出 `Observation`/`Event` schema（`{"@type":"Observation","about":"Gold","observationDate":…,"measuredProperty":"institutional view direction","measuredValue":"bullish"}`）。理由：这是 SERP 上无人提供的"观点变化追踪"，是 Tlines 的核心差异点，值得让 Google 明确读到它是一个**时间序列**。

### E.5 研报详情 `/research/{slug}`（988 页，模板统一化最关键）

**Current（实测）**
- Title：机构原始标题或 AI `seoTitle` + `· Tlines Institutional Intelligence` → **90% 超过 60 字符**
- H1：机构原始标题（**17% 全小写**，23% 与 title 不一致）
- H2 = 1（`One-sentence conclusion`），H3 = 3–11（`Key arguments`/`Key numbers`/`Main risks`/`Conditions / invalidation`）
- 正文 282–3846 词（中位数约 900）；PDF 来源页的**机构正文不在 HTML**（仅 Tlines 分析在 HTML）
- JSON-LD：`AnalysisNewsArticle` + `BreadcrumbList`（设计良好，`sdPublisher`/`isBasedOn` 分离正确）
- 内链 18–22，其中 **0 个同业主研报链接、0 个宏观指标链接**

**Recommended 模板（逐项）**

| 项 | 规则 | 理由 |
|---|---|---|
| `<title>` | `{机构名}: {清洗后的主题} — {资产} Outlook \| Tlines`，**硬上限 60 字符**，超出截断主题而非品牌 | 实测 90% 超长；品牌后缀 `· Tlines Institutional Intelligence`（35 字符）应改为 ` \| Tlines`（9 字符），单此一项为全站省 26 字符 |
| `<h1>` | **必须做首字母大写规范化 + 去噪**（`PDF 777 Kb`、`file of entire text` 这类必须降级） | 实测 17% 全小写、垃圾标题被索引 |
| Meta description | 现为 `summary`（160 字符）。改为 `{机构} {方向} {资产}：{一句话结论}（{日期}）` | 让 description 自带机构、方向、资产、时间四要素 |
| H2 骨架 | `What it says`（一句话结论）/ `Why`（论点+数字）/ `What would invalidate it` / `Assets affected` / `The original report` / `Related institutional views` / `How to cite this page` | 把现有 6 个 H3 提为 H2，形成可被摘取的层级 |
| 新增文案块 | 每个研报页必须有一段**Tlines 编辑性定位句**（见下） | 提升 Information Gain，区别于纯结构化输出 |
| Schema | 保留 `AnalysisNewsArticle`；**新增 `Review`/`Claim` 级别的 `about` 扩充**：把 `Key numbers` 里的目标价写入 `about` + `mentions`；补 `citation`（原始 URL）；补 `dateModified`（已有） | 让目标价成为结构化事实，而非纯文本 |
| Index | 保持现有 `contentQuality` 门禁，但**扩展门禁规则**（见 §F2） | 实测有垃圾标题页通过门禁 |
| 内链（出） | 机构页(1) + 资产页(≥1，**57% 现在为 0**) + **同业研报(≥3，现在为 0)** + 主题页(1–2) + 相关指标/发布(≥1) | 见 §E.13 内链引擎 |
| Crawl 深度 | 通过"资产页/机构页/主题页反向列最新研报"把深度降到 ≤3 | 当前 988 页最深处约 50 层 |

**必须新增的编辑性文案（每页相同位置，内容随数据变化）**
> EN: `This page is Tlines' structured reading of a public report by {Institution}. The conclusion, arguments, numbers and risks are extracted and rewritten by Tlines; the original wording is available at the source link. Tlines takes no position on the trade.`
> ZH: `本页是 Tlines 对 {机构} 公开研报的结构化解读。结论、论点、数字与风险由 Tlines 提取并改写；原始表述请见来源链接。Tlines 不对该交易持立场。`

**Reason**：这段文案同时解决三件事——(1) 明确作者与来源的责任边界（YMYL / E-E-A-T）；(2) 让页面拥有不可被源文替代的编辑性内容；(3) 与 Schema 里的 `sdPublisher` 相互印证。

**需要改的代码位置**：`src/app/research/[id]/page.tsx:40`（`searchTitle` 限长）、`:181`（H1 规范化）、`:187-215`（H3 → H2）、`:154,194`（资产 chips 补全）、`src/lib/seo.tsx:89-116`（`reportJsonLd` 扩充 `about`/`mentions`/`citation`）、`src/lib/contentQuality.ts:15-27`（标题门禁）。

### E.6 研报流 `/research`

**Current（实测）**：Title `Verified Institutional Research & Structured Views · Tlines Institutional Intelligence`（**86 字符**）；H1 `Latest Research`；正文 1140 词；H2 = 20（每条卡片一个）；内链 73；canonical 对 `?page=2` 保留分页；过滤态 `noindex, follow`（正确）；有 `rel=prev/next`（正确）。

**Recommended**
- Title：`Institutional Research Feed — Source-Linked Bank Reports \| Tlines`（**≤60 字符**）
- H1：`Latest institutional research`（保留"feed"含义但加品类词）
- 新增 Intro（100–150 词）：说明收录标准（"公开发布""可溯源""通过质量门禁"）与更新频率，并链到 `/methodology`。
- **`?q=` 修正**：实现真实过滤，或从 `filtered` 判断里移除 `q`（消除不一致）。
- **卡片 H2 文本需清洗**：实测卡片标题出现 `for the full chart pack` 这类被截断的正文片段（`/en/research` 的 H2 列表可见）。应过滤明显非标题片段。
- 新增 `ItemList` Schema。
- 分页：为 `/research` 与 `/institutions` 统一补 `rel=prev/next`（`/institutions` 目前缺失），并考虑对深分页（如 >10 页）改 `noindex, follow` + canonical 到第 1 页，避免 50 页分页稀释抓取预算。

### E.7 机构页 `/institution/{slug}`

**Current（实测 `/en/institution/saxo`）**：Title `Saxo Bank Market Outlook, Forecasts & Research | Tlines`（55 字符，**良好**）；H1 `Saxo Bank`；正文 247 词；H2 = 0，H3 = 10；JSON-LD ProfilePage + BreadcrumbList；内链 45。

**Recommended**
- H1：`Saxo Bank — published research and current views`（补意图，但**不要**暗示官方关系）
- **首屏合规声明**（§C4 第 1 条）**必须新增**。
- H2 结构：`Current views by asset` / `Recent research` / `Forecast record` / `How Tlines covers this institution`
- Intro（100–150 词）：覆盖资产数、报告数、最近更新时间、口径说明。
- Schema：保留 `ProfilePage` + `mainEntity: Organization`；**新增 `ItemList`**（该机构最新研报）。
- **内链强化**：机构页应链接到 `/institution/{slug}/accuracy`（预测记录）——这是最强 E-E-A-T 资产，当前仅在 sitemap 中，未在页面显眼处互链。

### E.8 预测结算页 `/institution/{slug}/accuracy`（被严重低估的资产）

**Current（实测 `/en/institution/saxo/accuracy`）**：Title `Saxo Bank forecast record · Tlines Institutional Intelligence`（61 字符）；H1 `Saxo Bank`；正文 **111 词**；**H2 = 0**；**JSON-LD 无**；内链 17；含方法论段落（Wilson 区间、取数规则）。

**Recommended**
- Title：`{Institution} Forecast Accuracy — How Its Calls Settled \| Tlines`（机构名 + 明确意图）
- H1：`{Institution} forecast record`
- **新增一个 H2 段落做"可核验性"声明**（当前只有 111 词，且没有把"为什么这页值得信"说出来）：
  > EN: `Each forecast below was published publicly by {Institution} with a stated target and date. Tlines records the first same-source observation on or after the target date and marks the call settled, missed or inconclusive. The method and its limits are described below and are not adjusted after the fact.`
- Schema：**新增 `Dataset`**，`measurementTechnique` 写入结算方法，`variableMeasured` 写入方向/目标/误差。理由：这是站点唯一的**可量化、可复现的客观记录**，是金融 YMYL 场景下最强的信任信号；目前它零结构化数据、111 个词，几乎不可能被搜索理解为"可核验记录"。
- **内链**：从每个机构页、以及每一篇该机构的研报页正文底部链接过来。

### E.9 宏观 Hub 与子页

**Current（实测）**

| 页面 | Title | H1 | 正文 | H2 | JSON-LD |
|---|---|---|---|---|---|
| `/en/macro` | `Economic Data · Tlines…`（49） | **无 H1** | 166 词 | 1 | 无 |
| `/en/macro/calendar` | `Economic Calendar · Tlines…`（53） | `Economic Calendar` | 596 词 | 0 | 无 |
| `/en/macro/indicator/US_CPI_HEADLINE` | `Consumer Price Index · Tlines…`（56） | `Consumer Price Index` | 416 词 | 0 | 无 |
| `/en/macro/release/…` | `FOMC Policy Decision · Tlines…`（56） | `FOMC Policy Decision` | 542 词 | 0 | 无 |

**Recommended**
- `/en/macro`：**补 H1**（`Economic data — releases, forecasts and what institutions expected`），补 Intro，补 `CollectionPage` + `ItemList`。
- 指标页：Title → `US CPI — Actual, Consensus & Institutional Forecasts \| Tlines`（把"机构预期"这个差异点写进标题，实测 `Fed rate outlook`/`US inflation outlook` 的意图正是"发布前机构怎么预期"）。补 H2 骨架：`Latest release` / `What institutions expected` / `Revision history` / `Releases ahead`。**新增 `Dataset` Schema**（这是真正的数据集）。
- 发布页：补 H2 骨架 + `Dataset`（发布值/共识值/修订）与 `FAQPage`（"这次为什么超预期"这类问答，若内容真实存在）。
- **新增内部链接**：指标页 ↔ 相关资产页（CPI ↔ `/markets/fed`→`/topics/fed`、`/markets/gold`；非农 ↔ `/markets/us-dollar-index`）。

### E.10 政策页（8 个）

**Current**：Title 形如 `Methodology · Tlines Institutional Intelligence`；正文 61–115 词；H2 = 0；JSON-LD `WebPage`；内链 16（全部 chrome）。

**Recommended**
- 每页补 H2 骨架（3–5 个），把当前单段 `PAGES[slug][1]`（`src/app/[policy]/page.tsx:7-16`）扩写为结构化章节。**尤其 `methodology` 与 `sources`**——它们是 E-E-A-T 的承载页，各 38 词与 33 词实在不足以支撑一个 YMYL 站点的信任声明。
- 补 `webPageJsonLd` 中的 `dateModified`、`author`（Organization）、`isPartOf`（已有）。
- **从内容语境反向链接**（当前为 0）：
  - 每篇研报页脚 → `Methodology`（anchor：`How Tlines structures a report`）
  - 每个资产页的共识块 → `Methodology`（anchor：`How consensus is computed`）
  - 每个准确率页 → `Corrections`（anchor：`How we correct a settled call`）
  - 每篇研报来源链接旁 → `Sources`（anchor：`How we choose sources`）
- `About` 页新增 `Organization` 的 `publishingPrinciples` 指向本页，并补 `foundingDate`（若可公开）。

### E.11 Market Themes 公开页（新增 `/market-themes`）

**Current（实测 `/en/watchlist`）**：`noindex, nofollow, nocache`；无 canonical；hreflang 0；正文 163 词。

**Recommended**：新增公开可索引页 `/market-themes`，内容为**当期**主线的概要版：

| 块 | 内容 | Schema |
|---|---|---|
| H1 | `Market themes — what institutions are trading now` / `交易主线：机构正在交易什么` | — |
| 当期主线列表 | 每条：主线名、方向、支持机构数、证据摘要（不含完整链接）、生成时间 | `ItemList` + `Observation` |
| 方法块 | 生成逻辑摘要 + 链到 `/methodology` | — |
| CTA | `See full evidence and live tracking` → `/watchlist`（登录） | — |

**Reason**：实测这是 SERP 上无人承接的内容形态（`market consensus`/`institutional market views` 的意图），且是 Tlines 的核心卖点。公开概要 + 登录后完整证据链，是"拿搜索入口"与"保付费墙"的平衡点。定价页/登录页继续 `noindex`，公开页 `index, follow` 并有 canonical。

### E.12 中英文国际 SEO

**Current（实测）**
- `/en` 与 `/zh` 均输出 3 条 alternate（`en` / `zh-CN` / `x-default`→`/en`），**双向完整**（正确）
- 中文可索引覆盖率 **43%**（429/988）
- 降级页出现 **4 字符 meta description**
- 中文首页 **532 汉字**（对应英文 197 词）——中文内容比英文更薄

**Recommended**
1. **hreflang 保持现状**（已正确）。补齐一处：`/watchlist` 因 noindex 而无 alternate（可接受），新增的 `/market-themes` 必须带完整三组。
2. **sitemap 补 `xhtml:link`**：当前 `renderUrlset`（`src/lib/sitemap.ts:205-215`）只输出 `loc/lastmod/changefreq/priority`，没有 hreflang 注解。虽然 HTML head 已声明，但在 sitemap 中同时声明对**中文页大量 noindex 的站点**尤其有价值——它让 Google 明确知道"英文页的中文对应版本存在但暂不可索引"，而不是把中文页当成独立重复内容。需给 `renderUrlset` 加 `xmlns:xhtml` 与每 entry 的 `xhtml:link rel="alternate"`。
3. **中文标题/描述独立撰写，不直译**：`assetSeoTitle` 现为 `${name}机构展望与银行预测｜Tlines`，实测中文首页 title 用全角 `｜`，风格统一，可保留；但需针对中文意图重写：中文用户搜"黄金 走势 机构观点""美联储 加息 预期"这类**词序**，建议中文 Title 形如 `黄金机构观点与目标价｜银行最新预测 · Tlines`。
4. **修 4 字符 description**：`src/app/research/[id]/page.tsx:41-42` 的 fallback 在 summary 缺失时退化为机构名。改为：`summary ?? 取 analysis.oneSentence ?? title + 机构名 + 日期`，保证 ≥70 汉字。
5. **中文降级页要有修复回路**：`contentQuality.ts:49` 的 `translation_below_threshold`（<0.8）当前是终点。建议在运营后台暴露"被降级中文页"清单 + 重译入口（`prisma/translate.ts` 已有能力），把 559 篇不可索引中文页变成可关闭的待办队列。

### E.13 内部链接引擎（自动、可落地）

**目标形态**：由数据驱动，而非手工。

**规则（每条给出 A → anchor → B）**

| 从 | Anchor 文本（EN / ZH） | 到 |
|---|---|---|
| 研报页 `atomicViews[].assetTicker` 每个 | `{asset} institutional outlook` / `{资产}机构展望` | `/markets/{asset}` |
| 研报页 `article.institution` | `More {Institution} research` / `更多{机构}研报` | `/institution/{slug}` |
| 研报页 `analysis.topics[]` | `{Topic} outlook` / `{主题}展望` | `/topics/{topic}`（新增） |
| 研报页 同资产最近 3 篇其他机构研报 | `{Asset} views from {OtherInstitution}` | `/research/{slug}` |
| 研报页 `macroForecast.referencePeriod` 关联发布 | `What institutions expected for {release}` | `/macro/release/{id}` |
| 资产页 覆盖机构表每行 | `{Institution} on {asset}` | `/institution/{slug}` |
| 资产页 `Recent View Changes` 每条 | `{Institution} turned {direction} on {asset}` | `/institution/{slug}` |
| 资产页 最新研报（已有，保留） | 研报标题 | `/research/{slug}` |
| 机构页 覆盖资产每个 | `{asset} outlook` | `/markets/{asset}` |
| 机构页 准确率入口（**新增**） | `{Institution} forecast record` | `/institution/{slug}/accuracy` |
| 机构页 最新研报（已有） | 研报标题 | `/research/{slug}` |
| 指标页 关联资产（**新增**） | `{asset} outlook` | `/markets/{asset}` |
| 主题页 支持证据（**新增**） | 研报标题 / 资产名 | `/research/{slug}`、`/markets/{asset}` |
| 全部页面页脚上方（**新增**） | `How Tlines structures a report` | `/methodology` |
| 全部共识类模块（**新增**） | `How consensus is computed` | `/methodology` |

**实现建议**：新增 `src/lib/related.ts`，导出 `relatedForResearch()`、`relatedForAsset()`、`relatedForInstitution()`、`relatedForTopic()`，内部用 Prisma 按 `ArticleAsset`/`AtomicView`/`topic`/`institution` 做共现查询。当前代码库**没有任何此类 helper**（`src/app/research/[id]/page.tsx:154` 里只有一个内联的 `relatedAssets` 映射），这是需要新建的模块。

**量化目标**（可作为验收标准）：
- 研报页链接到**资产页**的比例：**57% → 100%**（无资产关联的研报另行判定是否 index，见 §F2）
- 研报页链接到**同业主研报**的数量：**0 → ≥3**
- 研报页链接到**主题页**：**0 → ≥1**
- 研报页链接到**指标/发布页**：**0 → ≥1**（存在关联时）
- 研报页从首页的抓取深度：**约 50 层 → ≤3 层**

---

## F. Programmatic SEO Strategy

### F1. 哪些页适合程序化

**适合（已有数据支撑，应做并用 Schema + Intro 强化）**
- `/markets/{asset}`（19 个）— 数据最完整，SERP 需求最明确
- `/topics/{topic}`（新增 6–8 个）— 实测意图最强、当前完全缺失
- `/institution/{slug}`（50 个）— 已有
- `/institution/{slug}/accuracy`（22 个）— 独有资产，需强化
- `/macro/indicator/{key}`（22 个）— 已有
- `/macro/release/{id}`（85 条，持续增长）— 需评估，见 F2

**不适合（不要做）**
- `{Asset} × {Institution}` 组合页（19×50=950 页）— 绝大多数组合只有 0–1 篇研究，必然薄页
- `{Asset} × {Topic} × {Date}` 任意组合
- `{Research} × {任何维度}` 的自动衍生页

### F2. Indexation Threshold（量化门禁）

现有门禁在 `src/lib/contentQuality.ts`，方向正确但**不够**。建议的完整门禁表：

| 页面类型 | 允许 index 的条件（全部满足） | 不满足时 |
|---|---|---|
| `/research/{slug}` | ① `title` 长度 8–120 且**通过扩展后的噪声正则**；② `body ≥ 300` 字符；③ 有 summary；④ `sourceUrl` 为 https；⑤ `analysis.reviewStatus === "ok"`；⑥ **新增：有 ≥1 个可用资产/主题关联，或正文总词数 ≥ 600**；⑦ **新增：`<title>` 与 `<h1>` 非高度重复的机构名系列** | `noindex, follow` + 不进 sitemap |
| `/zh/research/{slug}` | 上述全部 + 译文 `qualityScore ≥ 0.8` + 译文含汉字符 + 译文长度 ≥ 原文 40% | `noindex, follow` |
| `/markets/{asset}` | ≥2 家机构 且 ≥2 篇研报（**现逻辑，保留**） | `noindex, follow` |
| `/topics/{topic}` | ≥3 家机构 且 ≥5 篇关联研报 且 有编辑撰写的固定 Intro | 不生成该路由（404） |
| `/institution/{slug}` | ≥1 篇 publication-ready（**现逻辑，保留**） | `noindex, follow` |
| `/institution/{slug}/accuracy` | ≥1 条 settled forecast（**现逻辑，保留**） | `noindex, follow` |
| `/macro/indicator/{key}` | `enabled` 且 ≥3 期历史发布 | 不生成 |
| `/macro/release/{id}` | 有 consensus 快照 **或** 有机构预测 | `noindex, follow` |
| `/research`（列表） | 仅第 1 页 index | 深分页 `noindex, follow` |
| `/market-themes` | 有当期主线快照 | `noindex, follow` |

### F3. 需要新增的标题噪声拦截（对应 A2 实测）

在 `src/lib/contentQuality.ts` 的 `BAD_TITLE` 之外新增 `NOISE_TITLE` 规则，至少覆盖：

```
/^pdf\b/i                       // "PDF 777 Kb"
/\bfile of entire text\b/i      // Daiwa 抽取噪声
/^(?:untitled|unknown|n\/a|-+)$/i
/^(?:download|view|read)\s+(?:pdf|document|report)$/i
/^\d+\s*(?:kb|mb|pages?)$/i
/^[^a-zA-Z\u4e00-\u9fff]*$/     // 无实义字符
```

并对**全小写标题**做规范化（首字母大写 + 句首大写），而非直接 noindex——因为那 17% 的页面内容其实是好的，只是大小写损坏。

**批量治理既有 988 页**：新增 `scripts/title-audit.ts`，输出三类清单（垃圾标题 / 全小写 / 超 60 字符），并复用已有的 `prisma/retitle.ts` 重跑 AI 标题生成。这是 P0 工作项（见 §H）。

### F4. 防止规模化垃圾页的运营闸门

1. **入库时**：`publicationReadyWhere()` 之后增加 title 质量检查，不合格的标记 `titleNeedsRepair` 而非直接发布。
2. **发布时**：sitemap 只收录通过 F2 门禁的页面（现有机制，扩展到新页面类型）。
3. **周度巡检**：新增脚本，报告"被 noindex 的页面数 / 新增页面的门禁通过率 / 中文覆盖率"，作为运营指标。
4. **禁止**：在没有编辑撰写的 Intro 的前提下批量生成 `/topics/*`。

---

## G. Technical SEO Fixes

按"改动成本 / 影响"排序。

| # | 问题（实测） | 修复 | 文件位置 |
|---|---|---|---|
| 1 | 988 页研报标题 90% 超 60 字符，品牌后缀占 35 字符 | 品牌后缀改为 ` \| Tlines`；`searchTitle` 加 60 字符硬截断 | `src/app/layout.tsx:22-24`、`src/app/research/[id]/page.tsx:40` |
| 2 | 垃圾标题通过门禁并被 index（`PDF 777 Kb`、`file of entire text`） | 扩展 `BAD_TITLE` → `NOISE_TITLE`（§F3）；对全小写做规范化而非 noindex | `src/lib/contentQuality.ts:15` |
| 3 | 首页与栏目页 H2 = 0，H1 后直接 H3（跳级） | `div.section-t` → `<h2>`（首页 4 处、资产页 5 处、机构页 2 处） | `src/app/page.tsx`、`src/app/asset/[ticker]/page.tsx`、`src/app/institution/[slug]/page.tsx` |
| 4 | `/macro` 无 H1 | 补 H1 | `src/app/macro/page.tsx:77` 附近 |
| 5 | 目录页零 Schema（`/markets`、`/research`、`/institutions`、`/macro*`） | 补 `CollectionPage` + `ItemList` | 对应 page.tsx；`src/lib/seo.tsx` 新增 `itemListJsonLd()` |
| 6 | sitemap 无 hreflang 注解 | `renderUrlset` 增加 `xmlns:xhtml` 与 `xhtml:link` | `src/lib/sitemap.ts:205-215` |
| 7 | `/watchlist` 无 canonical 且完全不可索引 | 保留 noindex；补 canonical → `/market-themes`；新增公开页 | `src/app/watchlist/page.tsx:24`、新增 `src/app/market-themes/page.tsx` |
| 8 | `?q=` 不生效（noindex 但不搜索） | 二选一（§D2 改动 4） | `src/app/research/page.tsx:14,20,50-65` |
| 9 | `/markets/fed`、`/markets/cpi` 语义错误 | 迁移到 `/topics/fed`、`/topics/inflation` + 308 | `src/middleware.ts`（仿 `:71-77` 的 asset 重定向） |
| 10 | 中文降级页 description 退化为 4 字符 | fallback 链改为 `summary → oneSentence → title+机构+日期` | `src/app/research/[id]/page.tsx:41-42` |
| 11 | 缺 favicon.ico / apple-touch-icon / manifest | 新增 `src/app/favicon.ico`、`src/app/apple-icon.png`、`src/app/manifest.ts` | 新增文件（`public/` 当前只有 `sw.js` 与 `pdfjs/`） |
| 12 | `Organization.sameAs` 为空数组 | 配置 `BRAND_SAME_AS` 环境变量（X/Feishu 等官方账号）；补 `description`、`publishingPrinciples`、`foundingDate` | `src/lib/seo.tsx:73-81`、`.env` |
| 13 | `/institutions` 分页无 `rel=prev/next` | 补 rel | `src/app/institutions/page.tsx:107-111` |
| 14 | 大小写路径 `/EN/research` → `/en/EN/research`（双重前缀 404） | 中间件对语言段做大小写归一 | `src/middleware.ts:17,81-98` |
| 15 | 研报页链接到 robots 禁止的 `/api/documents/{id}` | 若需 PDF 可抓取，另开可抓取路径；否则保持（不影响页面索引） | `src/lib/site.ts:23` |
| 16 | 深分页（约 50 页）稀释抓取预算 | 深分页 `noindex, follow` + canonical 到第 1 页；同时用 §E.13 的横向链接降低深度 | `src/app/research/page.tsx:24,83-94` |

**页面速度**（实测 TTFB 226–650ms，JS 约 158 KB gzip）：**未发现需要修复的性能问题**。唯一值得关注的是研报页的 pdf.js（`public/pdfjs/` 含 `pdf.worker.min.mjs` + `cmaps/` 数百个文件）——它在 hydration 后才加载，不影响首屏 LCP，但会推高 INP。建议对 `PdfPreview` 用 `next/dynamic` + `ssr: false` 明确懒加载，并确认 worker 不阻塞主线程。**不要为了 SEO 改动现有 UI。**

---

## H. 90 天执行优先级

### P0（第 1–3 周）— 止血 + 建立度量

| # | 任务 | 验收标准 | 涉及 |
|---|---|---|---|
| P0-1 | **接入 GSC + Bing 站长工具**，提交 sitemap，建立基线报告 | 拿到真实查询/展示/点击数据 | — |
| P0-2 | **标题治理**：扩 `NOISE_TITLE` 门禁 + 品牌后缀降到 ` \| Tlines` + 全小写标题规范化 | 抽样 30 页中垃圾标题 0；标题 ≤60 字符比例 ≥80% | `contentQuality.ts`、`layout.tsx`、`research/[id]/page.tsx` |
| P0-3 | **批量重跑垃圾标题页**（`scripts/title-audit.ts` + `prisma/retitle.ts`） | 上一项针对存量 988 页生效 | 新增脚本 |
| P0-4 | **首页与栏目页 H2 修复 + 首页 H1/Hero/Description 改写**（§E.1 全文已给出） | 首页 H2 ≥6 个；H1 含品类词；desc ≤160 | `page.tsx`、`seo.tsx` |
| P0-5 | **资产页 H1 + Intro 上线**（19 页，§E.2 文案已给出） | 每页正文 ≥350 词；H1 含意图 | `asset/[ticker]/page.tsx` |
| P0-6 | **`?q=` 不一致修复** | `?q=` 要么真过滤要么不触发 noindex | `research/page.tsx` |
| P0-7 | **`/macro` 补 H1**；目录页补 `ItemList`/`CollectionPage` | 结构化数据覆盖 6 类页面 | 各 page.tsx、`seo.tsx` |

### P1（第 4–8 周）— 建结构 + 建连接

| # | 任务 | 验收标准 |
|---|---|---|
| P1-1 | **新增 `/topics/[topic]`**（fed / inflation / rates / us-economy / central-banks / ai-capex / china），带 §F2 门槛与手工 Intro | ≥6 个主题页上线且被收录 |
| P1-2 | **`/markets/fed`、`/markets/cpi` → `/topics/*` 迁移 + 308** | 旧 URL 全部 308，无 404 |
| P1-3 | **内部链接引擎 `src/lib/related.ts`**（§E.13 全部规则） | 研报页→资产页覆盖 57%→100%；研报页→同业研报 0→≥3；深度 ≤3 |
| P1-4 | **`/market-themes` 公开页上线**，`/watchlist` 补 canonical | 公开页 index；登录页仍 noindex |
| P1-5 | **准确率页升级**（H2 + 可核验性文案 + `Dataset` Schema） | 22 页全部更新；Schema 校验通过 |
| P1-6 | **政策页扩写 + 语境内链**（methodology/sources/corrections 各 ≥400 词，各 ≥3 个 H2） | 政策页内链从 16 → ≥40（含语境链接） |
| P1-7 | **中文修复回路**：降级页清单 + 重译队列 + description 兜底 | 中文覆盖率 43% → ≥65% |
| P1-8 | **sitemap 补 hreflang 注解**；`favicon.ico`/`apple-touch-icon`/`manifest` | 技术项全部关闭 |

### P2（第 9–12 周）— 扩量 + 复核

| # | 任务 |
|---|---|
| P2-1 | **`Organization` 实体补全**（`sameAs`、`description`、`publishingPrinciples`、`foundingDate`）+ 在 `About` 页给实体定义段落 |
| P2-2 | **可索引搜索结果页**（或站内搜索长尾落地页）+ `WebSite.potentialAction`（SearchAction） |
| P2-3 | **新增解释型内容**：`how to read institutional research reports`（实测缺口：无第一方示例、无跨机构评级口径对照） |
| P2-4 | **资产 slug 补齐**（`xagusd`→`silver`、`natgas`→`natural-gas`、`gbpusd`→`gbp-usd`、`sox`→`semiconductors`），带 308 |
| P2-5 | **深分页治理** + `rel=prev/next` 统一 |
| P2-6 | **用 GSC 数据回填 §C 的 Keyword hypothesis**，据真实查询重构优先级与页面文案 |
| P2-7 | **SERP 复核**：用 Ahrefs/Semrush 快照验证 §0.2 中标记为"不可靠"的排名结论 |
| P2-8 | **建立周度 SEO 巡检**（被 noindex 页数 / 门禁通过率 / 中文覆盖率 / 新页面收录率） |

---

## 附录 A：本方案中所有"实测"数据的来源

| 数据 | 值 | 来源 |
|---|---|---|
| sitemap URL 总数 | 1649（研报 1417 + 页面 232） | 解析 `sitemap.xml` → `sitemap/0.xml`、`sitemap/1.xml` |
| 英文/中文研报 URL | 988 / 429 | 同上（中文覆盖率 43%） |
| 机构/资产/指标/准确率页 | 50 / 19 / 22 / 22（每语言） | `sitemap/0.xml` 计数 |
| 首页正文字数 | 197 词（EN）/ 532 汉字（ZH） | Googlebot UA 抓取 + 去标签计数 |
| 首页 H2 数 | 0（H3 = 8） | 同上 |
| 研报页标题超 60 字符 | 27/30（90%） | 30 页抽样（英文 shard 每 33 条取 1） |
| 研报页 H1 全小写 | 5/30（17%） | 同上 |
| 研报页 title ≠ H1 前缀 | 7/30（23%） | 同上 |
| 研报页零资产链接 | 17/30（57%） | 同上（解析渲染后 HTML 的 `<a href>`） |
| 研报页零同业研报/零宏观链接 | 30/30（100%） | 同上 |
| 研报页正文区间 | 282–3846 词 | 同上 |
| `/en/watchlist` robots | `noindex, nofollow, nocache`，canonical 空 | 实测 |
| `/en/research?q=gold` | 1140 词（与无参数相同）+ `noindex, follow` | 实测 |
| `/en/macro` H1 | 无 | 实测 |
| 降级中文页 description | 4 字符 | 实测 `/zh/research/standard-chartered-navigating-divergence-…` |
| PDF 来源页 HTML 段落数 | 3 个 `<p>`，最长 154 词 | 实测 `intesa-sanpaolo-macro-weekly-economic-viewpoint` |
| 首页 JS 传输量 | 约 158 KB（gzip，11 chunk） | 逐个 chunk 下载求和 |
| TTFB 区间 | 226–650ms | 全部实测样本 |
| 重定向 | `/`→`/en` 308、`/cn`→`/zh` 308、`/en/asset/gold`→`/en/markets/gold` 308、`/en/consensus/*`→`/en/research` 308、尾斜杠 308、http/www 跳转规范域 | 实测 |
| 404 | `/en/nonexistent-page-xyz`、`/en/research/does-not-exist-xyz` 均真 404（非 soft 404），带 noindex | 实测 |
| Organization sameAs | `[]`（`BRAND_SAME_AS` 仅存在于 `.env.example:137` 且被注释，未进入生产环境） | 实测生产 JSON-LD |

## 附录 B：需要你用第一方数据解决的问题

1. **真实关键词量与难度**——本方案所有关键词优先级都基于 SERP 页面类型与站点能力，不是流量估算。
2. **当前收录与展示基线**——需 GSC。
3. **988 篇研报的实际流量分布**——判断"哪些页值得 index"最终要靠真实展示数据；F2 的门禁是保守起点，不是终点。
4. **中文 559 篇降级页的降级原因分布**——需跑一次 `contentQuality` 的 issue 统计。

## 附录 C：留给你验收的复跑命令

```bash
# 站点地图与 URL 组成
node .preview/seoaudit/audit.mjs https://tlines.tech/en https://tlines.tech/zh
COMPACT=1 node .preview/seoaudit/audit.mjs https://tlines.tech/en/markets/gold

# 研报页内链与标题质量（每 33 条抽样）
node .preview/seoaudit/links.mjs
```
