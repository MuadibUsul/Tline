# Tlines 独立 SEO 审计报告

审计人角色：Independent Technical SEO Auditor
审计日期：2026-09-17
审计对象：https://tlines.tech/（生产） + `E:\Codes\Tline`（代码仓库 / 工作树）
审计方式：以 Googlebot UA 抓取**最终 HTML**（非 React 源码推断），共抓取 300+ URL；另做全站链接可达性遍历与 faceted/pagination 行为测试。

---

## 0. 审计开始前必须先确认的一件事（Critical-1）

**当前生产站点上没有任何本轮 SEO 改动。**

| 检查项 | 生产实测 | 结论 |
|---|---|---|
| `https://tlines.tech/en/topics` | **404** | 主题层未上线 |
| `https://tlines.tech/en/market-themes` | **404** | 公开主线页未上线 |
| 生产首页 `<title>` | `Tlines Institutional Intelligence \| Bank Research & Market Consensus`（68 字符） | 仍是旧构建 |
| 生产研报页标题超 60 字符比例 | **88%（89 个抽样中 79 个）** | 仍是旧构建 |

因此本报告分两栏陈述事实：

- **[PROD]** = 现在 Google 看到的东西（旧构建）
- **[TREE]** = 工作树里已验证通过、但尚未部署的改动

任何"已修复"的说法在部署前都不成立。这是本次审计最重要的结论。

---

## 1. 结论摘要

| 判定 | 内容 |
|---|---|
| **可以上线** | 工作树中的 metadata 收敛、canonical/hreflang、sitemap hreflang 注解、主题层、内链引擎、Schema 补全。这些在生产构建方式下逐页验证过，无阻塞性缺陷。 |
| **必须上线前解决** | C-2 生产垃圾标题被索引（真实存在的错误主题页）、C-3 机构页无关联声明（商标/E-E-A-T 合规）、H-1 工作树中新引入的 3 处标题超长 + 1 处描述超长（我上一轮改动的回归）、H-2 中文研报页 4 字符 description（生产） |
| **上线后继续优化** | 政策页扩写、机构页枢纽覆盖补齐、分页 URL 策略、中文表格未翻译、`?q=` 与搜索落地页、CWV/移动端实测 |

### 已核实**无问题**的项（不必重复检查）

这些是我实测确认为正常、且不需要改动的：

- **多 H1**：46 个 [TREE] URL + 21 个 [PROD] 页面 URL + 89 个 [PROD] 研报页，**全部恰好 1 个 H1**，仅 `/en/macro` 为 0（见 H-4）。
- **canonical 自指**：135 个抽样页面 100% 自指正确，无互指、无 query 串污染（唯一例外是分页 `?page=N` 的刻意自指，见 M-5）。
- **Title / Description 重复**：89 个 [PROD] 研报页 + 46 个 [TREE] URL + 21 个 [PROD] 页面 URL，**精确重复 0 例**。（相似度分析未做，见"需要验证"节）
- **hreflang 双向**：`en` / `zh-CN` / `x-default` 三组齐全且互相指向；中文页在译文不达标时**不再**声明 `zh-CN` alternate，英文页也不声明它 → 无"伪造译文"。
- **x-default**：一律指向英文版本，合理。
- **sitemap 不含 noindex / redirect / 404**：89 个 [PROD] 研报 shard URL 与 21 个 pages shard URL 全部 `200` + 可索引；sitemap 与页面 robots 共用同一质量门禁。
- **robots.txt 未错误拦截**：只 disallow `/api/*` 子路径；登录/账户/后台**故意不 disallow**（否则其 noindex 读不到），判断正确。**robots 无变化，无需改动。**
- **Faceted Navigation 无 crawl trap**：过滤 URL 一律 `noindex, follow` + canonical 指向 `/en/research`；筛选器是 GET form（不产生可抓链接）；sitemap 无 query URL。
- **SSR 内容完整**：所有抽查页面的 H1、正文、面包屑、schema 均在原始 HTML 中；关闭 JS 仍可理解。（PDF 正文按设计不在 HTML 中，见 M-6）
- **Schema 归属正确**：研报页 JSON-LD 为 `author: {Organization, name: "<机构>"}`、`publisher: {Organization, name: "<机构>"}`、`sdPublisher: {"@id": ".../#organization"}`（Tlines）、`isBasedOn: <原文 URL>`。**机构观点没有被错误归属给 Tlines**，这一段设计是正确的。
- **viewports**：所有抽查页面均有 `width=device-width` meta。

---

## 2. Critical

### C-1 生产环境未部署任何本轮改动
- **URL/Template**：全站
- **问题**：`/en/topics` 与 `/en/market-themes` 返回 404；首页标题仍为 68 字符；88% 研报页标题超长。
- **为什么是问题**：如果上线验收基于"改动已完成"，会误判为已优化；实际 Google 看到的仍是旧状态。
- **修复方案**：构建并发布工作树；发布后重跑本报告"验证方式"。
- **需要修改的文件**：无（部署流程）
- **验证方式**：`curl -A Googlebot https://tlines.tech/en/topics` 应返回 200；首页 `<title>` 长度应为 47。

### C-2 生产存在"以 UI 动作作为标题"的被索引页面
- **URL**：`/en/research/citi-download-the-pdf-ongoing-developments-part-1-ki8uduhxcx`
- **问题**（实测原始 HTML）：
  - `<title>` = `Download the PDF "Ongoing Developments Part 1" · Tlines Institutional Intelligence`（82 字符）
  - `<h1>` = `Download the PDF "Ongoing Developments Part 1"`
  - `robots` = `index, follow`；JSON-LD `headline` 同样是这句
  - 该页面**真实主题**只出现在 JSON-LD 的 `isBasedOn` 里：`…EU-and-UK-Part-1.pdf`（欧盟/英国金融服务监管动态）
