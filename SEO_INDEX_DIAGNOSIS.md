# 网页未被索引：根因诊断

诊断日期 2026-09-21。证据来自生产站点 `tlines.tech` 的实测抓取，以及本地 `prisma/dev.db`
快照（436 篇，其中 404 篇 publication-ready）跑同一套 `contentQuality` 门禁的结果。

> ⚠️ **读本文前先看文末「生产真实基线」。** 本地 `dev.db` 快照**不能代表生产**：它显示
> 英文 78% 可索引、47 篇 `needs_review`；生产实际是英文 **97.7%** 可索引、
> **`needs_review` 为 0**。本文中所有以本地快照为据的数字都已在那里更正。

---

## 结论先说

Google 报告的每一个"未收录"分桶，**都不是抓取问题，而是我们自己主动拒绝收录**。

| GSC 原因 | 数量 | 真正的成因 |
|---|---|---|
| 被 "noindex" 标记排除 | 388 ↑ | 中文页质量门禁批量拒绝；且新文章一进索引就带出一个可发现的中文地址 |
| 已抓取 - 尚未编入索引 | 119 | 页面可索引但 Google 判定价值不足（双语近重复 + 机器结构化内容） |
| 网页会自动重定向 | 161 ↑ | 历史无语言前缀 URL 全部 308；部分旧主题 URL 是**两跳**链 |
| 已被 robots.txt 屏蔽 | 24 | 每个研报页都链向被屏蔽的 `/api/documents/<id>` |
| 备用网页（规范标记适当） | 5 | hreflang 对，正常 |
| 重复网页，Google 选择不同规范页 | 10 | 双语近重复 |
| 未找到 (404) | 7 | — |
| 重复网页，未选定规范页 | 5 | — |

**最严重的一条**：中文版页面在**已经有完整中文译文**的情况下被 noindex，原因是 AI 分析行里
缺一句中文摘要（`summaryZh`）。实测 16 个因缺摘要被拒的中文页中，**8 个正文有 2600–17500 个汉字**。

---

## 索引门禁是怎么工作的

一张页面能否被索引，由 `src/lib/contentQuality.ts` 决定，**按语言分别判定**：

```ts
// src/lib/contentQuality.ts:72,78,104
const summary = locale === "zh-CN" ? article.analysis?.summaryZh?.trim() : article.analysis?.summary.trim();
if (!summary) issues.push("empty_summary");
const eligibility = essentialMissing ? "NOT_GENERATED" : issues.length ? "NOINDEX_FOLLOW" : "INDEX";
```

消费方：
- `src/app/research/[id]/page.tsx:70` — `eligibility !== "INDEX"` 就输出 `robots: { index: false, follow: true }`
- `src/lib/sitemap.ts:78,202` — 只有 `INDEX` 的语言才进 sitemap，才被声明为 hreflang alternate

所以 sitemap 是自洽的（实测 1908 条 URL 全部返回 `index, follow`，无自相矛盾）。
**问题不在 sitemap，在于太多页面过不了门禁。**

---

## 生产实测数据

```
sitemap.xml  →  shard 0: 366 条（站点自有页面）
                shard 1: 1542 条（研报）
                shard 1 明细: en=1062  zh=480
```

推论：**1062 篇文章的英文页可索引，但只有 480 篇的中文页可索引** —— 即有 **582 个中文地址
是"英文已收录、中文 noindex"**。GSC 当前只报 388，说明还有一批尚未被抓取，**这就是趋势线上升的原因**。

抽样 60 篇"英文已索引"文章的中文地址：

```
NOINDEX 35 (58%)   INDEX 25 (42%)
  └─ 缺 summaryZh        16  (46%)
  └─ 翻译质量门禁未过     19  (54%)
```

---

## 根因清单（按影响排序）

### R1 · `summaryZh` 只有 `reparse` 写，`translate` 从不写 —— 中文页因一句话被永久拒绝

写入点只有一处：

```ts
// prisma/reparse.ts:121,141
summaryZh: parsed.summaryZh,
```

而翻译流程 `src/lib/translation/translate.ts` 只写 `ArticleTranslation`，**完全不碰 `Analysis.summaryZh`**。

