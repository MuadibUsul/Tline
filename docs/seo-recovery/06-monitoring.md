# Tlines SEO 上线后监测规范

日期：2026-10-09

## 1. 原则与边界

- 英文和中文必须分别统计；总量只能作为补充，不能掩盖单一语言下降。
- GSC 数据通常延迟数天，D+7/D+14/D+28 使用完整可用日期，不把未结算日当作下降。
- 排名、收录和流量变化只能描述相关性，不能仅凭部署时间认定因果。
- 当前没有 GSC API 环境变量或授权；所有 GSC 当前值为 unknown。不得补写搜索量、关键词难度、索引数量或增长预测。
- **读不到的数值保持缺失。** 导入 CSV 中的空格在报告里渲染为 `—`，不是 `0`。`0` 是一个测量结果，`—` 是"没读到"，两者混用等于伪造数据。`seo-monitoring.mjs` 已按此实现（本轮修正：原先空值会渲染成 `0`）。
- 不使用 Google Indexing API 提交普通研报/资产/机构页面；IndexNow 不是 Google 收录接口。

## 1.1 参考基线（D0）

监测需要一个起点。以下是 2026-10-09 验收时实测的数值，D+7 / D+14 / D+28 报告以此作 before 窗口：

| 指标 | 数值 | 来源 |
|---|---|---|
| 生产 sitemap URL | 3079（1883 英文 / 1196 中文） | `npm run seo:baseline -- --base=https://tlines.tech` |
| 生产研报分片 | 1683 英文 / 996 中文 | 同上 |
| 生产门禁 verdict | 1734 篇全部已判定；英文可索引 1682、中文 995 | 生产库只读查询 |
| 生产英文扣留 | 52（`abnormal_title` 27、`analysis_needs_review` 20、其余 5） | 同上 |
| 待部署构建 sitemap | 845 URL（10 命名分片），全量校验 0 问题 | 本地生产构建 |
| 待部署构建研报分片 | 317 英文 / 239 中文 | 同上 |

**生产与本地数字不可相减**：不同数据库快照、不同版本。上线后应以生产 dry-run 的分片数量为新基线，并在 D+7 报告中记录该数字。

> 注意：2026-09-27 的 `a21bd1f` 把失败语言的研究地址从常驻 `noindex` 改为 308/404，这本身会**减少**可发现的 URL 数量，尤其是中文。D+7 报告若看到索引总量下降，应先核对该变更与中文门禁边界（中文 239/317），而不是直接判为回归。

## 2. 每日指标

### 搜索表现（分别为 `en`、`zh-CN`）

| 指标 | 来源 | 计算 |
|---|---|---|
| 点击 | GSC Search results | 每日 Clicks 求和 |
| 曝光 | GSC Search results | 每日 Impressions 求和 |
| CTR | GSC | `clicks / impressions`，不要对行级 CTR 做平均 |
| 平均排名 | GSC | 按曝光加权，仅作为趋势；保留 GSC 原始聚合值 |
| 主题表现 | GSC + `data/seo-keywords.json` | 按 `topic` 汇总 |
| 机构表现 | GSC + 关键词/目标 URL | 按 `entity` 或 `/institution/{slug}` 汇总 |
| 新增查询 | GSC | 未命中关键词配置的 query，进入人工分类队列 |

中文以 `/zh/` 页面为第一判定，英文以 `/en/` 为第一判定；只有缺少页面维度时才按查询文字回退。繁体和简体均归入 `zh-CN` 监测组，但保留原始 query。

### 索引覆盖

每日或 GSC 数据更新后记录：

- Indexed URL 数量，按英文/中文拆分。
- Not indexed 数量及原因。
- `Crawled - currently not indexed` 数量与 7 日变化。
- `Discovered - currently not indexed`、Duplicate、Alternate page、Soft 404、Blocked by robots、Server error。
- 固定 28 个历史样本和每个重点主题新增 2 个样本的 URL Inspection 状态、最后抓取、抓取到的 Canonical、用户声明 Canonical。