- **为什么是问题**：页面在搜索里的身份是"下载 PDF"这个动作，而不是任何主题。它无法匹配任何有意义的查询，同时占用抓取预算并稀释站点主题集中度。同类标题（`pdf 777 kb`、`file of entire text`、`daily08032026`）在 [PROD] 抽样中还出现多例。
- **修复方案**：工作树的 `contentQuality.ts` 已新增 `isNoiseTitle()`（覆盖 `download the pdf`、`pdf <n> kb`、`file of entire text`、文档尺寸标签、无实义字符）→ 命中即 `noindex, follow` 且不进 sitemap。对存量页面需额外跑一次重跑把标题替换为真实主题（`Analysis.seoTitle` 已有生成能力）。
- **需要修改的文件**：`src/lib/contentQuality.ts`（已改）；**新增** `scripts/title-audit.ts`（存量清单，尚未创建）+ 复用 `prisma/retitle.ts`
- **验证方式**：该 URL 返回 `<meta name="robots" content="noindex, follow">`；重跑后 `<title>` 包含 "EU" 或 "financial services regulation"。

### C-3 机构页可能被误认为机构官方网站（商标 + E-A-T 合规）
- **URL**：`/en/institution/goldman-sachs`（同类：全部 50 个机构页）
- **问题**（实测原始 HTML）：
  - `<title>` = `Goldman Sachs Market Outlook, Forecasts & Research | Tlines`
  - `<h1>` = `Goldman Sachs`
  - 页面**没有任何**关联声明（正则检测 `not affiliated / no association / 无关联 / 非官方` = 未命中）
  - 出站按钮 `Research homepage ↗` → `https://www.goldmansachs.com/insights`
  - JSON-LD：`ProfilePage` 的 `mainEntity` = `Organization{name:"Goldman Sachs", url:"https://www.goldmansachs.com/insights"}`
- **为什么是问题**：标题 + H1 + ProfilePage 实体 + "Research homepage"按钮共同构成"这是高盛官方研究页"的观感。这既是商标使用风险，也会让 Google 把内容作者身份混淆（YMYL 场景下 E-E-A-T 反向扣分）。
- **修复方案**：H1 正下方加一句显式声明（工作树已实现），并让 `mainEntity` 保持事实性（指向机构是真的）但页面文案明确"Tlines 仅索引其公开研究，无关联、未获授权"。
- **需要修改的文件**：`src/app/institution/[slug]/page.tsx`（已改，未部署）
- **验证方式**：抓取任意机构页，正文应包含 `not affiliated with, endorsed by, or acting on behalf of`。

---

## 3. High

### H-1 我上一轮改动中的回归：3 处标题 + 1 处描述仍超长
- **URL/Template**（[TREE] 本地构建实测，非生产）：
  - `/en/institution/ocbc/accuracy` → 64 字符
  - `/en/topics/inflation` → 64 字符
  - `/en/topics/monetary-policy` → 62 字符
  - `/en`（首页 description）→ **195 字符**
- **问题**：`clamp(…, 60)` 只约束了构造器返回值，但 `layout.tsx` 的标题模板还会追加 ` · Tlines`（9 字符），三个页面因此叠加后超长；首页 description 则完全没调用 `clamp()`。
- **为什么是问题**：这正是我在上一轮声称"所有构造器 ≤60"的部分——我的单测只断言了构造器输出，没有断言**最终组合后的 `<title>`**，所以测试给了错误信心。审计以最终 HTML 为准时暴露出来。
- **修复方案**：`/en/institution/[slug]/accuracy` 与 `/en/topics/[topic]` 改用 `title: { absolute: … }`（与首页/研报/资产/机构页一致），或把 `clamp` 上限降到 51；首页 description 加 `clamp(description, 158)`。
- **需要修改的文件**：`src/app/institution/[slug]/accuracy/page.tsx`、`src/app/topics/[topic]/page.tsx`、`src/app/page.tsx`
- **验证方式**：本地构建后 `curl` 这三个 URL，`<title>` 长度应 ≤60；首页 description ≤158。建议把测试改为断言最终 `<title>` 而非构造器。

### H-2 中文研报页 meta description 退化为 4 个字符
- **URL/Template**：[PROD] 实测 `/zh/research/standard-chartered-navigating-divergence-across-commodity-markets-t49ki9dkix` — description 长度 **4**，而该页正文有 1919 个汉字。
- **问题**：`summaryZh` 缺失时回退到机构名，于是中文页的 SERP 描述是四个字。
- **为什么是问题**：中文是 Tlines 的第二门语言，description 是点击率的主要文案位；四字描述等于放弃这一次点击。（该页当前 `noindex`，但同源逻辑影响所有中文页的回退路径。）
- **修复方案**：工作树已改为 `summary → 机构名 + 发布日期 + "本页为 Tlines 的结构化解读"` 兜底并 clamp 到 158。生产部署后仍应统计有多少中文页走兜底路径。
- **需要修改的文件**：`src/app/research/[id]/page.tsx`（已改，未部署）
- **验证方式**：任取一个 `summaryZh` 缺失的中文研报页，description 长度应 ≥70 字符。

### H-3 14/50 机构页没有任何枢纽级入链
- **URL**：`/en/institution/{anz, aqr, barclays, bmo, cibc, commerzbank, daiwa, deutsche, hsbc, julius, kkr, mizuho, nab-markets, pgim}`
- **问题**：抓取 34 个入口页（首页、全部 19 个资产页、11 篇研报、`/institutions`、`/research`、`/markets`）后，这 14 个机构页**没有任何一处链接指向它们**。
- **为什么是问题**：它们仍可由 sitemap 发现，且各自研报页会链到自己（所以**不是严格孤儿**），但除了 sitemap 与个别研报页之外没有内部路径。`/en/institutions` 是"热度排序的观点流"，不是机构索引，因此机构页的可发现性取决于它是否出现在最近 7 天窗口。
- **修复方向**：新增机构索引（字母序或按覆盖资产），或让 `/en/institutions` 同时输出完整机构列表。
- **需要修改的文件**：`src/app/institutions/page.tsx`（新增机构分组列表）、可能新增 `src/app/institutions/all/page.tsx`
- **验证方式**：完整爬虫（Screaming Frog / Sitebulb）跑全站，检查 Orphan URLs 报告为空。**我本次未做全站爬取，因此"严格孤儿"结论待验证。**

