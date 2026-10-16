# 05 · 增量开发任务清单（基于真实文件路径）

> 原则：**不重建、不清库、不改历史 URL、不动生产直发 main**。每项任务列出：真实文件、动作、依赖、风险、验证方式。
> 工作量记号沿用 PRD：S/M/L/XL。执行顺序见 §6。

## EPIC 0 — 审计与基线（本次已完成 / 剩余）

| 任务 | 状态 | 说明 |
|---|---|---|
| TL-001 仓库/部署审计 | ✅ 本次 | 见 01 文档；部署路径与回滚见 07 |
| TL-002 URL 清单 | ◐ 本次完成一半 | [url-inventory csv](./url-inventory-2026-10-16.csv) 已含 3,422 条；GSC 列留空（无凭据，开放问题 2） |
| TL-003 数据契约 | ◐ | 01 文档 §3 覆盖核心机制；`prisma/schema.prisma`（72 模型）即事实源；PRD §5.1 目标模型与现状的字段级 diff 待做（M） |
| TL-004 基准截图/性能 | ◐ head 快照完成 | `scripts/redesign-baseline.mjs` + `baseline/head-snapshot-2026-10-16.json`（256 URL）；六档宽度截图与 CWV 采样待 TL-101 落地前完成 |
| TL-005 Flag/回滚/E2E 骨架 | ✅ 本次 | `src/lib/redesign.ts`（env `TL_REDESIGN`，默认 off，视图层专用）+ 单测；回滚方案见 07 |
| TL-006 计数口径 | ✅ 本次 | `src/app/page.tsx` 补 `isLegacyNonAssetAlias` 过滤（20→18 与目录一致）；两种机构口径的文案说明见 03 §4 |

## EPIC 1 — 设计系统（新文件集中在 `src/app/_components/editorial/`）

| 任务 | 文件 | 动作 | 依赖 |
|---|---|---|---|
| TL-101 tokens/字体/栅格（M） | `src/app/globals.css`（改值，不改变量名） | 纸色底、`--brand` 微调、加 `--warn`、正文类字号提到 16-18px、`tabular-nums` 统一；衬线标题字体自托管（决策见 README 开放问题 6） | 无 |
| TL-102 基础控件（M） | `globals.css` + `_components/editorial/` | Button/Link/Input/Dialog/Drawer/Badge/Tabs/Skeleton 的 a11y 状态补全 | TL-101 |
| TL-103 页眉/页脚/搜索入口（M） | `src/app/layout.tsx`、`_components/MobileNav.tsx`（复用）、`_components/SearchBox.tsx`（扩弹层） | 视觉改版 + 滚动收起；**保留 loca lePath/整页语言切换机制** | TL-101 |
| TL-104 内容组件（M） | `_components/ui.tsx`（FeedCard 改造）、`_components/editorial/*`（新：Byline/KeyTakeaways/EvidenceReference/DataFigure 封装/ReadingProgress） | 见 04 §3 表格 | TL-102 |
| TL-105 组件展示与视觉基线（M） | 新 `src/app/admin/design-system/page.tsx`（admin 门禁、noindex）或静态 harness | PRD 允许"项目适配方案"；不引入 Storybook | TL-102 |
| TL-106 动效规范（S） | `globals.css` | 120-220ms、`prefers-reduced-motion`、focus-visible | TL-101 |

## EPIC 2 — 核心媒体页面

| 任务 | 文件（真实路径） | 动作要点 | 风险 |
|---|---|---|---|
| TL-202 **文章详情改造（L，先行）** | `src/app/research/[id]/page.tsx`（1.7KB+ 现有结构）、`globals.css .article-*`、`src/lib/queries.ts getResearchView`、`src/lib/apiSerialize.ts`（仅读） | 阅读层：面包屑/来源署名/导语/KeyTakeaways/证据边栏（复用 `.atomic-view <details>` 模式）；AI 与原文标签复用 `.ai-analysis-label`；引文复制按钮；**不改 gate 判定与 JSON-LD** | 详情页现有三遍正则门控的性能问题（01 §5）随之处理 |
| TL-201 新首页（L） | `src/app/page.tsx` + `src/lib/queries.ts`（`latestFeed/mostActive/importantReleasesThisWeek` 已有） | PRD P01 结构：编辑封面+今日观察+主题+一图+深度；数据全部经 `publicationReadyWhere` | 与"去 hero"意见的对齐（02 §4）；计数口径同 TL-006 |
| TL-203 研究列表（M） | `src/app/research/page.tsx` | 编辑精选/时间双模式；筛选深链保留（现有 URL 参数已可复制）；**分页保持可索引页码**；顺手做 DB 分页（displayAt 物化，见 01 §5） | 全表排序性能 |
| TL-204 主题（M） | `src/app/topics/page.tsx`、`src/app/topics/[topic]/page.tsx`、`src/lib/topics.ts` | 常青引言区（运营字段）+ 既有闸门规则的每语言判定不动 | 主题页 index 摆动（03 R7） |
| TL-205 搜索体验（M） | `_components/SearchBox.tsx`、`src/app/api/search/route.ts`（复用）、可选新 `/search` 结果页 | ⌘K 弹层；结果页若新增**默认 noindex**（03 红线 3） | 新页面索引策略 |
| TL-206 信任页排版（S） | `src/app/[policy]/page.tsx`、`src/lib/policies.ts` | 8 个政策页统一编辑式排版 + 文章页信任入口 | 低 |