不要把“有效 Sitemap URL 数”当作“已收录 URL 数”。

### 抓取与可用性

从 Caddy/应用日志按 Googlebot Verified IP 验证后统计：

- Googlebot 请求量，按路径族和语言。
- 4xx、5xx、429 数量及 URL 样本。
- 重定向链超过 1 跳的请求。
- Sitemap、robots、首页、研报页的 median/p95 TTFB。
- Sitemap HTTP 状态、GSC 最后读取时间、发现 URL 数和错误数。
- `Age`、`X-Cache` 或 `CF-Cache-Status` 的 HIT/MISS；没有这些头时写 unknown，不以响应变快推断命中。

建议告警：Googlebot 出现任何 429 或 Sitemap 5xx 立即处理；Googlebot 5xx 连续 5 分钟、Canonical/robots 抽样失败、Sitemap URL 数异常下降均视为发布阻断。曝光下降只触发调查，不自动改门禁或批量 noindex。

## 3. 可重复数据导入

仓库没有 GSC 凭据，因此使用 CSV：

```powershell
npm run seo:monitor -- --performance=exports/performance.csv --coverage=exports/coverage.csv --inspection=exports/inspection.csv
```

脚本输出 Markdown，不调用外部服务。可用 `npm run seo:monitor -- --self-test` 验证解析器。

### `performance.csv`

必需长表字段：

```csv
date,query,page,clicks,impressions,ctr,position
2026-10-10,westpac iq,https://tlines.tech/en/institution/westpac,3,120,2.5%,6.4
```

脚本用 clicks/impressions 重新计算 CTR，并按曝光加权 position。只有 GSC API、Search Analytics 导出或 BigQuery Bulk Export 能提供的组合维度才应放在同一行；不要把 GSC UI 的 Queries.csv 和 Pages.csv 按行号拼接。

### `coverage.csv`

从 Page indexing 报告按日期手工记录：

```csv
snapshot_date,language,status,count
2026-10-10,en,Indexed,0
2026-10-10,en,Crawled - currently not indexed,0
```

**取不到就留空。** 留空在报告里输出 `—`；写成 `0` 会被当作真实测量值。不得沿用示例里的占位 0。

语言由行内 `language` 或 URL 的 `/en`、`/zh` 前缀判定；两者都没有时按 query 是否含汉字回退。

### `inspection.csv`

固定样本和异常 URL：

```csv
snapshot_date,url,language,index_status,last_crawl,http_status,robots,canonical
2026-10-10,https://tlines.tech/en/markets/gold,en,unknown,,200,index,https://tlines.tech/en/markets/gold
```

`unknown` 是合法状态。脚本不会把 HTTP 200 推断为已被 Google 收录。

## 4. GSC 人工操作

1. Search results：日期选择部署前 28 天至最新完整日，分别添加 Page filter `https://tlines.tech/en/`、`/zh/`；导出 Dates、Queries、Pages。
2. 若需 Query × Page × Date 长表，使用已授权 Search Analytics API 或 BigQuery Bulk Export；当前仓库没有凭据。
3. Page indexing：记录 Indexed、Not indexed 及每个原因；单独记录 `Crawled - currently not indexed`。
4. Sitemaps：保留现有 `https://tlines.tech/sitemap.xml`，部署验收通过后重新提交；记录 Last read、Status、Discovered pages。
5. URL Inspection：检查固定 28 个历史样本、10 个重点页面及本周期新增页面；记录 Google-selected canonical 和 last crawl。
6. 导出文件使用 `YYYY-MM-DD-gsc-{performance|coverage|inspection}.csv`，原始文件只追加，不覆盖。

## 5. Cloudflare、Caddy 与缓存人工操作

当前 DNS/HTTP 只观察到 `Via: 1.1 Caddy`，无 Cloudflare 响应头；仓库示例 Caddyfile只有 gzip/zstd 和反向代理。

若域名确实接入 Cloudflare，管理员应：