### H-4 生产 `/en/macro` 没有 H1
- **URL**：`/en/macro`（[PROD] 实测 H1 数 = 0）
- **为什么是问题**：该页是"经济数据"这一品类的唯一入口，没有 H1 意味着页面主题只能从导航与表格推断；同时页面已可索引。
- **修复方案**：工作树已补 H1 + Intro + `CollectionPage`/`ItemList`/`BreadcrumbList` 三类 schema。
- **需要修改的文件**：`src/app/macro/page.tsx`（已改，未部署）
- **验证方式**：`curl` 该页，H1 数应为 1。

### H-5 政策页过薄且与内容体系无连接（E-E-A-T 信号未形成）
- **URL**：`/en/about`（61 词）、`/en/methodology`（70 词）、`/en/sources`（64 词）、`/en/corrections`（71 词）、`/en/ai-usage`（73 词）、`/en/editorial-policy`（65 词）、`/en/financial-disclaimer`（73 词）、`/zh/methodology`（12"词"）
- **问题**（[PROD] 实测）：这些页面在生产环境**没有任何内容页在语境中链接到它们**（内链仅 16 条，全部来自导航与页脚 chrome）。工作树中已加入内容页 → 政策页的语境链接与政策页 → 管辖页面的反向链接。
- **为什么是问题**：YMYL 站点的方法论、来源与纠错声明若只是页脚孤岛，对信任评估几乎无作用；同时"方法论 70 词"本身也不足以支撑"可核验"的主张。
- **修复方案**：部署工作树（已完成链接部分）；**仍需人工**把 methodology / sources / corrections 扩写到 400+ 词并分 3–5 个 H2 小节。
- **需要修改的文件**：`src/app/[policy]/page.tsx`（链接已改）、政策正文 `PAGES` 常量（待人工扩写）
- **验证方式**：每页正文 ≥400 词、≥3 个 H2，且从研报页/资产页可点到。

### H-6 生产首页正文 197 词、0 个 H2
- **URL**：`/en`（[PROD] 实测：H2 = 0，正文 197 词，H1 后直接跳 H3）
- **为什么是问题**：首页是站点 Topic Identity 的主战场，但 HTML 中只有品牌名 + 一句副标题，没有说明"Tlines 是什么/解决什么问题/覆盖什么"，且标题层级为 H1→H3 跳级。
- **修复方案**：工作树已把 4 处 `div.section-t` 提升为 `<h2>`（H2: 0 → 8）、H1 改为意图句、新增语义段（正文 197 → 425 词）。
- **需要修改的文件**：`src/app/page.tsx`（已改，未部署）
- **验证方式**：首页 H2 ≥6、正文 ≥350 词、H1 含品类词。

---

## 4. Medium

### M-1 研报页 description 一律硬截断到 160 字符
- **URL**：全部研报页（[PROD] 抽样 89 个中大量恰好 =160，会停在单词/句子中间）
- **为什么是问题**：截断处可能丢失结论的落点，降低点击率。
- **修复方案**：改为按句/词边界截断（工作树已在 `clamp()` 中做词边界处理，但**研报页仍使用裸 `slice`**）。
- **需要修改的文件**：`src/app/research/[id]/page.tsx`（把 `description` 的 `.slice(0,158)` 换成 `clamp(…,158)`）
- **验证方式**：抽样 description 结尾不应出现半个单词。

### M-2 中文页面的表格块保留英文原文 —— **测量有误，已更正（见第 10.7 节）**
- **URL**：[PROD] `/zh/research/mufg-middle-east-daily-tz21bre1a3`
- **原报告实测**：正文第 3 块只有 7 个汉字，其余为 `Stock markets Index Chg, % Sovereign bonds Yields, % G-S*, bp Chg…`
- **更正后的事实**：该页的中文译文**整体位于折叠区**（`完整中文译文`）内，并非可见正文；且原测量把**英文原文副本**一并计入了 `.article-sections` 的文本量（该页有两个 `.article-sections`，一个在折叠的英文原文里）。因此"主正文出现中英混杂块"这一描述不成立。该页被折叠的中文译文里**确实**存在未翻译的表格块，这是翻译流程的真实缺口，但读者与搜索引擎看到的是折叠后的选择项，而非正文。
- **可见正文的真实状况**（以中文正文即主正文的页面实测）：`/zh/research/cmtb34kwt000mz562k0ah72ss` 可见正文 **3006 汉字 / 16 个拉丁词 = 0.5%**，属于机构名与代码，无混合块。
- **结论**：不再作为需要修复的缺陷。展示层折叠方案（`isUntranslatedBlock`）已实现并**随后撤回**——它针对的可见正文场景在实测中不存在，而在 0.5% 拉丁占比的正文上引入启发式折叠属于无谓风险（同类过度规则已造成过一次 17% 的误伤）。真正的修复位置在翻译流程（让表格行进入翻译），不是展示层。
- **需要修改的文件**：`prisma/translate.ts`（若将来处理表格翻译）
- **验证方式**：取样中文研报页，取**非折叠**的 `.article-sections`（`parents('details').length === 0`）计算汉字/拉丁词占比，应 < 5%。

### M-3 `/en/institutions` 分页缺 `rel=prev/next`
- **URL**：[PROD] `/en/institutions?page=2`（`rel` 属性实测为空）
- **为什么是问题**：与 `/en/research` 的处理不一致；rel 虽已被 Google 弱化，仍是可用的提示。
- **修复方案**：工作树已补。**需部署。**
- **需要修改的文件**：`src/app/institutions/page.tsx`（已改，未部署）
- **验证方式**：该页 HTML 含 `rel="prev"` / `rel="next"`。

