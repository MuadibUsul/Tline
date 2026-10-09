# Tlines SEO 关键词增长工程（第四阶段）

日期：2026-10-09
范围：关键词研究、页面映射、动态元信息、上下文内链与自动验收；未部署生产、未修改生产数据库、未批量创建页面。

## 1. 结论

本阶段建立了 **42 个关键词**的可维护配置，其中 **8 个为用户提供的 GSC 已观察词**，其余 34 个为候选词。关键词映射到 11 个已有规范页面；8 个词因站内证据不足保持 `content_gap`，没有创建薄内容页。

当前本地语料足以支持黄金、WTI、EUR/USD、美国 10 年期国债、DXY、Nasdaq-100、Westpac、Saxo、Wellington、美联储主题和研报总览。当前语料不足以支持：

- Brent：数据模型只有 `WTI`，旧别名虽包含 `brent`，但不能把 WTI 页面冒充 Brent 页面。
- Nomura Chip Shortage Index：Nomura 本地 4 篇可索引研报均不是该研究；站外研究存在不等于 Tlines 已收录。
- 亚太 REITs：尚无达到专题门槛的规范页面。

搜索量、关键词难度和增长预测均为 **unknown**。没有接入关键词工具或 GSC API，也没有用搜索结果数量代替搜索量。

## 2. 数据和研究边界

### GSC

可用证据仅为项目负责人给出的 8 个查询词。仓库审计文档已记录：没有认证的 GSC 导出或 API，因此无法取得每词点击、曝光、CTR、平均排名或按日期变化。本阶段不会给这些字段填入估算值。

### 公开搜索意图证据

2026-10-09 的公开搜索用于确认意图和竞争页面类型，不用于估算搜索量：

