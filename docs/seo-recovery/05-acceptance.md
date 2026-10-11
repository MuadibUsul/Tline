# Tlines SEO 恢复工程最终验收

日期：2026-10-09（Asia/Shanghai）
验收对象：第一至第四阶段提交 + 本轮验收修复
未执行：生产部署、生产数据写入、批量索引状态修改

---
 
## 0. 部署结果（2026-10-11 更新）

第 8.5 节的确认已由项目所有者给出，本工程已发布并验证：

| 项 | 结果 |
|---|---|
| 发布提交 | `8be3209`（第一至四阶段 + 验收修复）+ `9e1f577` 热修复 |
| 生产镜像 | `sha-9e1f577ba845`；直连部署与 GitHub Actions 工作流收敛到同一 SHA |
| 回滚点 | `sha-c3cdfccb7765`（镜像仍在主机上）；部署前完整备份 `backups/20261010T200632Z`（database.dump 100MB + 2297 文档） |
| 部署前 4 项生产失败 | 全部转绿：空分页 404、`/markets/SPX` 308、`/sitemap/0.xml` 308、`/api/documents` 404 + `X-Robots-Tag` |
| `/api/health` | `degraded` → **`ok`**（此前无法定位的 worker 陈旧自愈） |
| 全量爬取 | 3126 URL：部署窗口内 37 个瞬态 502/超时（容器重启）；稳定后复爬 **0 实质问题**，仅 3 个慢响应（复测全部 200） |
| 关键词页面 | 生产 22/22 通过 |
| 性能 | 冷启动中位 2.9s，回温后 ~0.6–1.5s；与部署前同量级，仍无缓存遥测（R5 不变） |

**部署时发现并热修复的新缺陷（`9e1f577`）**：`/sitemap/0.xml` 的旧地址重定向用 `request.url` 作基址，在反代后面把 Googlebot 指向 `https://localhost:3000/...`。这是全站唯一一处用 `request.url`（而非 `siteUrl()`）构造的重定向；本地测不出来（本地监听地址就是公网地址），基线的 edge-case 检查随后加固为断言 origin 而不仅是路径。

---

## 1. 结论

待部署代码通过全部本地验证：lint、类型检查、**594/594** 单元与集成测试、生产构建、内容审计、关键词覆盖、监测脚本自测，以及**逐条 HTTP 验收**——sitemap 中 **845/845** 个 URL 全部返回 200、可索引、自引用 canonical；URL 契约 **54/54** 通过。

当前生产仍运行旧版本，因此第二阶段记录的 **4 项**确定性修复在线上仍失败。这不是待部署构建的回归，而是**尚未发布**的证据。发布前不能把项目状态写成"线上验收通过"。

**索引、曝光与排名恢复无法由代码测试证明。** 本报告不声称上线即恢复流量。仓库无 GSC 凭据、无 Cloudflare 凭据；相关内容一律为 unknown / 待验证。

### 本轮验收新增发现并已修复的缺陷（P1）

**sitemap 与站内链接在对外声明站点自己拒绝索引的页面。** 这是第二、四阶段文档声称已解决的同一类矛盾，但保证只实现在研报分片，未覆盖按类型拆分的分片：

| 表现 | 数量 | 实测 |
|---|---:|---|
| `/zh/topics/*` 出现在中文 sitemap 但页面 `noindex` | 14 | 复现 |
| `/zh/institution/*` 出现在中文 sitemap 但页面 `noindex` | 5 | 复现 |
| `/zh/topics` 中心页链接到 noindex 主题页 | 15 | 复现 |
| hreflang alternate 指向未发布的地址 | 19 | 由基线脚本捕获 |

根因：**收录集合按全库计数构建一次，再原样输出给两种语言**，而页面本身按语言闸门判定。同一份语料被问了三个不同的问题（页面、中心页链接、sitemap）。

修复后实测：**845/845 → 0 问题**；中心页坏链 15 → 0；alternate 悬空 19 → 0。详见第 7 节。

---

## 2. 已完成的修改

### 2.1 第一至第四阶段（已在仓库提交）