### M-4 `?q=` 是死参数，且造成 robots 与 canonical 自相矛盾
- **URL**：[PROD] `/en/research?q=gold` → 实测 `noindex, follow`，canonical 指向 `/en/research`，但**页面内容与无参数版完全相同**（`q` 从未进入查询）。
- **为什么是问题**：一个既不搜索又自我否定索引的 URL，属于实现与声明不一致；同时站点因此缺失可索引的搜索落地页（`WebSite` schema 也主动省略了 `SearchAction`）。
- **修复方案**：工作树已把 `q` 从契约中移除（不计数、不触发 noindex）。**真正的搜索落地页仍需单独实现**。
- **需要修改的文件**：`src/app/research/page.tsx`（已改）+ 新增搜索页（待做）
- **验证方式**：`/en/research?q=gold` 与 `/en/research` 的 robots/canonical 行为一致。

### M-5 分页 URL 可索引且自 canonical（40 个 URL）
- **URL**：`/en/research?page=2..20`、`/zh/...` 同理（[PROD] 实测 `index, follow` + 自 canonical + rel prev/next）
- **为什么是问题**：这些页面与 hub 高度重复（仅卡片集合不同），`/en/institutions` 的分页同理。数量不大（约 40 个），风险中等。
- **修复方案**：二选一——（a）保留现状（自 canonical 是 Google 现行建议，我能接受）；（b）对第 N>5 页改 `noindex, follow` + canonical 指向第 1 页。**建议保持现状**，不值得为此改动。
- **需要修改的文件**：无（若采纳 b：`src/app/research/page.tsx`、`src/app/institutions/page.tsx`）
- **验证方式**：GSC「已编入索引」报告中观察这些页面的抓取与展示是否异常。需要 GSC 验证。

### M-6 PDF 来源研报的正文不在 HTML（设计取舍，但影响 Information Gain 判定）
- **URL/Template**：`src/app/research/[id]/page.tsx`
- **实测**：当存在出版方 PDF 时，机构原文由 `PdfPreview` 在 hydration 后绘制到 canvas；HTML 中的可索引文本只有 Tlines 的结构化分析 + 模板骨架。以 `/en/research/…-t49ki9dkix` 为例，HTML 段落仅 3 个 `<p>`。
- **为什么是问题**：这**降低**了"搬运原文"的重复内容风险（好事），但把每页的独特文本压到 400–900 词量级，且 988 个页面共享同一套 H2/H3 骨架 → 真正的风险是**模板同质化 + 独特内容偏少**，而不是重复源文。
- **修复方案**：不以"加原文"解决，而应以"加每页独有的增量"解决：结论摘要、机构预测分布对比、同资产其他机构观点对照。工作树已加"同资产其他机构研报"与主题链接（内链 18 → 22），但**每页独有文本量仍需内容侧工作**。
- **需要修改的文件**：`src/app/research/[id]/page.tsx`（部分已改）
- **验证方式**：随机 20 页，统计"去掉模板标签后的独有句子"数量；需要人工评审（非自动化指标）。

### M-7 [TREE] `/market-themes` 会在 index / noindex 之间摆动
- **URL**：`/en/market-themes`、`/zh/market-themes`
- **实测**：本地构建下因近 14 天无观点而 `noindex, follow`（117 词）；sitemap 也**同步移除**了该 URL（由页面与 sitemap 共用 `loadPublicThemes()` 保证一致）。
- **为什么是问题**：行为本身正确（没有内容就不该被索引），但若站点数据更新出现空窗，该页会在索引里进出，不利于稳定收录。
- **修复方案**：监控数据空窗；或改为"无主线时展示最近一次快照 + `noindex`"，让 URL 始终有内容。
- **需要修改的文件**：`src/app/market-themes/page.tsx`
- **验证方式**：连续观察该 URL 的 robots 与 sitemap 成员关系是否一致。

### M-8 研报 URL 仍存在 cuid 形式
- **URL**：[TREE] `/en/research/cmtbnu52t000merfimfbrd3vs`（生产部分文章已是可读 slug，如 `/en/research/uob-research-uob-group-research-fimfbrd3vs`）
- **为什么是问题**：不可读 URL 不影响索引，但丢失了 slug 中的关键词信号，且同一篇文章在两种形式间可能产生重复入口（页面有 `permanentRedirect` 到 slug，当前未观察到重复索引）。
- **修复方案**：核对生产 slug 覆盖率，对缺失的补 `buildResearchSlug`。
- **需要修改的文件**：排查脚本（`prisma/retitle.ts` 同类模式）
- **验证方式**：全部研报页 URL 匹配 `^/research/[a-z0-9-]{20,}$` 且不含纯 cuid 形态。

### M-9 部分研报主题与金融无关，Information Gain 低
- **URL**：[PROD] `/en/research/franklin-templeton-high-school-action-plan-part-1-freshman-and-sophomore-years-farbmrn1j5`
- **为什么是问题**：内容确实是机构公开发布的研究，但"高中升学规划"对 Tlines 的品类与用户毫无价值，页面存在的唯一作用是占用抓取与索引配额。
- **修复方案**：在准入环节增加主题相关性判定（按 topic/asset 命中率），无关内容 `noindex` 或不入库。
- **需要修改的文件**：`src/lib/publication.ts` 或 `src/lib/contentQuality.ts`（相关性门槛）
- **验证方式**：抽样 50 页人工判定主题相关性，命中率应 ≥90%。

---

## 5. Low

- **L-1** 中文页偶有音译残留：`/zh/research/mufg-middle-east-daily-…` 出现"Bessent涨幅"。属翻译质量细节，不影响索引。
- **L-2** 结构化数据在 [PROD] 缺 `CollectionPage`/`ItemList`（`/markets`、`/research`、`/institutions`、`/macro` 均无 JSON-LD），工作树已补。**需部署后复查 schema 校验。**
- **L-3** `descLen` 在 [PROD] 普遍恰好 160 → 见 M-1。
- **L-4** `rel=prev/next` 已被 Google 声明为弱信号 —— 投入产出比低，保持现状即可。