两条通往 `summaryZh: null` 的路：

```ts
// src/lib/ingest/parseLLM.ts:193  启发式解析（无可用模型时走这条路）
summaryZh: null,

// src/lib/ingest/parseLLM.ts:306  LLM 返回缺 summary_zh 时，整份解析被丢弃
if (typeof summary !== "string" || summary.trim().length < 40 || !summaryZh || summaryZh.length < 12) return null;
```

```ts
// src/lib/ingest/parseLLM.ts:418-437
const heuristic = heuristicParse(input, segments);   // summaryZh: null
const provider = await resolveLLMProvider("analysis");
if (provider) { const real = await realParse(...); if (real) return {...real}; heuristic.reviewStatus = "needs_review"; }
if (ruleViews.length > 0 && heuristic.reviewStatus !== "needs_review") heuristic.reviewStatus = "ok";
return heuristic;   // ← summaryZh 为 null，但 reviewStatus 是 "ok"
```

**这条路径的产物是最坏的情况**：`reviewStatus = "ok"`（英文页可索引）+ `summaryZh = null`
（中文页 noindex）+ 分析行已存在（reparse 的自动候选集是 `analysis: { is: null }`，**永远不会再碰它**）。

git 历史里 `678abcf feat: English-only site, rule-extracted views, and a switch to stop model calls`
就是产生这批数据的时间窗——模型开关关闭期间入库的文章，全部落进这个状态。

**本地精确规模**：24 篇"英文有摘要 + 中文译文存在 + summaryZh 为空"，其中 **13 篇中文页
唯一的不合格原因就是 `empty_summary`**。生产抽样中这一类比占中文 noindex 的 46%，且其中一半
正文有完整译文。

**修复方向**：翻译流程产出译文后回填 `Analysis.summaryZh`（这是"页面已有中文正文却缺中文摘要"
的根）；或在 `contentQuality` 的中文分支里允许用 `translation.text` 作为摘要来源。

---

### R2 · `needs_review` 是终态 —— 没有任何自动流程会重试它

```ts
// prisma/reparse.ts:32-37
if (!all) {
  selection.push(retryReview
    ? { OR: [{ analysis: { is: null } }, { analysis: { reviewStatus: "needs_review" } }] }
    : { analysis: { is: null } });        // ← 自动路径只取这一支
}
```

而调度器从不传 `--retry-review`：

```js
// scripts/scheduler.mjs:113
["run", "reparse", "--", `--limit=${processLimit}`],
```

`scripts/content-retries.ts` 虽然能处理这类文章，但它的队列**需要人工 `--enqueue-backlog` 填充**，
没有任何自动入队。于是这些文章：`analysisFailCount = 0`、`analysisNextAttemptAt = null` ——
**退避机制看不见它们，因为它们从未被尝试过**。

**规模**：本地 47 篇，全部停滞 11 天，`failCount` 全为 0。因为这些文章**同时阻断两种语言**，
实际影响 **94 个 URL**。这是英文侧最大的单一原因（`analysis_needs_review` = 47）。

**修复方向**：把 `--retry-review` 加进调度器任务表。成本是有界的——`dueFilter` 已经按
指数退避 + `MAX_FAILURES=6` 封顶，不存在"每分钟无限重刷"的风险。

---

### R3 · 翻译流程按设计跳过截止日前的积压

```ts
// prisma/translate.ts:32-36
if (!operatorSelected) {
  selection.push(dueFilter("translation"));
  selection.push({ createdAt: { gte: LOCALE_STRICT_ZH_SINCE } });   // ← 只看新文章
}
```

注释写明是有意为之（"No backfill … run `translate --all` to backfill by hand"），
但结果是没有中文译文的文章**永久停在无译文状态**：本地 59–91 篇。

这些文章的中文地址有两种结局，**都不进索引**：
- `createdAt < LOCALE_STRICT_ZH_SINCE` → 渲染英文正文的伪中文页 → `missing_translation` → noindex
- `createdAt >= LOCALE_STRICT_ZH_SINCE` → `redirect()` 到 `/en` → 计入"网页会自动重定向"