| 阶段 | 提交 | 内容 |
|---|---|---|
| 1 | `c31a49a` 等 | 基线审计；研报 URL 契约；旧地址重定向；canonical/hreflang；命名 Sitemap 分片；API `X-Robots-Tag`；空分页边界 |
| 3 | `2ad4fe7` | 来源支撑的结构化提取；数字/年份/期限/单位/免责声明/复制首段门禁；单机构不冒充共识 |
| 4 | `a52bc8e` | 42 关键词配置；10 个重点页动态 SEO；真实覆盖数；资产目标单位；上下文内链 |

### 2.2 本轮验收修复（已提交，`1e69ddd` + `bbe6e9b`，见第 9.2 节）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/topics.ts` | 索引内新增**按语言**覆盖（views / articleIds / institutionIds / lastAt）；新增 `listIndexableTopicsFor(locale)` 与唯一判定 `topicIndexableIn` |
| 2 | `src/lib/sitemap.ts` | 主题与机构分片按语言收录；`localizedEntries` 只声明**确实发布**的 alternate |
| 3 | `src/app/topics/page.tsx` | 中心页列表与 featured 快捷入口同用该规则 |
| 4 | `src/app/page.tsx` | 首页主题列表按语言 |
| 5 | `src/lib/related.ts` | 站内主题内链按语言 |
| 6 | `src/lib/sitemap.test.ts` | 断言按语言收录的结构性保证 |
| 7 | `scripts/seo-monitoring.mjs` | 读不到的 GSC 数值保持缺失并渲染为 `—`（原先空值渲染为 `0`，等于伪造测量值） |

---

## 3. 测试结果

### 3.1 待部署构建：全部通过

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **PASS** |
| 代码规范 | `npm run lint` | **PASS** |
| 单元/集成 | `npm test` | **PASS 594/594** |
| 生产构建 | `npm run build` | **PASS** |
| 关键词覆盖 | `npm run seo:keywords` | **PASS**（42 条配置 / 11 个规范目标 / 8 个内容缺口保持未映射） |
| 门禁状态 | `npm run seo:status` | **PASS**（en 317/317；zh 239/317） |
| 内容审计 | `npm run content:audit -- --sample=40` | **PASS**（只读） |
| 监测自测 | `npm run seo:monitor -- --self-test` | **PASS** |
| 关键词页面 | `npm run seo:keyword-pages -- --base=http://127.0.0.1:3105` | **PASS 22/22**；重复 Title 0、重复 Canonical 0、意外 noindex 0 |
| 全站基线 | `npm run seo:baseline -- --base=http://127.0.0.1:3105 --sample=24` | **PASS，0 failure**；10 分片、845 URL |
| **Sitemap 全量** | `npm run seo:baseline -- --base=http://127.0.0.1:3105 --sample=12 --full-sitemap` | **PASS 845/845 → 200**；noindex 0、canonical 不符 0、跳转 0 |
| URL 契约 | 跳转 / 规范化 / canonical / hreflang / robots / 非 HTML 头 | **PASS 54/54** |
| 中心页内链 | 逐个请求中心页链接的主题 | **PASS**（en 30 / zh 16，坏链 0） |
| 分页发现性 | 遍历到越界页 | **PASS**（en 至 16 页、zh 至 12 页全部可索引；越界 noindex） |

### 3.2 当前生产站：4 项失败（对应未部署修复）

| URL | 期望 | 实际 | 结果 |
|---|---|---|---|
| `/en/institutions?page=9999` | 404 或 noindex | 200，index/follow，自引用 canonical | **FAIL** |
| `/en/markets/SPX`（及 `spx`） | 308 到规范 slug | 200，canonical 已指向 `/en/markets/sp-500` | **FAIL** |
| `/sitemap/0.xml` | 308 到命名分片 | 200，仍为旧数字分片 | **FAIL** |
| `/api/documents/not-a-document` | 404 且带 `X-Robots-Tag` | 404，无该响应头 | **FAIL** |
| `/sitemap/pages-en.xml` | 命名分片存在 | 404（尚未发布） | 预期 |