---

## 6. 随机抽查记录（最终 HTML 实测）

### 6.1 [TREE] 本地构建（46 URL 全量核验）

| 页面 | title 长度 | desc 长度 | H1 数 | 正文 | CJK | JSON-LD | 内链 |
|---|---|---|---|---|---|---|---|
| `/en` 首页 | 48 | **195** ✗ | 1 | 425 词 | 2 | Organization, WebSite | 52 |
| `/zh` 首页 | 23 | 67 | 1 | — | 756 | Organization, WebSite | 52 |
| `/en/markets` | 38 | 156 | 1 | 143 | 2 | CollectionPage, ItemList, BreadcrumbList | 35 |
| `/zh/markets` | 17 | 46 | 1 | — | 426 | 同上 | 35 |
| `/en/research` | 55 | 142 | 1 | 1107 | 2 | ItemList | 60 |
| `/zh/research` | 14 | 46 | 1 | — | 2567 | ItemList | 60 |
| `/en/markets/gold` | 52 | 74 | 1 | — | — | WebPage, Dataset, BreadcrumbList | 45 |
| `/en/markets/crude-oil-wti` | ≤60 | — | 1 | — | — | WebPage, Dataset, BreadcrumbList | — |
| `/en/markets/us-10-year-treasury` | ≤60 | — | 1 | — | — | WebPage, Dataset, BreadcrumbList | — |
| `/en/institution/ubs` | ≤60 | — | 1 | — | — | ProfilePage, ItemList, BreadcrumbList | — |
| `/en/institution/ing` | ≤60 | — | 1 | — | — | 同上 | — |
| `/en/institution/saxo` | ≤60 | — | 1 | — | — | 同上 | — |
| `/en/institution/ocbc/accuracy` | **64** ✗ | — | 1 | — | — | Dataset, BreadcrumbList | — |
| `/en/topics/inflation` | **64** ✗ | 40 | 1 | 758 | 2 | CollectionPage, ItemList, BreadcrumbList | 46 |
| `/zh/topics/inflation` | 19 | 40 | 1 | — | 1771 | 同上 | 46 |
| `/en/topics/monetary-policy` | **62** ✗ | — | 1 | — | — | 同上 | — |
| `/en/macro` | 60（带后缀 69 实测 60 无后缀） | 150 | 1 | 205 | 2 | CollectionPage, ItemList, BreadcrumbList | 47 |
| `/en/market-themes` | 67 | 161 | 1 | 117 | 2 | CollectionPage, BreadcrumbList | 17（noindex，符合预期） |
| `/en/research/{7 篇}` | 55 等 | 158 | 1 | 863–1876 | 2 | AnalysisNewsArticle, BreadcrumbList | 22–24 |
| `/zh/research/{4 篇}` | 21 等 | **120**（原 4）✓ | 1 | — | 1876–3915 | 同上 | 18–24 |
| 政策页 ×8 | 20–48 | 152–160 | 1 | 74–88 词（偏薄） | — | WebPage | 18 |

**抽查确认**：`/en/research/{slug}` 的 H2 结构为 `One-sentence conclusion` / `Key arguments` / `Key numbers` / `Main risks` / `Conditions / invalidation` / `AI analysis` / `Related institutional views` / `How this page was produced`（H2 = 7，H3 = 5，无跳级）；主题芯片链接逐一 curl 均为 200；同资产其他机构研报块实测渲染出 3 条跨机构链接且全部 200。

### 6.2 [PROD] 生产（89 研报 + 21 页面）

| 检查 | 结果 |
|---|---|
| HTTP 非 200 | 0 / 110 |
| 多 H1 | 0 / 110 |
| 无 H1 | 1（`/en/macro`） |
| canonical 自指错误 | 0 / 110 |
| 标题 > 60 字符 | **82 / 110**（研报 79，页面 3） |
| 标题/描述精确重复 | 0 / 110 |
| sitemap URL 为 noindex | 0 / 110 |
| 正文 < 120 词的页面 | 13（政策页 7 + `/en/markets` + `/en/institution/goldman-sachs` + accuracy + 2 研报） |
| description 恰好 160 字符 | 绝大多数研报页 |

### 6.3 关键机制实测

| 机制 | [PROD] 实测 |
|---|---|
| `/?` → `/en` | 308 ✓ |
| `/en/research?institution=ubs` | `noindex, follow` + canonical `/en/research` ✓ |
| `/en/research?institution=ubs&category=commodity&direction=bull&ticker=XAUUSD&page=3` | `noindex, follow` + canonical `/en/research` ✓（无 crawl trap） |
| `/en/research?page=20` | `index, follow` + 自 canonical + rel prev/next |
| `/en/institutions?page=2` | `index, follow` + 自 canonical，**无 rel** |
| `/en/research?q=gold` | `noindex, follow`，内容与无参版相同（死参数） |
| robots.txt | 仅 disallow `/api/*` 子路径 ✓ |
| 研报 JSON-LD 归属 | `author`/`publisher` = 机构；`sdPublisher` = Tlines ✓ |

---

## 7. 需要真实数据才能判定的项（本报告未做任何虚构）

