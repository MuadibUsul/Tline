# 03 · SEO 基线与迁移风险

> 线上采样时点 2026-10-16（只读）；仓库证据以 `文件:行号` 标注；文档结论引自 `docs/seo-recovery/`（最新一轮，2026-10-11）与根目录三份历史审计。

## 1. 线上实测基线（2026-10-16）

**URL 总量：3,422 条 canonical URL（10 个命名分片）**——全量清单见 [url-inventory-2026-10-16.csv](./url-inventory-2026-10-16.csv)。

| 分片 | URL 数 | 内容 |
|---|---:|---|
| pages-en / pages-zh | 61 / 61 | 14 个一级页 + 30 个宏观指标页 + 14 个经济体页 + 日历 + 根 |
| institutions-en / -zh | 62 / 62 | 机构档案（含 accuracy 子页，均过各语言闸门） |
| assets-en / -zh | 18 / 18 | 资产页 |
| topics-en / -zh | 58 / 40 | **语言闸门差异（18 个主题无中文达标页，正确行为）** |
| research-en-1 / -zh-1 | 1,889 / 1,153 | 研报详情；未见第 2 片，未到 20k/片上限 |

**robots.txt**：`Allow: /` + 逐条 Disallow `/api/{auth,feed,health,search,social,v1}`；对 Googlebot/Bingbot/GPTBot/OAI-SearchBot/ChatGPT-User/ClaudeBot/PerplexityBot 复制同一策略（明确欢迎 AI 爬虫）；`Host` + `Sitemap` 声明。

**样本页 head（实测）**：
- 研报 `/zh/research/{slug}`：`<title>` 中文题、`robots: index,follow`、自指 canonical、`hreflang en / zh-CN / x-default` 三行齐全。
- 首页 `/zh`：canonical 自指 `https://tlines.tech/zh`，og:type=website。

**闸门驱动的发布面（代码事实）**：`src/lib/publication.ts:46-62` 是唯一公开边界（rawText + withdrawnAt=null + ready 英文文档 + 语言判决列）；`src/lib/sitemap.ts` 全分片读同一函数；2026-10-11 生产基线：1,734 篇全有判决（en 1,682 / zh 995 可索引）。

## 2. 历史审计文档的现状结论（按时间线）

| 文档 | 时点 | 现行有效性 |
|---|---|---|
| `SEO_AUDIT.md`（方案） | 09-17 | 建议大半已落地；作为背景，不作基线 |
| `SEO_LAUNCH_AUDIT.md`（独立审计） | 09-17 晚 | §1 结论被其 §10-11 更正覆盖；M-4（可索引搜索页）、M-9（相关性门槛）仍未决 |
| `SEO_INDEX_DIAGNOSIS.md` | 09-25 | 下架路线一节仍有效；09-27 URL 群体收缩与曝光 -85.5% 的**因果未证实**（01-audit:107-116） |
| `docs/seo-recovery/01-06` | 10-09~10-11 | **现行基线（D0）**：sitemap/内链/alternate 声明自拒绝页三类缺陷已修；监测规范与 D+7/14/28 模板在 06 |

## 3. 迁移风险清单（重构相关，按严重度）

| # | 风险 | 现状证据 | 重构中的要求 |
|---|---|---|---|
| R1 | **闸门迁移 runbook 缺失** | 05:262-264；`DEPLOYMENT.md` 无 `gate:recompute` | 新环境部署必须跑 `npm run gate:recompute`，否则列表/sitemap 空 |
| R2 | 无 GSC 凭据 | 05:266 | TL-002 的 URL×GSC 合并需要导出 CSV（通道已有：06 文档） |
| R3 | 09-27 中文 URL 群体收缩致曝光下降（因果未证） | 01-audit:71,107-116 | 重构不得再发生批量路径变更；一切 URL 决策进 mapping 表 |
| R4 | 首页/目录计数口径不一致 | 见 §4，根因已定位 | TL-006 统一口径；**不得为对齐数字改数据** |
| R5 | 全动态无缓存，性能基线未采集 | 01 §5 | TL-004 建基线；改版大流量页前先做缓存层（TL-404 提前） |
| R6 | 研报叶子页长期孤链问题（988 页深度 50） | SEO_AUDIT:36-68 | 新首页/主题页/相关阅读必须产生枢纽内链（PRD P03/P04 已含） |
| R7 | 主题页 index/noindex 历史摆动 | SEO_LAUNCH_AUDIT:194 | 主题索引改造须沿用"每语言闸门"规则（`src/lib/topics.ts:200-209`） |
| R8 | 正文不在 HTML 的 PDF 来源页 | 01-audit P1-4 | P03 改造须保证 SSR 语义正文（PRD §8.1 第 9 条） |
| R9 | **MCP 未纳入任何 SEO 监测** | `docs/seo-recovery/*` 无 MCP 词条；`site.ts` robots 无 `/api/mcp` | `/api/mcp/*` 已由 next.config noindex + 响应头双保险；MCP 发布文章走闸门（`publicationDrafts.ts` publish 段），监测清单需补 |
| R10 | `/feed.xml` 与 `/rss.xml` 同内容双地址 | `src/app/feed.xml/route.ts:1` | 低危；建议加 self 引用或说明，重构时顺手处理 |

## 4. 计数口径差异（TL-006 的实证）

PRD §1 观察到"首页 20 资产 vs 目录 18 资产"：
- **根因一**：首页 `src/app/page.tsx:52-54` 的 `coveredAssets` 过滤只有 `reports>=2 && institutions>=2`；markets 页多一个 `!isLegacyNonAssetAlias(ticker)`（`src/app/markets/page.tsx:44`）→ 首页把两个历史别名当资产计入。
- **根因二**："51 家发布机构"（首页 `page.tsx:43`，有 ≥1 篇公开研报的机构）与"45 家机构"（`markets/page.tsx:46`，覆盖合格资产的机构去重）本就是不同定义，两者都正确。
- **处理建议**：统一代码口径（首页补别名过滤），文案上把两个数字各自定义写清（"发布机构 51 家 / 其中 45 家贡献资产观点"），模板层在文案里带口径说明。**不改数字口径以外的数据。**

## 5. 迁移红线（与 PRD §8 对齐后落为本仓规则）

1. slug 生成器（`buildResearchSlug`）与既有 slug 一律不动；新增专题走新路由。
2. canonical/hreflang 生成器（`src/lib/seo.tsx`）为唯一出口；新页面必须复用它，不手写 head 逻辑。
3. 任何新增归档页/N 级列表：进 sitemap 前先过闸门；分页可索引、参数组合默认 noindex（沿用 `/research?page=` 的既有判定）。
4. `dateModified` 只在内容实质变化时更新；禁止部署即刷新全站时间戳。
5. 一切 URL 决策（keep/301/410）进 [url-mapping-template.csv](./url-mapping-template.csv)，缺决策不得上线。