生产 sitemap 自身健康：2 分片、3079 URL（1883 英文 / 1196 中文）；重复、越域、缺失 alternate、robots 阻断、未来 lastmod **均为 0**。

### 3.3 生产与本地数量差异的说明

生产研报 URL 1683 英文 / 996 中文，本地 317 / 239。**两者不可直接相减**：不同数据库快照、不同版本。本地 `dev.db` 为 436 篇的子集。部署前必须在生产数据上做 dry-run 比对分片数量（见第 8.3 节步骤 3），禁止把本地数字当作生产期望。

---

## 4. URL、Canonical、hreflang、robots 与接口边界

### 4.1 待部署构建实测

| 场景 | 结果 |
|---|---|
| `/`、`/research`、`/cn/research`、`/asset/SPX` | 单跳 308 到规范地址 |
| `/en/sitemap.xml` | 308 → `/sitemap.xml` |
| `/sitemap/0.xml` | 308 → `/sitemap/pages-en.xml` |
| `/en/markets/SPX`、`/en/markets/spx` | 308 → `/en/markets/sp-500` |
| 规范 slug 自身 | 不重定向（无循环） |
| 中英文页面 canonical | 自引用，与路径一致 |
| hreflang | `en`、`zh-CN`、`x-default`；**只声明确实发布的语言** |
| robots.txt | 公开页允许；仅屏蔽 6 个机器接口前缀；`/api/documents` **未**被屏蔽 |
| `/api/documents/*` | 404 + `X-Robots-Tag: noindex, nofollow` |

### 4.2 研报语言 alternate 与发现性

只在对应语言通过门禁时声明。本地实测：317 篇英文、239 篇中文进入各自分片，与 `seo:status` **完全一致**——即 sitemap 覆盖 100% 可索引研报，新内容不依赖深层分页被发现。

另实测：库中最新一篇可索引研报同时满足三个发现路径——出现在对应语言 feed 第 1 页、直接 URL 返回 200、且在对应分片 `<loc>` 中。

### 4.3 分页边界

| 语言 | 最后可索引页 | 越界页 | 可索引 |
|---|---:|---|---|
| en | 16 | 17、9999 → `noindex, follow` | 16/16 |
| zh | 12 | 13 → `noindex, follow` | 12/12 |

---

## 5. 性能、体积与缓存

每地址连续 5 次请求，p95 取 5 个样本最大值。生产含公网、TLS 与远端主机延迟，本地不含，**比例不可当作上线后的提速承诺**。

| 页面 | 生产 median/p95 | 本地 median/p95 | 生产体积 | 本地体积 | 体积差 |
|---|---:|---:|---:|---:|---:|
| 英文首页 | 628 / 1331 ms | 77 / 118 ms | 54,092 B | 47,851 B | −6,241 |
| 中文首页 | 590 / 820 ms | 65 / 76 ms | 53,820 B | 49,260 B | −4,560 |
| Westpac 机构页 | 787 / 814 ms | 81 / 84 ms | 61,313 B | 52,378 B | −8,935 |
| 中文黄金资产页 | 795 / 1022 ms | 122 / 143 ms | 103,490 B | 62,824 B | −40,666 |
| Fiscal Policy 专题页 | 783 / 912 ms | 74 / 77 ms | 80,486 B | 68,542 B | −11,944 |
| Sitemap 索引 | 667 / 1213 ms | 9 / 22 ms | 366 B | 960 B | +594 |

**数据库查询（确定性部分）**：Sitemap 索引由旧实现的「5 个页面类查询 + 1 次全库 lastmod 扫描」降为 **2 次**按语言 count；研报分片每次只取对应语言与分片的一行集合。普通页面未配置 Prisma 查询计数器，其前后查询量为 **unknown**，不以源码调用数冒充运行时 SQL 数。