| 待判定项 | 为什么无法在此判定 | 需要什么 |
|---|---|---|
| 收录数量、覆盖率 | 无 GSC 访问 | **需要 Google Search Console 验证** |
| 排名、展示、点击、CTR | 无 GSC | **需要 Google Search Console 验证** |
| Core Web Vitals（LCP/INP/CLS） | 无 CrUX / Lighthouse 运行环境 | **需要 PageSpeed Insights / CrUX 验证**（生产实测 TTFB 226–650 ms、首页 JS 约 158 KB gzip 仅为参考，不等于 CWV） |
| 移动端真实渲染 | 本次仅核验 viewport meta，未做设备渲染 | **需要 PageSpeed 移动端报告** |
| 描述/标题"近似重复"（非精确） | 我做了精确去重；相似度需全量文本 | 需要 Screaming Frog / 自建全量抓取 + 相似度聚类 |
| 是否真正 Orphan | 我只做了 34 页入口抓取 | 需要全站爬虫（Screaming Frog / Sitebulb） |
| 主题页是否算法判定为 Thin | 只有正文长度与结构 | 需要 GSC 的"已抓取未编入索引"原因分布 |
| 关键词搜索量与难度 | 无关键词工具 | 需要 Ahrefs / Semrush / Keyword Planner |

---

## 8. SEO Launch Checklist（可逐项验收）

### A. 部署正确性
- [ ] A1 `https://tlines.tech/en/topics` 返回 200（非 404）
- [ ] A2 `https://tlines.tech/en/market-themes` 返回 200 或按无主线时 `noindex`（二者必居其一且与 sitemap 一致）
- [ ] A3 生产首页 `<title>` = `Tlines — Institutional Research & Bank Consensus`（47 字符）
- [ ] A4 生产研报页标题 ≤60 字符比例 ≥95%（抽样 30 页）

### B. Metadata
- [ ] B1 全部模板 `<title>` ≤60 字符（含标题模板后缀）——**当前 H-1 未达标：accuracy、topic 详情**
- [ ] B2 全部模板 meta description ≤158 字符——**当前首页 195 未达标**
- [ ] B3 无 description 短于 70 字符的非 noindex 页面——**当前中文研报页 4 字符未达标**
- [ ] B4 每个模板有自己的标题公式（首页/资产/机构/研报/主题/经济数据/观点/研报流）
- [ ] B5 每页恰好 1 个 H1
- [ ] B6 标题层级无跳级（H1 → H2，无 H1 → H3）

### C. 索引与规范化
- [ ] C1 每页 canonical 自指（分页除外，且分页为刻意自指）
- [ ] C2 en 与 zh 页面**不互相 canonical**
- [ ] C3 hreflang 三组齐全（`en` / `zh-CN` / `x-default`）且双向
- [ ] C4 无译文的中文页不声明 `hreflang=zh-CN`
- [ ] C5 `x-default` 指向英文版本
- [ ] C6 sitemap 中不含 noindex URL、redirect URL、404 URL
- [ ] C7 sitemap 含 `xhtml:link` hreflang 注解（当前生产无）
- [ ] C8 robots.txt 未阻止任何需要被读取 noindex 的页面
- [ ] C9 过滤类 URL 全部 `noindex, follow` + canonical 指向 hub
- [ ] C10 过滤/分页 URL 未进入 sitemap

### D. 内容与信息增益
- [ ] D1 噪声标题页面（`download the pdf`、`pdf N kb`、`file of entire text`）为 noindex——**当前生产 Citi 页面仍 index**
- [ ] D2 无结构化分析的研报页为 noindex
- [ ] D3 中文研报页译文低于质量阈值时为 noindex
- [ ] D4 每个主题页 ≥3 机构 且 ≥5 研报（否则 404）
- [ ] D5 主题页存在人工撰写的固定 Intro（非模板拼接）
- [ ] D6 资产页 ≥2 家机构才 index
- [ ] D7 抽样 20 篇研报，人工确认每页有可识别的独有增量

### E. 内链与实体图
- [ ] E1 研报页 → 机构页 / 资产页（≥1）/ 主题页 / 同资产其他机构研报（≥1）——**部分研报页 0 个资产链接（生产抽样 57% 无资产链接）**
- [ ] E2 资产页 → 机构 / 研报 / 主题 / 经济数据
- [ ] E3 机构页 → 最新研报 / 主要资产 / 主要主题 / 预测记录
- [ ] E4 主题页 → 机构 / 资产 / 研报
- [ ] E5 每个机构页至少有一个枢纽级入链（**当前 14/50 未达标**）
- [ ] E6 全站爬虫孤儿报告为空（需 Screaming Frog）
- [ ] E7 研报页从首页抓取深度 ≤3

### F. Schema / 结构化数据
- [ ] F1 `Organization` 含 `description`、`publishingPrinciples`、`sameAs`（**`sameAs` 当前为空，需配置 `BRAND_SAME_AS`**）
- [ ] F2 列表页含 `CollectionPage` + `ItemList`（工作树已加）
- [ ] F3 研报页 `AnalysisNewsArticle` 的 `author`/`publisher` = 机构、`sdPublisher` = Tlines
- [ ] F4 准确率页含 `Dataset`
- [ ] F5 无虚假 `rating`/`review`/`price`/`award` 字段
- [ ] F6 Schema 校验工具无 error（Rich Results Test）

### G. YMYL / E-E-A-T
- [ ] G1 每个机构页有"无关联、未获授权"声明——**当前生产缺失（C-3）**
- [ ] G2 每个研报页有来源链接 + 最后更新时间 + 方法论入口
- [ ] G3 methodology / sources / corrections 各 ≥400 词、≥3 个 H2（**当前 61–73 词未达标，需人工扩写**）
- [ ] G4 政策页可从内容页语境进入（工作树已加）
- [ ] G5 金融免责声明在全部内容页可达
- [ ] G6 AI 生成内容有明确标注（已确认存在）

### H. 多语言
- [ ] H1 中文页正文主块为中文（表格块除外，见 M-2）
- [ ] H2 中文页不含英文关键词堆砌（实测：Tlines 自撰部分 0 个 ≥7 词英文串 ✓）
- [ ] H3 中文标题使用中文术语（实测 `通胀：机构观点与研报` ✓）
- [ ] H4 中文页 hreflang 与英文页互指（已确认 ✓）