**修复方向**：执行一次 `npm run translate -- --all` 回填；之后要么放弃"截止日"逻辑，
要么把未翻译文章的中文地址从内部链接中摘掉。

---

### R4 · 语言切换按钮把每个 noindex 地址送到 Google 面前

```tsx
// src/app/layout.tsx:94-100
const languageSwitch = pathname.startsWith("/admin") ? null : (
  <a className="minibtn"
     href={localePath(locale === "en" ? "zh-CN" : "en", pathname || "/")}
     hrefLang={locale === "en" ? "zh-CN" : "en"} ...>
```

生产实测，`rel` 属性为空：

```
EN page /en/research/uob-research-...-fimfbrd3vs:  language switch -> /zh/research/uob-...  rel=(none)
该页面共 34 个 <a> 链接，rel=nofollow 属性 0 个
```

**这是 Google 发现那 582 个 noindex 中文地址的路径**，也是 noindex 桶持续上升的机制：
每篇新英文文章被收录，就同时暴露一个可发现的中文地址。

**重要判断**：这是**症状，不是根因**。给切换按钮加 `rel="nofollow"` 只会让数字好看，
不会让任何页面变得可收录。真正的修复是 R1/R2/R3。等它们修完，noindex 桶自然收缩。

---

### R5 · 每个研报页都链向一个被 robots.txt 屏蔽的地址

```tsx
// src/app/research/[id]/page.tsx:325
<a key={document.id} href={localePath(locale, `/api/documents/${document.id}`)} ...>
```

`/api/documents` 在 `CRAWLER_DISALLOW` 里（`src/lib/site.ts`），生产 robots.txt 已确认。

实测：研报页至少有 1 个 `/api/documents/...` 链接，页面无任何 nofollow。
sitemap 里有 1542 条研报 URL，即最多约 1542 个"可发现但被屏蔽"的地址，GSC 目前报了 24 个
（Google 会限流这类地址的抓取）。

**修复方向**：把 `/api/documents` 从 disallow 里拿掉，改为在 PDF 响应上发
`X-Robots-Tag: noindex`。这样 Googlebot 能抓取（不再报"被屏蔽"），但不会收录 PDF，
而且 PDF 预览渲染也能正常工作。或者退一步：给下载链接加 `rel="nofollow"`。

---

### R6 · 历史 URL 空间全量 308，部分还是两跳链

```ts
// src/middleware.ts 末段：任何不带语言前缀的路径都 308
url.pathname = `/${preferredSegment(request)}${pathname === "/" ? "" : pathname}`;
return NextResponse.redirect(url, 308);
```

实测的重定向链：

```
308 /topics/us-10y-treasury  ->  308 /en/topics/us-10y-treasury  ->  200 /en/markets/us-10-year-treasury
308 /topics/natural-gas      ->  308 /en/topics/natural-gas      ->  200 /en/markets/natgas
308 /topics/fed-policy       ->  308 /en/topics/fed-policy       ->  200 /en/institution/federal-reserve
308 /asset/SPX               ->  200 /en/markets/sp-500            （单跳，正常）
```

两跳来自`src/app/topics/[topic]/page.tsx:84,119` 的 `permanentRedirect`，与 middleware 的
语言前缀叠加。加上历史上"无前缀时代"（git `dd96575 feat: give each language its own address`）
被索引的整个 URL 空间（`/research/X`、`/markets`、`/consensus`、`/search` …），
就构成了那 161 个且仍在上升的重定向桶。

**修复方向**：让 middleware 在为无前缀路径补语言前缀时，同时解析 legacy facet 重定向，
把两跳压成一跳。308 是永久重定向，Google 最终会停止重新抓取，但在此之前持续消耗抓取预算。

---

### R7 · noindex 页把自己声明为 canonical

```ts
// src/app/research/[id]/page.tsx:69
...canonical(researchPath(article), locale, indexableLocales.length ? indexableLocales : ["en"]),
```

生产实测一个中文 noindex 页：

```
robots:    noindex, follow
canonical: /zh/research/uob-research-uob-group-research-fimfbrd3vs     ← 指向自己
hreflang:  en -> /en/research/...        x-default -> /en/research/...
```