**缓存**：生产与本地均返回预期 `Cache-Control`（`public, s-maxage=60, stale-while-revalidate=300`）。对生产首页与 Sitemap 各连续请求两次，**没有任何 `Age`、`X-Cache` 或 `CF-Cache-Status`**，可观测命中 0/4。仓库 Caddy 配置只有压缩与反向代理，没有共享缓存指令，因此 `s-maxage` 很可能尚未被消费——真实命中率 **unknown**。

两个补充观察（本轮新发现）：

- 中间件意图设置的 `Vary: Cookie, Accept-Language` **被 Next.js 覆盖**为 `Vary: rsc, next-router-state-tree, …`。因每种语言已有独立地址，内容不依赖 cookie，故无正确性问题；但共享缓存若启用，需重新审视。
- `HEAD` 请求得到 `private, no-store`（源码按 `request.method === "GET"` 判定）。对爬虫无影响（Googlebot 用 GET），但与 GET 不一致。

---

## 6. 内容质量门禁：不会误伤高质量页面

在**生产库只读**核对（未写入、未删除、未改索引状态）：

| 检查 | 结果 |
|---|---|
| 文章总数 / 有 verdict 的文章 | 1734 / **1734**（从未检查的 0 篇） |
| 英文可索引 / 中文可索引 | 1682 / 995 |
| 英文扣留 | 52 |
| **无理由扣留**（`indexable=false` 且无 issue code） | **0** |
| **带 issue code 却仍索引** | **0** |
| verdict 陈旧（`gateCheckedAt` 落后正文 > 1 分钟） | **0**（最大间隔 4.4 秒） |
| 扣留原因集合 | 仅 5 个已知内容质量代码：`abnormal_title`、`analysis_needs_review`、`empty_summary`、`garbled_or_broken_words`、`thin_content` |

**结构保证**：`src/lib/gate.ts` 的写路径只更新 verdict 列（`indexableEn`、`indexableZh`、`gateIssuesEn`、`gateIssuesZh`、`gateCheckedAt`），**从不删除文章、不清空正文、不写任何外部 noindex**。公开查询与 sitemap 读同一列，因此"扣留"与"对外声明"不可能不一致。

> **一处初判被推翻**：`gateCheckedAt < updatedAt` 的文章有 1249 篇，一度看起来像"陈旧 verdict 让已修好的页面继续被扣留"。逐条取样后确认间隔全在毫秒级——`refreshGate` 写 verdict 与 Prisma `@updatedAt` 是同一次更新内的两次赋值。这是**正常写入痕迹，不是陈旧**。测量分布后确认最大间隔 4.4 秒、超过 1 分钟的为 0。

本地对 436 篇语料重跑同一函数：英文 317/317 通过、中文 239 通过；2,099/2,099 条原子观点证据可在正文回查；40 个已存目标全部带期限，缺期限 0 个。未发现高质量英文页面被新门禁错误隐藏。

---

## 7. 本轮修复的缺陷（详述）

### 7.1 症状与根因

主题页判定可索引用的是**按语言过滤后**的文章数：

```ts
// src/app/topics/[topic]/page.tsx
const indexable = data.articles.length >= TOPIC_MIN_ARTICLES && data.views.length > 0;
// data.articles 来自 publicationReadyWhere({…}, locale)
```

而 sitemap 与中心页用的是**全库**计数：

```ts
// src/lib/topics.ts（修复前）
entry.articles >= TOPIC_MIN_ARTICLES && entry.institutions >= TOPIC_MIN_INSTITUTIONS
```

机构页同理：页面按 `indexableZh` 统计后决定 `noindex`，sitemap 只问"有没有 publication-ready 文章"，不分语言。结果是一篇有充足英文覆盖、中文覆盖不足 5 篇的主题，**同时出现在中文 sitemap 和中文中心页的链接里，而它自己的中文页面返回 `noindex`**。

还有第三个来源：中心页的 featured 快捷入口读的是 taxonomy，与覆盖索引无关，因此无论该主题在本语言有没有页面都会渲染链接。

### 7.2 修复

把判定收敛成**一个按语言的函数**：