### I. 表现与前端
- [ ] I1 所有页面含 viewport meta（实测 ✓）
- [ ] I2 SSR HTML 含 H1 + 正文 + 面包屑 + schema（实测 ✓）
- [ ] I3 关闭 JS 后核心页面仍可理解（实测 ✓；PDF 正文除外）
- [ ] I4 Core Web Vitals 达标 —— **需要 PageSpeed / CrUX 验证**
- [ ] I5 移动端可用性 —— **需要 PageSpeed 移动端报告**

### J. 监控与数据
- [ ] J1 GSC 已验证站点所有权 —— **需要 Google Search Console**
- [ ] J2 sitemap 已提交且无错误 —— **需要 Google Search Console**
- [ ] J3 记录基线（展示/点击/覆盖率）—— **需要 Google Search Console**
- [ ] J4 建立"被 noindex 页面数 / 中文覆盖率 / 门禁通过率"周度巡检

---

## 9. 验收结论

1. **工作树中的改动技术上可以上线**：304 项自动检查（typecheck / lint / 484 测试 / build）在工作树通过，且我用最终 HTML 逐页复核了 46 个 URL。
2. **上线前必须先修 4 项**：C-2（垃圾标题索引）、C-3（机构页关联声明）、H-1（工作树新引入的标题/描述超长）、H-2（中文 description 4 字符）。
3. **生产当前状态不能按"已优化"验收**：C-1 是本次审计的最重要发现。
4. **下列结论我明确不下**：收录数量、排名、流量、CWV 数值、哪些页面真的被判定为 Thin、是否真 Orphan、关键词量级——全部需要 GSC / PageSpeed / 全站爬虫 / 关键词工具，本报告未做任何虚构。

---

## 10. 部署后更正与结果（2026-09-17 追加）

### 10.1 已部署

两次推送 `main` 触发 Deploy 工作流，均成功（verify → build → GHCR → VPS，健康门禁通过）：

| commit | 内容 | 工作流 |
|---|---|---|
| `1e758a9` | 标题体系、主题层、内链引擎、Schema、机构声明、sitemap hreflang | 35211285984 ✓ 7m08s |
| `220ca64` | 下方两项更正 | 35212203964 ✓ 6m38s |

### 10.2 本报告中的一处失实（已更正）

**第 2 节 C-2 声称工作树的噪声标题门禁覆盖 `download the pdf`，这一说法不成立。** 门禁的正则锚定在"裸词组"或"文件名词开头"，而实际标题是 `Download the PDF "Ongoing Developments Part 1"`——动词在前，因此**首次部署后该页仍是 `index, follow`**。这是审计报告对我自己修复的过度自信陈述，实测推翻。

更正后的规则要求"动词在首 + 文件名词紧跟"，实测：目标页现为 `noindex, follow`；`Download the report on Q3 earnings` 这类真实标题不受影响。

### 10.3 首次部署后发现并撤回的一条过度规则

新增的 `no_structured_analysis` 规则（分析中没有论点/数字/风险 → noindex）**在生产上命中 17% 的研报页（42 页抽样中 7 页）**，而我在本地开发库测得的只有 4.5%。逐页核查被命中的页面：它们都有 Tlines 撰写的结论段与 3,650–4,321 词正文，属于"市场评论综述"这一类——**本来就不做可证伪的单点判断，因此结构化数组天然为空**。我据以判断"无独立价值"的前提不成立，规则的代价（约六分之一的研报页退出索引）远超收益。

**结论：撤回该规则**（`220ca64`），并在 `contentQuality.test.ts` 中留下带数据的测试，使重新引入必须正面反驳测量结果。撤回后英文可索引研报 308 → 315 篇。

### 10.4 部署后生产实测（最终验收）

| 检查项 | 部署前 | 部署后 |
|---|---|---|
| `/en/topics` | 404 | **200** |
| `/en/market-themes` | 404 | **200** |
| 首页 title / description | 68 / 171 字符 | **48 / 153** |
| 研报页标题 >60 字符（抽样） | 82/110 | **0/43** |
| 机构页关联声明 | 无 | 有 |
| 标题/描述重复、多 H1、canonical 自指错误、无 H1 | 1 个无 H1 | **全部 0** |
| sitemap `xhtml:link` | 0 | **1128** |
| sitemap 页面 URL 数 | 232 | **376**（含 68 个主题页 ×2 语言） |
| sitemap 含 noindex / 404 URL | — | **0** |
| robots.txt | — | 未改动（112 条 disallow，与部署前一致） |
| 抽样中唯一的 noindex 页面 | — | 正是 `Download the PDF …` 那一页（符合预期） |

### 10.5 存量噪声标题清理（已完成，2026-09-17）

原计划新建 `scripts/title-audit.ts`，实际执行时发现 `prisma/retitle.ts` 已经存在且正是为此而写：它从**已存储的出版方 PDF 自身**读回标题。但它的候选筛选用的是 `isCallToActionOnly`，会把 `Download the PDF "…"` 判为"可用"（因为主题就在引号里），所以直接重跑**修不到本该修的那一页**——这正是本轮先修筛选条件（`28239e4`）再执行的原因。

生产执行（`ops.yml` 新增 `retitle` 动作，先打印后写入，符合该文件既有的 dry-run 约定）：

| 原标题 | 修复后 | 验证 |
|---|---|---|
| `r star` | `US Rates Strategy · Is r* rising?` | title/H1/schema headline 三者一致 |
| `Go to Article` | `ECB Preview · Hiking, not guiding`（中文标题同步为「欧洲央行前瞻 · 加息，而非指引」） | 同上 |
| `Download the PDF "Ongoing Developments Part 1"` | `Ongoing Developments in Financial Services Regulation in the EU and UK – Part I · Investor Services`（中文「欧盟与英国金融服务监管的持续发展——第一部分 · 投资者服务」） | 与 schema `isBasedOn` 指向的 PDF 主题一致 |