`canonical` 说"收录我"，`noindex` 说"别收录我"——两个信号互相矛盾。Google 会遵从 noindex，
但这对"重复网页"两个分桶是有贡献的。

**修复方向**：noindex 时不要输出自指 canonical，而是指向可索引的那一侧。

---

## 已确认**不是**问题的部分（避免白做工）

- **sitemap 不自相矛盾**：实测 1908 条 URL 全部返回 `index, follow`，没有"sitemap 广告 noindex 地址"。
- **sitemap 分片与 lastmod 正常**，无 50000 条上限问题，无 build 期数据库依赖问题。
- **robots.txt 本身正确**：没有误屏蔽页面路径，只有 `/api/*` 六个端点。
- **hreflang 逻辑正确**：只声明通过门禁的语言，`x-default` 指向英文，没有指向 noindex 地址。
- **内链没有裸路径**：全站内部链接都经 `localePath()` 包装，不存在大量无前缀内链。
- **正文长度不是问题**：`rawText` 中位数 7336 字符，p25 也有 4144，`thin_content` 只命中 1 篇。
- **标题噪声不是问题**：`abnormal_title` 只命中 4 篇（`"Download the PDF \"...\""` 这类），已可忽略。

---

## 已实施的修复（2026-09-21）

### 实测影响（对本地全库 404 篇 publication-ready 文章跑门禁）

```
基线（今日）                            en=315/404 (78%)   zh=240/404 (59%)
仅 R2（needs_review 重试成功后）        en=361              zh=274      (+46 / +34)
R1+R2 + 翻译质量全部达标                en=361 (89%)        zh=339 (84%)  ← 上限
```

`en=361` 是**上限**而非预期：R2 的收益取决于模型重试时能否产出可 grounding 的结果。
若同一批文章持续无法 grounding，它们会在 6 次尝试后被放弃，中文页与英文页维持 noindex。

| # | 修复 | 文件 | 状态 |
|---|---|---|---|
| R1 | 缺失 `summaryZh` 时用译文开头推导摘要（读取时派生，不回填列，`reparse` 无法覆盖） | `src/lib/summary.ts`（新）、`contentQuality.ts`、`research/[id]/page.tsx` | ✅ 本地 +13 中文页 |
| R2 | `needs_review` 记为失败进入退避阶梯 + 调度器加 `--retry-review` | `prisma/reparse.ts`、`scripts/scheduler.mjs` | ✅ 上限 +46 en / +34 zh |
| R3 | 翻译积压改为 `TRANSLATION_BACKLOG_LIMIT` 环境变量控制的排空步骤（默认 0 = 关闭） | `scripts/scheduler.mjs` | ✅ 需运维设值 |
| R5 | `/api/documents` 移出 robots 屏蔽，改为 `X-Robots-Tag: noindex`（含 307 跳转响应） | `src/lib/site.ts`、`api/documents/[id]/route.ts` | ✅ |
| R6 | 退役主题/资产别名在 middleware 内一次解析，两跳压成一跳 | `src/middleware.ts` | ✅ |
| R7 | ~~noindex 页的 canonical 指向可索引的一侧~~ **已回滚**：译文不是原文的重复页，跨语言 canonical 与 hreflang"互为替代"的声明相矛盾。**保留**的部分：没有任何语言可索引时不再声明 hreflang alternate | `research/[id]/page.tsx` | ⚠️ 部分回滚 |
| R4 | 语言切换按钮的 nofollow | — | ⏸ 未做：只是症状，R1–R3 生效后此桶自行收缩 |

验证：`npm test` 562/562 通过（新增 11 个测试）；`npx tsc --noEmit` 全项目 0 错误；`npm run lint` 无告警；`npx next build` 编译成功。

---

## 试点结果（2026-09-21，本地 dev.db，20 篇分层样本）

真正决定成败的不是上面七项，而是这一条：**当前分析提示词从未对任何存量文章运行过。**

```
analysis 记录按 promptVersion 分布：
  atomic-views-v1   228 条 / 带 seoTitle 的 0 条
  atomic-views-v2   101 条 / 带 seoTitle 的 0 条
  atomic-views-v3    14 条 / 带 seoTitle 的 0 条
  v2                 24 条 / 带 seoTitle 的 0 条
  当前版本 analysis-evidence-v1  —— 0 条
```