```ts
// src/lib/topics.ts
function topicIndexableIn(entry: IndexedTopic, locale: Locale) {
  const slice = entry.byLocale[locale];
  return entry.articles >= TOPIC_MIN_ARTICLES
    && entry.institutions >= TOPIC_MIN_INSTITUTIONS   // 全库这一半不能省
    && slice.articleIds.size >= TOPIC_MIN_ARTICLES
    && slice.views > 0;
}
```

`TOPIC_MIN_INSTITUTIONS` 那一半**不是冗余**：`getTopicStat` 会拒绝不再满足跨机构门槛的 key，页面随即 404。修复过程中我一度去掉它，基线脚本立刻报出 `/en/topics/precious-metals` 被 sitemap 广告但返回 **404**——两个方向的错误都会被抓到，这正是保留全量扫描验收的价值。

`localizedEntries` 现在只声明**确实发布**的 alternate：

```ts
alternates: PAGE_ALTERNATES
  .filter((alternate) => languages.includes(alternate.locale))
```

### 7.3 修复前后

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| sitemap 全量校验问题数 | 19 | **0** |
| `topics-zh` 分片 URL 数 | 30 | 16 |
| `institutions-zh` 分片 URL 数 | 48 | 43 |
| 中文中心页坏链 | 15 | **0** |
| 英文中心页坏链 | 3 | **0** |
| hreflang 悬空 alternate | 19 | **0** |

---

## 8. 上线顺序与回滚

### 8.1 关键前置事实

- **待部署提交不含任何数据库迁移。** 生产已应用全部 5 个最新迁移（最新 `20260927200000_article_gate_verdict`，2026-10-03 应用）。本次是纯应用代码变更。
- **门禁 verdict 已回填**：1734 篇全部有 verdict，无一篇落在默认的 `false`。

### 8.2 未解决风险

**R1（P0，环境级）** — 门禁迁移把 `indexableEn`/`indexableZh` 默认设为 `false`，回填依赖手动执行 `npm run gate:recompute`，而**部署路径里没有任何地方会跑它**。生产已回填，本次部署也不含该迁移，因此**当前不受影响**；但任何**新环境（预发、从备份恢复、灾难重建）**都会在回填前对外呈现"零可索引"——研报页全部 404/跳转，看起来像 SEO 灾难。必须写入 runbook。

缓解顺序：`迁移 → npm run gate:recompute → 验证 seo:status 非零 → 再切流量`；`gateCheckedAt is null` 的数量应恒为 0。

**R2（P1）** — 无 GSC 凭据：`Crawled - currently not indexed` 当前数量、索引样本状态、流量恢复全部 **unknown**。本轮提供的 CSV 导入流程是唯一可用路径。

**R3（P1）** — PDF 预览型研报：抽样 5 页服务端 HTML 不含完整英文来源正文（有结构化编辑内容）。信息增益需人工复核，属内容价值而非抓取故障。

**R4（P1）** — 生产 `/api/health` 报 `degraded`，匿名响应不含细节，`HEALTH_DETAIL_TOKEN` 未提供，无法判定是哪个 worker 陈旧。发布窗口前需复查。

**R5（P2）** — Caddy 无共享缓存，`s-maxage` 无消费方且无可观测命中；生产 p95 在公网下仍可能超过目标。

**R6（P2）** — Nomura CSI、Brent、亚太 REITs 仍是内容缺口（第四阶段已记录），未建立薄内容页。

### 8.3 上线顺序

1. 用户明确批准发布，并确认发布提交 SHA（含第 2.2 节修复）。
2. 备份生产数据库与文档存储；记录当前镜像 tag、环境变量、`/sitemap.xml` 快照。
3. **在生产数据的只读副本上 dry-run**：比对每种语言/类型分片数量与 `seo:status`，确认中英文差额可解释。
4. 构建固定 SHA 镜像，**先只部署应用**：不跑批量 gate recompute、不改库、不提交 GSC。
5. 立即检查 `/api/health`、首页、研报搜索与筛选、机构聚合、资产观点、文档下载。
6. 跑 `npm run seo:baseline -- --base=https://tlines.tech --sample=24` 与 `npm run seo:keyword-pages -- --base=https://tlines.tech`，要求 **0 failure**（第 3.2 节的 4 项应转为通过）。
7. 对每个命名分片执行 ≥20 次请求记录生产 p50/p95；确认无 5xx/429、Googlebot 无挑战。
8. 以上通过后，在 GSC 重新提交**现有** `https://tlines.tech/sitemap.xml`，**不要**逐个提交子分片。
9. 按 `06-monitoring.md` 建立 D+7 / D+14 / D+28 快照。