结果：**3 页修复，5 页跳过**（跳过的页其文档未能给出更好的标题，保持 noindex）。三页均已从 `noindex, follow` 变为 `index, follow`，并重新进入 sitemap。

注意：slug 未变（如 `danske-bank-go-to-article-m0eem1kz1v`）——slug 一旦写入即不可变是本仓库的既有设计，改 URL 需要配 301，收益不抵成本。搜索读取的是 title/H1/schema。

### 10.6 仍未完成（更新后）
- **5 页无法自动修复**，保持 noindex。抽样中可见一例：`westpac-westpac-iq-pdf-file-morning-report-pdf-uyassvpk11`，标题为 `Pdf File Morning Report PDF`，其文档未提供可用标题，需要人工撰写或排除。
- **M-4 可索引搜索落地页**：`/search` 目前被中间件 308 到 `/research`，是**此前有意的产品决定**（"已退役栏目"）。把它变回可索引页面等于推翻该决定，需要你确认，因此我没有擅自改动。
- **M-9 主题相关性门槛**（如"高中升学规划"这类与金融无关的入库内容）：需要相关性判定规则。我在本次已因一条依据不足的规则造成 17% 误伤，因此不会在没有你参与定义阈值的情况下再加一条同类规则。
- **M-8 slug 回填：已核实无需处理**——生产 968 个英文研报 URL **全部**是可读 slug，此前看到的 cuid 只存在于本地开发库。
- **J 组监控**：GSC / PageSpeed / CrUX 需外部账号，无法在此完成。作为替代，已加入 `npm run seo:status` 与对应的 `seo-status` 运维动作，可在生产上随时读出"哪些页面被排除、理由是什么"。

### 10.7 本报告的第二处失实（已更正）

第 4 节 **M-2 声称"中文页主正文出现 7 汉字 + 大量英文的混合块"**——**测量方法有误**：

1. 我按 `.article-sections` 统计文本，但该页面有**两个** `.article-sections`：可见的中文正文，以及折叠在 `完整英文原文` 里的英文副本。我把两者都算进了"正文"。
2. 引用页 `/zh/research/mufg-middle-east-daily-tz21bre1a3` 的中文译文**整体位于折叠区**内（该页以出版方 PDF 为准），并非可见正文。

对"中文正文即主正文"的页面重新实测：`/zh/research/cmtb34kwt000mz562k0ah72ss` 可见正文 **3006 汉字 / 16 拉丁词 = 0.5%**，无混合块。据此我判断该场景不成立，并**撤回了据此实现的展示层折叠**（`isUntranslatedBlock`）——在 0.5% 拉丁占比的正文上引入启发式折叠是无谓风险。折叠区内的中文译文确实存在未翻译表格块，属翻译流程缺口，修复位置在管线而非展示层。

两处失实（C-2、M-2）有同一个根源：**我在报告里对"修复效果"的描述基于推断或口径不当的测量，而不是对最终结果的核验。** 本节的更正均以部署后的生产实测为准。

---

## 11. 最终生产状态（2026-09-17，本轮全部工作完成后）

以下数字由 `npm run seo:status`（经由 `ops.yml` 的 `seo-status` 动作）在生产环境读出，与站点自身用于 sitemap 和 robots 的门禁**同一份判断**，不是第二套口径：

```
en:    973/998 研报可索引，25 篇被排除
       reasons: abnormal_title=21  garbled_or_broken_words=2  analysis_needs_review=1  thin_content=1
zh-CN: 424/998 研报可索引，574 篇被排除
       reasons: missing_translation=313  translation_below_threshold=218  empty_summary=187
                abnormal_title=21  translation_language_mismatch=3  ...
pages: 50 机构页 · 20 资产页 · 71 个主题页达标
```

### 11.1 本轮完成

| 项 | 状态 |
|---|---|
| 标题体系 / Metadata / Schema / sitemap hreflang / 主题层 / 内链引擎 | 已上线并逐页验证 |
| C-3 机构页关联声明 | 已上线 |
| H-1 TREE 回归（3 处标题、首页描述） | 已修并验证 |
| H-2 中文 4 字符描述 | 已修（实测 120 字符） |
| H-3 机构页枢纽覆盖 | **已解决：50/50 机构页均有枢纽入链**（此前 14 页无） |
| M-1 描述词边界截断 | 已改为 `clamp` |
| M-8 slug 回填 | **核实无需处理**：生产 968 个研报 URL 全部可读 |
| 图标与 manifest | 已上线：`/favicon.ico`（16+32）、`/apple-icon.png`（180）、`/manifest.webmanifest` |
| 门禁可观测性 | 已上线：`seo:status` + 运维动作 |
| 存量噪声标题清理 | 两轮共修复 **6 页**（3 + 3），`abnormal_title` 24 → 21 |
| M-2 中文表格 | 测量有误，已更正并撤回据此实现的改动（10.7 节） |

### 11.2 明确未做，及原因

- **M-4 可索引搜索落地页**：`/search` 被中间件 308 到 `/research` 是**此前有意的产品决定**。恢复为可索引页面等于推翻该决定，需你确认。
- **M-9 主题相关性门槛**：本轮已因一条依据不足的规则造成 17% 误伤，不会再在没有你参与定义阈值的情况下新增同类规则。
- **21 页仍因 `abnormal_title` 被排除**：其中 13 页是同一份"Morning Report"重复入库（同一文档被采集 13 次），其 PDF 自身没有可用的独立标题。工具已拒绝写入 13 份重复标题（见 `835e7e1`），需要**人工撰写标题或做去重**——这是内容决策，不是代码问题。
- **中文 574 篇被排除**是当前最大的单一 SEO 缺口，但成因是 `missing_translation=313` 与 `translation_below_threshold=218`，即**翻译覆盖与质量**，属内容管线工作。
- **J 组**：GSC / PageSpeed / CrUX 需外部账号。本报告自始至终未对收录数量、排名、流量、CWV 做任何断言。