`seoTitle` 填充率 **0%**。全部 404 篇的搜索标题都在回退到发布方的系列名
（`daily08032026`、`UOB Group Research`、`Weekly Bottom Line`、`OCBC Daily Treasury Outlook (28 Aug 2026)`）。
**这就是"已抓取 - 尚未编入索引"那 119 篇的成因**——Google 抓到一页标题为 `german industrial production jul26` 的页面，没有查询能匹配它。

### 20 篇试点（`npm run reparse -- --all --ids=…`）

| 指标 | 改前 | 改后 |
|---|---|---|
| `seoTitle` 已填充 | 0/20 | **20/20** |
| `summaryZh` 已填充 | 17/20 | **20/20** |
| `reviewStatus == ok` | 15/20 | 17/20 |
| `promptVersion` 为当前版本 | 0/20 | **20/20** |

降级 3 篇、恢复 5 篇，净 +2。改后标题示例：

```
OCBC Daily Treasury Outlook (31 Aug 2026)
  → Fed September Hike Odds Rise Above 50% After Warsh Jackson Hole

Danske Bank Research
  → Euro Area 2026 GDP Seen at 0.8% as ECB Hikes to 2.50%

german industrial production jul26
  → German Industrial Production Falls 1.1% in July, Rebound Stalls

GLOBAL ECONOMICS · DAILY POINTS
  → US Nonfarm Payrolls Seen +30k, Canada Jobs +20k
```

### 降级的 3 篇不是误判，但暴露了另一个缺陷

用完整字段（含 `keyNumbers`）重新校验，3 篇都是**真实**的 grounding 失败。其中一篇的原文是：

```json
[{"label":"Report date","value":"31 August 2026"},
 {"label":"Document size","value":"PDF 1MB"}, …]
```

模型把**文件元数据写进了 `keyNumbers`**——"Report date" 和 "Document size: PDF 1MB" 不是研报里的数字。
这与代码里 `NOISE_TITLE` / `DOC_SIZE_LABEL`（`contentQuality.ts:34-35`）已经在防的"文档标签当标题"是同一类问题，只是发生在 `keyNumbers` 上。
后果是双重的：grounding 失败导致 noindex；即使通过，页面上会渲染出假的"关键数字"。

### 永久修复：`promptVersion` 终于被读取

`promptVersion` 从第一版起就在写、从来没人读——这就是提示词改进永远触达不到存量的原因。
已加入 `--stale-prompt` / `REPARSE_STALE_PROMPT=true` 开关：

```
当前提示词版本: analysis-evidence-v1
  有 rawText 的文章总数:                    436
    分析由旧版提示词写成（--stale-prompt 选中）: 347
    完全没有分析行（默认通道看到的）:          69
```

端到端验证：`npx tsx prisma/reparse.ts --stale-prompt --limit=2` 正确选中旧版文章并产出标题：

```
Calendar – 7 - 11 September 2026 · Monday, September 7, …
  → US Core CPI Seen at 2.4% as ECB Holds Rate at 2.50%
```

**默认关闭，且不被任何其他 flag 隐含。** 它必须是一次决定，不能是部署的副作用——和翻译积压用同一个原则。

### 生产执行步骤

```bash
# 1. 先跑 20 篇并核对结果（这一步是闸门）
npm run reparse -- --stale-prompt --limit=20

# 2. 确认 seoTitle 填充率与 reviewStatus 变化可接受后，分几批排空 347 篇
for i in $(seq 1 4); do npm run reparse -- --stale-prompt --limit=100 --concurrency=4; done

# 3. 排空中文翻译积压（59 篇，需付费）
TRANSLATION_BACKLOG_LIMIT=20 npm run scheduler
```

试点在本地 dev.db 上 20 篇耗时不到 45 秒（并发 4），全量 347 篇预计 15–30 分钟。

---

## 实施中发现并修正的三个问题

### 1. `qualityScore × 0.7` 与 `≥ 0.8` 的闸门互斥（新发现）