### 8.4 回滚方案

- **应用回滚**：恢复发布前镜像 tag。本项目**没有**要求数据库迁移或批量数据变更，回滚不涉及数据。
- **Sitemap 必须整体回滚**：索引路由、命名分片路由与 `src/lib/sitemap.ts` 是一个单元。只回滚一半会让索引指向不存在的分片。
- 若发布后出现大量 404 / noindex / 错误 canonical：先回滚应用，保留故障请求与 sitemap 快照供比对。
- **不回滚、不改写 Article 数据**；不批量恢复或删除索引标记。单篇 gate 有误时先人工复核证据，再单篇修复。
- GSC 提交无需"回滚"：恢复旧应用后重新请求同一个 `/sitemap.xml` 即可。

### 8.5 需要用户确认的生产操作

- [ ] 批准发布提交 SHA 与维护窗口。
- [ ] 确认已完成数据库、文档存储与当前镜像备份。
- [ ] 授权在生产只读副本上执行 dry-run 并回传各分片 URL 数量。
- [ ] 部署后授权执行只读 HTTP / GSC 验证。
- [ ] 在 GSC 提交 `/sitemap.xml`，并导出 Pages × Queries × Date。
- [ ] 提供 `HEALTH_DETAIL_TOKEN`（或由管理员代查）以定位 `degraded` 的 worker。
- [ ] 若使用 Cloudflare，提供只读权限或按 `06-monitoring.md` 回传 WAF / Bots / Cache 证据。

未经上述确认，本阶段停止在提交与验收文档，不发布生产。

---

## 9. 修改文件与提交

### 9.1 已提交（第一至第四阶段）

`c31a49a`（URL / Sitemap）、`2ad4fe7`（内容质量）、`a52bc8e`（关键词）及各自引用的前序提交。此前的 `a21bd1f` 是本轮审计认定的最强时间相关变更。

### 9.2 本轮验收改动（已提交）

| 提交 | 内容 |
|---|---|
| `1e69ddd` | fix: 按语言收录——主题/机构分片、中心页与内链、alternate 声明统一到单一判定（6 文件，+157/−26） |
| `bbe6e9b` | feat: GSC CSV 监测导入 + `seo:baseline --full-sitemap` 全量爬取模式 + `--canonical-origin`（3 文件，+202/−8） |
| 本文档对应提交 | 验收报告与监测规范 |

`--full-sitemap` 的由来：抽样基线在两个缺陷上线当天是 24/24 通过的，抓到它们的是逐条爬取。该检查现在内置于 `npm run seo:baseline -- --full-sitemap`（845 URL、8 并发、每个 URL 要求 200 无跳转、无 noindex、自引用 canonical），提交信息中 `/en/topics/precious-metals` 的 404 就是它抓到的第二个方向错误。

### 9.3 只读验收产物（未纳入版本库）

`tmp/` 下的探针脚本（perf / pagination / url-contracts / 规则核对）为一次性验收工具，`tmp/` 已被 gitignore。其中逐条爬取 sitemap 的检查**已并入** `seo-baseline --full-sitemap`（见 9.2），不再依赖 tmp 脚本；perf / pagination 的测量方法已记录在第 4.3 与第 5 节，可按需重建。

---

## 10. 边界声明

- 不使用 Google Indexing API 提交普通研报 / 资产 / 机构页面。
- 不把 IndexNow 当作 Google 收录接口。
- 本报告不声称上线即恢复流量、排名或曝光。
- 所有 GSC 数值在缺少授权时保持 unknown，未用估算值填充。