1. DNS 中确认记录是否 Proxied；记录切换时间。
2. Security Events 过滤 Googlebot、`/robots.txt`、`/sitemap*`，检查 Managed Challenge、Block 和 Rate Limit。
3. Bots 中确认 Verified Bots 允许；不要按 User-Agent 字符串单独放行伪造爬虫，应使用 Cloudflare verified bot 信号。
4. Cache Rules 确认 HTML/Sitemap 是否可缓存、Cookie 是否绕过、是否尊重 origin `s-maxage`。
5. Cache Analytics 导出 HIT/MISS/BYPASS/DYNAMIC；没有 `CF-Cache-Status` 就不能声称命中。
6. 确认规则不会缓存登录、管理、watchlist、API 或带认证 Cookie 的响应。

若不使用 Cloudflare，需决定是否为 Caddy增加受支持的共享缓存。没有真实 p95/源站负载收益前不新增缓存插件；先补 Age/X-Cache 可观测性。

## 6. 日报结构

```markdown
# SEO 日报 YYYY-MM-DD

数据最新完整日：YYYY-MM-DD
部署后第 N 天：N

| Language | Clicks | Impressions | CTR | Avg position | Indexed | Crawled-not-indexed |
|---|---:|---:|---:|---:|---:|---:|
| en | unknown | unknown | unknown | unknown | unknown | unknown |
| zh-CN | unknown | unknown | unknown | unknown | unknown | unknown |

Googlebot: 4xx unknown / 5xx unknown / 429 unknown
Sitemap: status unknown / last read unknown / discovered unknown
变更与异常：无数据则明确写 unknown。
```

## 7. D+7、D+14、D+28 对比模板

每个节点使用相同模板；窗口必须写明实际完整日期。

```markdown
# Tlines SEO 上线后 D+{7|14|28} 报告

部署 SHA：
部署时间（Asia/Shanghai）：
比较窗口：部署前 ____ 至 ____ / 部署后 ____ 至 ____
GSC 数据最新日：

## 1. 结论
- 技术健康：PASS / FAIL / unknown
- 索引变化：仅陈述数据，不推断因果
- 流量变化：仅陈述数据，不声称恢复完成

## 2. 中英文搜索表现
| Language | Period | Clicks | Impressions | CTR | Avg position | Change vs baseline |
|---|---|---:|---:|---:|---:|---:|
| en | before | | | | | — |
| en | after | | | | | |
| zh-CN | before | | | | | — |
| zh-CN | after | | | | | |

## 3. 索引覆盖
| Language | Indexed | Not indexed | Crawled-not-indexed | Inspected samples indexed/total |
|---|---:|---:|---:|---:|
| en | | | | |
| zh-CN | | | | |

## 4. 主题与机构
| Topic/entity | Language | Clicks | Impressions | CTR | Position | Notes |
|---|---|---:|---:|---:|---:|---|

## 5. 抓取与 Sitemap
| Metric | Value | Baseline | Result |
|---|---:|---:|---|
| Googlebot 4xx | | | |
| Googlebot 5xx | | | |
| Googlebot 429 | | | |
| Sitemap status / last read | | | |
| HTML p95 TTFB | | | |
| Sitemap p95 TTFB | | | |
| Cache hit rate | | | unknown if no telemetry header |

## 6. 样本与异常
- 新索引 URL：
- Crawled-not-indexed 样本：
- Canonical mismatch：
- 需人工复核内容：

## 7. 下一步
- 只列证据支持的动作；不因短期排名波动批量删除/noindex。
```

### 节点重点

- D+7：确认部署无技术回归、Sitemap 已读取、Googlebot 无 429/5xx；GSC 排名只做早期观察。
- D+14：比较中英文 Crawled-not-indexed、新查询和重点页面抓取；决定是否需要单页内容复核。
- D+28：用完整 28 天窗口比较主题/机构贡献，再决定内容补充、内链调整或缓存工程；仍不得把同期变化自动归因于代码。