`src/lib/translation/translate.ts:403-405`：

```ts
const reviewed = quality.passed && (reviewAttempted ? review?.pass === true : true);
const qualityScore = reviewed
  ? Number(((quality.score + (review?.score ?? quality.score)) / 2).toFixed(2))
  : Number((quality.score * 0.7).toFixed(2));   // ← 未通过复核 = 分数打七折
```

而索引闸门是 `qualityScore < 0.8 → noindex`。`quality.score` 上限为 1，所以：

> **任何未通过独立复核的译文，分数上限是 0.70，数学上不可能达到 0.8。**

实测重译 4 篇最差译文（原分数 0.00），当前提示词产出后确定性检查**零 issues**、满分 1.0，
但存下来仍然是 `0.70` —— 因为复核没过。65 篇低分译文里有 **13 篇正好卡在 0.70**，就是这个签名。

这里把两件不同的事压进了一个数字：`0.7` 的本意是"未经独立复核"的标记，
闸门却把它当作"质量只有 70%"来读。**返工能让译文从 0.00 变成 0.70（内容确实变好了），
但返回不了索引** —— 除非这个冲突被解决。

**这是一个质量政策决定，我没有动它。** 可选：把未复核的分数下限设为 ≥0.8、
或把闸门改成读 `status` 而不是分数、或让复核成为必跑步骤。

### 2. `--all` 用于积压排空会造成重复计费（我的实现缺陷，已修）

我最初把积压排空实现为 `translate --all --limit=N`。这是错的：`--all` 会让
`operatorSelected = true` → `force: true` 强制重写，而查询是 `orderBy publishedAt desc`
——**每个 tick 都会拿到同样的最新 N 篇并强制重译**。那不是排空，是每分钟一次的固定账单。

已改为 `--backlog`：它只选**提示词 / 词表 / 源文哈希确已过期**的行，幂等。
一旦扫完，下一轮什么都选不到，也就不花钱。

### 3. 积压规模是 432 篇，不是 59 篇（修正）

```
自动通道选中（截止日之后 + 待处理）:  0
--backlog 选中（解除截止日）:        432
  ├─ 完全没有译文:                   91
  └─ 译文已过期（旧提示词/旧词表）:   341
```

345 篇已有译文中，**只有 4 篇是当前提示词版本写的**。换句话说，中文站现在几乎整站
都在用一版已退休的提示词产出的译文——包括我在数据里看到的 `OCBC每日国库展望（25月2026日）`
这种日期渲染错误。

`docker-compose.yml` 里 `TRANSLATION_BACKLOG_LIMIT` 默认值是 **0（关闭）**。
排空 432 篇是 432 次翻译 + 复核调用，比原先估计的 59 篇大 7 倍——
**这个数字变了，所以决定应该由你重新做一次**，而不是沿用"59 篇那笔小钱"的判断。

**遗留且需要决策的两项**（代码修不了）：

1. **65 篇译文 `qualityScore < 0.8`** —— 这是模型/提示词质量问题，把上限从 `zh=274` 抬到 `zh=339` 需要译文本身变好。
2. **59 篇完全没有中文译文** —— 需运维执行一次回填：
   ```bash
   TRANSLATION_BACKLOG_LIMIT=20 npm run scheduler     # 或单次
   npm run translate -- --all --limit=20              # 重复执行直到清空
   ```

---

## 复现命令

```bash
npm run seo:status              # 按原因汇总当前扣留情况（项目自带）
npm run seo:status -- --list    # 逐篇列出

# 本次诊断用的临时脚本（tmp/ 已 gitignore）
npx tsx tmp/seo-index-diagnose.ts     # 本地全库跑门禁，按规则归因
npx tsx tmp/seo-pipeline-state.ts     # 退避/译文质量状态，判断是否卡死
npx tsx tmp/r1-size.ts                # R1 精确规模
node tmp/seo-probe-live.mjs           # 生产抽样：noindex / 重定向实测
node tmp/seo-attribute.mjs            # 生产抽样：noindex 中文页按规则归因
node tmp/seo-chain-probe.mjs          # 重定向链与 robots 屏蔽链接
```

---

# 生产真实基线（2026-09-21 部署后实测）