- 黄金：[J.P. Morgan Global Research 的 2026/2027 黄金预测](https://www.jpmorgan.com/insights/global-research/commodities/gold-prices)说明用户期望看到具体目标、单位、日期和理由。
- EUR/USD：[MUFG Monthly Foreign Exchange Outlook](https://www.mufgresearch.com/fx/monthly-foreign-exchange-outlook-october-2026/)以季度目标表和修订理由承接该意图。
- 原油：[Danske Bank 公开预测 PDF](https://research.danskebank.com/link/FXForecastUpdate170426/%24file/FX%20ForecastUpdate_170426.pdf)展示 Brent 的季度/年度值，证明 Brent 与 WTI 必须作为不同实体处理。
- 美债与利率：[TD Economics forecast tables](https://economics.td.com/us-forecast-tables)展示期限明确的利率预测；[Federal Reserve projection materials](https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260318.htm)是官方预测材料，不能冒充银行共识。
- Nomura：[Nomura Chip Shortage Index 原文](https://www.nomuraconnects.com/focused-thinking-posts/nomuras-chip-shortage-index-a-signal-for-ai-era-business-cycle/)证实名词和意图，但该报告尚未进入 Tlines 可索引语料。
- Westpac：[Westpac IQ](https://www.westpac.com.au/corporate-banking/westpaciq/)确认品牌研究入口和经济/市场策略定位；受限内容不视为 Tlines 可展示证据。
- Wellington：[Markets and Outlooks](https://www.wellington.com/en-gb/professional/insights/markets-and-outlooks)确认品牌展望意图。

## 3. 实际语料覆盖

`npm run seo:keywords` 对数据库只读检查，所有映射目标均存在且符合当前索引门槛。

| 规范页面 | 类型 | 可索引研报 | 发布机构 | 已存且有期限的目标 | 最新发布日期 | 处理 |
|---|---|---:|---:|---:|---|---|
| `/markets/gold` | asset | 57 | 19 | 7 | 2026-09-04 | 优先增强 |
| `/markets/crude-oil-wti` | asset | 56 | 19 | 3 | 2026-09-07 | 仅称 WTI，不称 Brent |
| `/markets/eur-usd` | asset | 18 | 10 | 5 | 2026-09-07 | 优先增强 |
| `/markets/us-10-year-treasury` | asset | 67 | 21 | 5 | 2026-09-07 | 优先增强 |
| `/markets/us-dollar-index` | asset | 31 | 18 | 1 | 2026-09-07 | 优先增强 |
| `/markets/nasdaq-100` | asset | 12 | 7 | 0 | 2026-08-28 | 展示观点，不生成目标分布 |
| `/institution/federal-reserve` | subject institution | 61 | 26 | — | 2026-09-07 | 区分官方决定与第三方观点 |
| `/institution/westpac` | publisher | 15 | 1 | — | 2026-09-01 | 优先增强 |
| `/institution/saxo` | publisher | 11 | 1 | — | 2026-09-01 | 优先增强 |
| `/institution/wellington-management` | publisher | 1 | 1 | — | 2026-08-06 | 单机构/单报告表述，不声称共识 |
| `/research` | collection | 317 | 多机构 | — | 2026-09-07 | 动态显示总量 |

“已存且有期限”只是结构完整性统计；页面仍通过第三阶段的原文校验后才展示目标。当前数据库最新研报日期早于当前日期，因此页面不把“最新”解释为“今天”。

## 4. 关键词配置

规范配置为 `data/seo-keywords.json`。每条记录都包含：`keyword`、`language`、`intent`、`topic`、`entity`、`target_url`、`supporting_terms`、`source`、`evidence`、`priority`、`status`、`last_verified_at`。

| # | keyword | language | intent | topic | entity | target_url | supporting_terms | source | priority | status |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | westpac iq | en | institution_research | westpac-research | Westpac / Westpac IQ | `/institution/westpac` | Westpac economic outlook; Westpac forecasts | GSC observed | P0 | gsc_observed |
| 2 | nomura chip shortage index | en | named_research | nomura-chip-shortage-index | Nomura Connects | — | Nomura CSI; semiconductor shortage index | GSC observed | P0 | content_gap |
| 3 | 威靈頓管理 市場展望 | zh-CN | institution_research | wellington-outlook | Wellington Management | `/institution/wellington-management` | 惠灵顿管理; 投资展望 | GSC observed | P0 | gsc_observed |
| 4 | saxo bank research | en | institution_research | saxo-research | Saxo Bank | `/institution/saxo` | Saxo insights; Saxo market outlook | GSC observed | P0 | gsc_observed |
| 5 | westpac cash rate forecast | en | forecast_comparison | westpac-cash-rate | Westpac / Westpac IQ | `/institution/westpac` | RBA cash rate; Westpac rate outlook | GSC observed | P0 | gsc_observed |
| 6 | 美元指数 dxy 最新 | zh-CN | asset_outlook | us-dollar-index | DXY | `/markets/us-dollar-index` | 美元指数机构观点; DXY展望 | GSC observed | P0 | gsc_observed |
| 7 | 科技股前景 | zh-CN | asset_outlook | technology-stocks | Nasdaq 100 | `/markets/nasdaq-100` | 纳斯达克100展望; 科技股机构观点 | GSC observed | P1 | gsc_observed |
| 8 | 2025 亞太 reits 展望 | zh-CN | topic_outlook | asia-pacific-reits | Asia Pacific REITs | — | 亚太REITs; 房地产投资信托展望 | GSC observed | P2 | content_gap |
| 9 | gold price forecast by banks 2027 | en | forecast_comparison | gold-forecast | XAUUSD | `/markets/gold` | bank gold targets; gold outlook | user + public search | P0 | candidate_mapped |
| 10 | gold price forecast by banks | en | forecast_comparison | gold-forecast | XAUUSD | `/markets/gold` | gold target price banks; institutional gold views | public search | P0 | candidate_mapped |
| 11 | gold target price banks | en | forecast_comparison | gold-forecast | XAUUSD | `/markets/gold` | gold price targets; bank gold forecast | editorial | P1 | candidate_mapped |
| 12 | 投行黄金目标价对比 | zh-CN | forecast_comparison | gold-forecast | XAUUSD | `/markets/gold` | 黄金机构预测; 黄金目标价 | user + public search | P0 | candidate_mapped |
| 13 | 2027年黄金价格预测 | zh-CN | forecast_comparison | gold-forecast | XAUUSD | `/markets/gold` | 2027黄金目标价; 银行金价预测 | public search | P1 | candidate_mapped |
| 14 | brent crude oil forecast 2027 banks | en | forecast_comparison | brent-oil-forecast | Brent crude | — | Brent bank targets; 2027 oil forecast | user + public search | P0 | content_gap |
| 15 | brent oil bank targets | en | forecast_comparison | brent-oil-forecast | Brent crude | — | Brent price outlook; bank oil forecasts | public search | P1 | content_gap |
| 16 | 2027年布伦特原油价格预测 | zh-CN | forecast_comparison | brent-oil-forecast | Brent crude | — | 布伦特目标价; 原油机构预测 | user + public search | P0 | content_gap |
| 17 | WTI crude oil institutional outlook | en | asset_outlook | wti-oil-outlook | WTI | `/markets/crude-oil-wti` | WTI bank forecasts; crude oil views | corpus | P1 | candidate_mapped |
| 18 | WTI原油机构观点 | zh-CN | asset_outlook | wti-oil-outlook | WTI | `/markets/crude-oil-wti` | WTI油价预测; 原油研报 | corpus | P1 | candidate_mapped |
| 19 | EUR USD bank forecasts 2027 | en | forecast_comparison | eur-usd-forecast | EURUSD | `/markets/eur-usd` | EUR/USD targets; euro dollar outlook | user + public search | P0 | candidate_mapped |
| 20 | EUR/USD bank targets | en | forecast_comparison | eur-usd-forecast | EURUSD | `/markets/eur-usd` | bank FX forecasts; EUR USD outlook | public search | P1 | candidate_mapped |
| 21 | 欧元美元汇率机构预测 | zh-CN | forecast_comparison | eur-usd-forecast | EURUSD | `/markets/eur-usd` | 欧元兑美元银行预测; EURUSD目标价 | user + public search | P0 | candidate_mapped |
| 22 | 欧元兑美元银行预测 | zh-CN | forecast_comparison | eur-usd-forecast | EURUSD | `/markets/eur-usd` | 欧元美元展望; 外汇机构观点 | editorial | P1 | candidate_mapped |
| 23 | US 10 year Treasury yield forecast | en | forecast_comparison | us-10y-yield | US10Y | `/markets/us-10-year-treasury` | 10-year yield outlook; Treasury bank forecasts | user + public search | P0 | candidate_mapped |
| 24 | 10-year Treasury bank outlook | en | forecast_comparison | us-10y-yield | US10Y | `/markets/us-10-year-treasury` | US bond yield forecast; bank rates outlook | editorial | P1 | candidate_mapped |
| 25 | 10年期美债收益率机构预测 | zh-CN | forecast_comparison | us-10y-yield | US10Y | `/markets/us-10-year-treasury` | 美国国债收益率展望; 美债机构观点 | user + public search | P0 | candidate_mapped |
| 26 | 美国10年期国债收益率预测 | zh-CN | forecast_comparison | us-10y-yield | US10Y | `/markets/us-10-year-treasury` | 10年美债预测; 美债收益率目标 | editorial | P1 | candidate_mapped |
| 27 | fed rate forecast 2027 bank outlook | en | policy_outlook | federal-reserve-policy | Federal Reserve | `/institution/federal-reserve` | Fed funds path; bank rate forecasts | user + public search | P0 | candidate_mapped |
| 28 | Federal Reserve rate path forecast | en | policy_outlook | federal-reserve-policy | Federal Reserve | `/institution/federal-reserve` | FOMC outlook; Fed policy forecasts | public search | P1 | candidate_mapped |
| 29 | 美联储利率路径机构预测 | zh-CN | policy_outlook | federal-reserve-policy | Federal Reserve | `/institution/federal-reserve` | 美联储利率展望; FOMC机构观点 | user + public search | P0 | candidate_mapped |
| 30 | 美联储政策利率展望 | zh-CN | policy_outlook | federal-reserve-policy | Federal Reserve | `/institution/federal-reserve` | 联邦基金利率预测; 美联储点阵图 | editorial | P1 | candidate_mapped |
| 31 | 野村芯片短缺指数 | zh-CN | named_research | nomura-chip-shortage-index | Nomura Connects | — | 野村半导体指数; 芯片供需 | user + public search | P0 | content_gap |
| 32 | Nomura semiconductor outlook | en | institution_research | nomura-chip-shortage-index | Nomura Connects | — | Nomura chip cycle; AI semiconductor supply | public search | P1 | content_gap |
| 33 | Westpac IQ economic outlook | en | institution_research | westpac-research | Westpac / Westpac IQ | `/institution/westpac` | Westpac economics; Westpac rate outlook | user + public search | P0 | candidate_mapped |
| 34 | 威灵顿投资管理市场展望 | zh-CN | institution_research | wellington-outlook | Wellington Management | `/institution/wellington-management` | 惠灵顿管理展望; Wellington投资观点 | user + public search | P0 | candidate_mapped |
| 35 | Wellington Management investment outlook | en | institution_research | wellington-outlook | Wellington Management | `/institution/wellington-management` | Wellington market outlook; Wellington insights | public search | P1 | candidate_mapped |
| 36 | Saxo Bank market outlook | en | institution_research | saxo-research | Saxo Bank | `/institution/saxo` | Saxo insights; Saxo research | editorial | P1 | candidate_mapped |
| 37 | institutional research reports | en | research_discovery | institutional-research | Tlines research feed | `/research` | bank research reports; asset manager research | user | P1 | candidate_mapped |
| 38 | bank research reports | en | research_discovery | institutional-research | Tlines research feed | `/research` | public bank research; institution reports | editorial | P2 | candidate_mapped |
| 39 | 机构公开研报 | zh-CN | research_discovery | institutional-research | Tlines research feed | `/research` | 银行研报; 资产管理机构观点 | editorial | P2 | candidate_mapped |
| 40 | US dollar index bank outlook | en | asset_outlook | us-dollar-index | DXY | `/markets/us-dollar-index` | DXY forecast; institutional dollar views | editorial | P1 | candidate_mapped |
| 41 | 科技股机构观点 | zh-CN | asset_outlook | technology-stocks | Nasdaq 100 | `/markets/nasdaq-100` | 纳指机构展望; 科技股研报 | editorial | P1 | candidate_mapped |
| 42 | 亚太REITs机构展望 | zh-CN | topic_outlook | asia-pacific-reits | Asia Pacific REITs | — | 亚太房地产信托; REITs市场展望 | editorial | P2 | content_gap |

每条记录的完整 `evidence` 和 `last_verified_at` 以 JSON 配置为准；上表为便于审阅的映射视图。相同搜索意图的同义词只指向一个主页面。

## 5. 已完成的页面优化

本阶段按“6 个资产页 + 4 个机构/政策页”计算 10 个优先页面：

1. Gold：`/markets/gold`
2. WTI：`/markets/crude-oil-wti`
3. EUR/USD：`/markets/eur-usd`
4. US 10-Year Treasury：`/markets/us-10-year-treasury`
5. DXY：`/markets/us-dollar-index`
6. Nasdaq-100 / 科技股：`/markets/nasdaq-100`
7. Westpac IQ：`/institution/westpac`
8. Saxo Bank：`/institution/saxo`
9. Wellington Management：`/institution/wellington-management`
10. Federal Reserve subject：`/institution/federal-reserve`

另增强 `/research` 的动态报告总量、H1 和 Breadcrumb，但不把它计入上述 10 页。

实现规则：

- Title/H1/description 按语言和实体生成，覆盖机构数、报告数来自数据库。
- 不因候选词包含 `2027` 就把年份写入元信息。
- 自引用 Canonical 与双向 hreflang 沿用第二阶段统一规则。
- JSON-LD 的页面名称和描述与可见 H1/元描述保持一致。
- 目标值按真实标的显示单位：黄金 `$…/oz`、WTI `$…/bbl`、美债 `%`、指数 `points`；EUR/USD 不再错误显示美元符号。
- 机构→资产、资产→机构/报告/专题、专题→机构/报告/资产继续由真实关联数据生成。
- `/research` 增加可见 Breadcrumb 与 BreadcrumbList。
- Sitemap 排除了会重定向到其他分面的旧 `FED`、`CPI` 伪资产 URL。

## 6. 自动化与测试结果

### 关键词与覆盖

命令：`npm run seo:keywords`

- 配置：42 条；GSC 已观察 8；候选 34；内容缺口 8。
- 主页面：11 个规范目标。
- 配置字段完整、关键词无重复、一个意图只对应一个页面。
- 11 个目标全部存在并达到当前索引门槛。
- 搜索量、难度、增长预测：unknown。

### 中英文页面验收

命令：`npm run seo:keyword-pages -- --base=http://127.0.0.1:3104`

- 11 个主页面 × 2 种语言 = 22 个 Googlebot 请求。
- 22/22 通过。
- 重复 Title：0。
- 重复 Canonical：0。
- 意外 noindex：0。
- 每页均有 200、description、H1、自引用 Canonical、hreflang self、x-default、Breadcrumb、JSON-LD、服务端正文与至少 2 个上下文内链。
- WTI 页面未出现 Brent 错标。

### 全站回归

- `npm test`：593/593 通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 本地 `seo-baseline`：10 个 Sitemap 分片、864 个 URL；抽样 24/24 页面通过；Sitemap 重复 URL、站外 URL、缺失 alternate、robots 阻断和未来 lastmod 均为 0。
- 本地全站基线唯一 failure 是静态构建的 `robots.txt` 仍声明生产地址 `https://tlines.tech/sitemap.xml`，而测试 base 是 `127.0.0.1`；这是本地基址差异，不是生产配置缺陷。
- Cloudflare 头/WAF：本地环境无法验证，标记 **待验证**。

## 7. 修改文件

- `data/seo-keywords.json`：关键词配置真源。
- `scripts/seo-keyword-coverage.ts`：只读语料覆盖与映射门禁。
- `scripts/seo-keyword-pages.mjs`：中英文 Googlebot 页面验收。
- `src/lib/seoLanding.ts`、`src/lib/seoLanding.test.ts`：动态 SEO 文案与规则测试。
- `src/lib/assetTarget.ts`、`src/lib/assetTarget.test.ts`：标的单位显示。
- `src/app/asset/[ticker]/page.tsx`：资产页动态元信息、H1、JSON-LD 和单位。
- `src/app/institution/[slug]/page.tsx`：机构/主体机构动态元信息与 H1。
- `src/app/research/page.tsx`：动态总量与 Breadcrumb。
- `src/lib/assetPath.ts`、`src/lib/sitemap.ts`、`src/lib/assetPath.test.ts`：排除重定向伪资产 Sitemap URL。
- `package.json`：`seo:keywords` 与 `seo:keyword-pages` 命令。

## 8. 下一步需要人工决定

1. 是否将 Nomura Chip Shortage Index 的公开原文纳入合规抓取；完成入库、来源核验、结构化与质量门禁前不建立专题页。
2. 是否新增独立 Brent 资产实体、别名和市场数据映射；不能继续让 `brent` 命中 WTI。
3. 是否补充亚太 REITs 的多机构公开来源；达到至少 5 篇、3 家机构的专题门槛后再评估页面。
4. 提供 GSC Queries × Pages × Date 导出，才能排序真实机会和验证上线后的增量；当前不能声称流量增长。

本阶段未部署生产。上线、提交 Sitemap 或在 GSC 请求重新抓取均留待授权后的下一阶段。