## EPIC 3 — 数据、机构与订阅

| 任务 | 文件 | 动作要点 |
|---|---|---|
| TL-301 机构目录/档案（L） | 新 `/institutions-directory`（避开 `/institutions` 语义，02 §4）；复用 `src/app/institution/[slug]/page.tsx` 数据层 | 旧 `/institutions` 保持现有行为（或按站主裁决） |
| TL-302 宏观标准化与图表故事（L） | `src/lib/macro/`（50 文件）、`src/app/macro/*` | 单位词表与期次标注（PRD §4-P06）；**存量数据不改，仅展示层**；宏观单位风险见 03 §2 |
| TL-303 Newsletter（M） | **全新**：需选型（开放问题 4）；落点建议 `src/app/newsletter/` + `src/lib/newsletter/` | 双重确认/退订/隐私政策适配 |
| TL-304 收藏/阅读列表（M） | 现有 `watchlist`/`dashboard` 模型可承托；`src/app/actions.ts` | 与 PRD P08 对齐；公开文章索引不受登录影响（已有约束） |
| TL-305 编辑队列（M） | 现有 `src/app/admin/review/page.tsx` + `src/lib/gate.ts` | 精选标记新列（需迁移，附加列安全）；质量门禁 A/B/C 映射到 gate issues |
| TL-306 旧工具兼容回归（M） | `/watchlist`、`/dashboards`、`/alerts` | 只做回归测试，不改业务规则 |

## EPIC 4 — SEO 资产保护与发布

| 任务 | 文件 | 动作要点 |
|---|---|---|
| TL-401 metadata 模板（M） | `src/lib/seo.tsx`（唯一出口） | 新页面全部复用；不手写 head |
| TL-402 sitemap（M） | `src/lib/sitemap.ts` | 新归档页注册；沿用判决列驱动；**不改命名分片地址** |
| TL-403 URL 映射执行（M） | [url-mapping csv](./url-mapping-template.csv)（本次建立） | 全量默认 keep；任何 301 须单跳并过审批 |
| TL-404 性能（L） | 见 01 §5 热点清单 | 缓存层先行（ISR 或读函数缓存），再谈 LCP 目标 |
| TL-405 回归（M） | `scripts/seo-baseline.mjs`、`scripts/seo-monitoring.mjs`（复用）、新增 a11y/截图脚本 | 与 TL-004 基线比对 |
| TL-406 灰度/演练（M） | 见 07 | 发布路径无 CI，演练必须手写清单化 |

## §6 执行顺序（依赖图）

```
本次审计(TL-001/002/003/006) → TL-004/005 → TL-101..106
  → TL-202(文章先行) + TL-401/402 并行
  → TL-201/203/204/205
  → TL-301/302/303/304/305 + TL-306 回归
  → TL-403/404/405 → TL-406 灰度与 28 天监测
```

**为什么文章先行**（PRD 同款理由 + 本仓特性）：详情页是最深、最依赖闸门/双语/PDF 的模板，先证明它在新视觉下保持索引与证据链，再把流量引向新首页。

## §7 禁区（触碰即停，逐项对应仓库证据）

1. `src/lib/contentQuality.ts` / `src/lib/gate.ts` / `src/lib/publication.ts` 的判定语义（可加测试，不可改规则）；MCP 发布路径 `src/lib/mcp/publicationDrafts.ts` 的闸门校验。
2. `buildResearchSlug` 与既有 slug、`researchRedirectPath`。
3. `src/lib/sitemap.ts` 的分片命名与地址；`src/middleware.ts` 的既有重定向表。
4. `prisma/postgresql/migrations/` 既有迁移（只许新增附加式迁移）。
5. 部署与生产环境（本轮审计无任何写操作；功能 PR 也不得直发 main）。