来源：生产容器内跑项目自带的 `npm run seo:status`，以及直接查生产 PostgreSQL。
**这是权威数字，本文前面基于本地 `dev.db` 的推断在此更正。**

```
reports: 1087

en:    1062/1087 可索引 (97.7%)   扣留 25
       原因: abnormal_title=22  garbled_or_broken_words=2  thin_content=1

zh-CN:  515/1087 可索引 (47.4%)   扣留 572
       原因: missing_translation=316        ← 最大一项
             translation_below_threshold=248  ← 0.7 罚分 vs 0.8 闸门
             empty_summary=128
             abnormal_title=22
             translation_language_mismatch=5  translation_needs_review=3
             translation_garbled=2  garbled_or_broken_words=2  thin_content=1

pages: 50 institution · 20 asset · 59 topics 过阈值
```

## 本地快照在哪些地方误导了判断

| 项 | 本地 dev.db | 生产实际 | 结论 |
|---|---|---|---|
| 英文可索引率 | 315/404 (78%) | **1062/1087 (97.7%)** | 本地严重低估。英文侧本来就健康 |
| `reviewStatus = needs_review` | 47 篇 | **0 篇** | **R2 修复在生产上无事可做** |
| 中文可索引率 | 240/404 (59%) | 515/1087 (47.4%) | 同量级 |
| `seoTitle` 覆盖率 | 0/404 | **324/1087 (30%)** | 病灶确认，但已有 30% 被填过 |

`reviewStatus` 全是 `ok`，所以调度器那次 `--retry-review` 跑出 `Reparse complete: 0 updated`。
R2 的修复本身是对的（它让 `needs_review` 不再是终态），但它解决的是**本地快照里的**问题，
不是生产的问题。这一点必须如实记录。

## 生产上的 `seoTitle` 缺口（最大杠杆）

```
analysis-evidence-v1 (当前)  251 条  → 251 条有 seoTitle  (100%)
atomic-views-v3              186 条  →  73 条有 seoTitle  ( 39%)
atomic-views-v2              240 条  →   0 条有 seoTitle
atomic-views-v1              223 条  →   0 条有 seoTitle
v2                           187 条  →   0 条有 seoTitle
                                              ─────────────
合计                        1087 条  → 324 条 (30%)，缺 763 条
```

当前提示词**每次都产出搜索标题（251/251）**，机制是好的；缺的是把它跑过那 763 篇。
`--stale-prompt` / `REPARSE_STALE_PROMPT` 已实现并试点验证（20 篇 0/20 → 20/20），
**尚未在生产上执行**——763 次模型调用，需要你确认。

## 生产翻译积压（比本地估计大）

```
ArticleTranslation (zh-CN) 合计 776 条 / 1087 篇
  finance-translation-v3 (当前)  348
  finance-translation-v1         233   ← 过期
  finance-translation-v2         195   ← 过期
完全没有译文的                   311
                                  ─────
待处理合计                       739
```

`TRANSLATION_BACKLOG_LIMIT` 默认 **0（关闭）**。739 次翻译 + 复核调用。
按当前提示词产出的译文大多能过闸门（现有 348 篇 v3 译文中 280 篇通过），
所以排空的回报是把中文可索引数从 515 抬向 ~750 —— 但 `translation_below_threshold`
那 248 篇即使重译也上不去（见上文 0.7 罚分冲突）。

## 本次部署实测到的变化

```
sitemap 中文 URL:  480 → 515   (+35，R1 的效果)
robots.txt:        /api/documents 屏蔽已解除（0 处匹配）
/topics/us-10y-treasury:  308 -> 308 -> 200  变成  308 -> 200（两跳压成一跳）
容器: 全部 healthy 在新镜像 sha-f2fa0082dc90，tline-db-1 未被重建，迁移纯增量
样本 40 篇英文已索引文章的 /zh 对应页: NOINDEX 27 → 26（其余受翻译门禁阻塞，非 empty_summary）
```

## 回滚

```bash
ssh deploy@104.207.82.85
cd ~/tline && TAG=sha-1746d298be32 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
镜像 `sha-1746d298be32` 仍在服务器本地。
