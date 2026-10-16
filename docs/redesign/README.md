# Phase 0 工程审计 — 索引

> 审计日期：2026-10-16 · 分支：`redesign/phase-0-audit`（基于 `main@38a3019`）
> 依据：`Tlines_高端研究媒体_全量重构PRD_v1.0.md`（根目录）+ 仓库实码 + 线上只读采样
> 状态：**审计与规划完成，未做任何功能重构、未触碰生产、未改任何 URL**

## 本目录内容

| 文件 | 对应要求 | 内容 |
|---|---|---|
| [README.md](./README.md) | 总览 | 结论摘要、方法与证据、开放问题 |
| [01-architecture-and-dependencies.md](./01-architecture-and-dependencies.md) | 输出 1 | 当前架构与依赖图（技术栈、分层、核心机制、文档漂移） |
| [02-route-inventory.md](./02-route-inventory.md) | 输出 2 | 实际页面与路由清单（43 页面 + 20 route handler，含索引策略与访问控制） |
| [03-seo-baseline-and-risks.md](./03-seo-baseline-and-risks.md) | 输出 3 | SEO 基线（线上实测）与迁移风险（含计数口径差异根因） |
| [04-css-and-component-reuse.md](./04-css-and-component-reuse.md) | 输出 4 | CSS/token 与组件复用分析（对照 PRD §6） |
| [05-incremental-task-plan.md](./05-incremental-task-plan.md) | 输出 5 | 基于真实文件路径的增量任务清单（PRD EPIC → 文件映射） |
| [06-phase-acceptance.md](./06-phase-acceptance.md) | 输出 6 | 分阶段验收标准与 QA 矩阵落地 |
| [07-rollback-plan.md](./07-rollback-plan.md) | 输出 7 | 回滚方案（部署/迁移/特性开关/SEO） |
| [url-inventory-2026-10-16.csv](./url-inventory-2026-10-16.csv) | TL-002 之一 | 线上 sitemap 全量 3,422 条 URL（locale/section/分片） |
| [url-mapping-template.csv](./url-mapping-template.csv) | TL-002 之二 | URL 决策表模板（默认 keep 原则） |

## 执行摘要（七条结论）

1. **技术栈与 PRD 方向相容，不需要也不允许重建。** Next.js 15 App Router + React 19 + Prisma 5（生产 PostgreSQL 16，72 个模型）+ 自研 CSS（globals.css 1305 行），108 个测试文件 / 620 项测试全绿。重构性质应是"换装与编排"，不是换骨。
2. **公开内容的真相源是"闸门"而不是页面代码。** 每篇研报的可索引性由 `indexableEn/indexableZh` 判决列决定，列表/sitemap/API/RSS/MCP 全部读它。任何新页面必须继续问同一个闸门，否则会把 NOINDEX 页重新广告出去——这是本仓最容易踩的架构红线。
3. **线上 SEO 资产已清点：3,422 条 canonical URL**（10 个命名分片），robots 保守且明确放行 AI 爬虫，研报页 hreflang 仅在实际存在时输出（en/zh-CN/x-default 自指均有实测样本）。URL 零损失原则与 PRD §8 完全一致，本仓工具（`scripts/seo-*.mjs`、`docs/seo-recovery/`）可复跑。
4. **需要先决定的一件事：PRD 的导航方向与站主 2026-10-16 早前的"观点下架/三页合一"指令相抵触。** PRD 要求 `/institutions` 等旧路径"200 原址保留或严格映射"，而早前指令要求下架观点页并把看板/交易主线/经济体合并。两个方向都合理，但不能同时执行——列为开放问题 3，等待站主裁决。
5. **组件与 CSS 的可复用度高于预期**：设计 token 已存在（light/dark 双套 CSS 变量）、搜索框/主题切换/移动导航/图表组件都有现成实现。PRD §6.3 的 22 个组件中约 9 个可复用或轻改，其余为新增；字体方案（PRD：衬线标题 + 无衬线正文 + 表格数字）当前只差"衬线标题"一环，`--serif` 变量已在。
6. **首页与目录的数字口径差异已定位到代码行**：首页缺 `isLegacyNonAssetAlias` 过滤（20 vs 18 个资产）、"发布机构"两种定义（51 vs 45）。修法是统一口径与文案标注，不是改数字（PRD TL-006 同款要求）。
7. **MCP 是审计期内的新增变量**：2026-10-16 上线的 Publisher MCP 具备直接发布能力（经同一道公开闸门裁决），但三份 SEO 文档与监测规范都未覆盖它；重构验收必须把 `/api/mcp/*` 与 MCP 发布文章纳入回归面。

## 方法与证据标准

- 仓库侧：全部结论标注 `文件:行号`；不确定之处显式标"未验证"。
- 线上侧：只读 HTTP 采样（robots.txt、sitemap 10 分片、样本页 head），采样时点 2026-10-16，数值会随抓取漂移，**不写入验收断言**。
- 文档侧：`ARCHITECTURE.md` 存在多处过期陈述（见 01 文档 §6），审计以代码为准，文档仅作意图参考。
- 权限边界：无 GSC 凭据、无生产日志访问、无法验证真实用户指标——对应 PRD §1 审计限制，列为阻塞或后续项。

## 开放问题（需要站主或后续输入）

1. **导航方向裁决**（见结论 4）：PRD"保留/映射"路线 vs 早前"下架+合并"路线，二选一或明确先后。
2. **GSC 数据接入**：TL-002 的"URL × 点击/展现"合并需要 Search Console 凭据（或导出 CSV）；目前 `docs/seo-recovery/06` 提供了 CSV 导入通道但无凭据。
3. **版权/授权核查**（PRD §5.3）：存量中文全文译文的展示合法性需要法务口径；审计无法代替。
4. **Newsletter 基础设施**：现状只有事务邮件（nodemailer，注册/找回密码）；订阅列表/双重确认/偏好中心是全新增量，需要服务商选型（如发信配额、退订合规）。
5. **Feature flag 机制选型**：仓库无现成 flag 设施；建议 env 驱动的组件级开关（见 05/07），需确认。
6. **衬线标题字体选型**：PRD 允许"合法可商用且合理自托管"；设计稿示意 Source Serif 4（SIL OFL，可自托管），需品牌确认。
7. **真实设备与性能基线**：仓库有一方 Analytics（sendBeacon + rollup），但没有 CWV/RUM 基线；PRD NFR 的 LCP/INP/CLS 目标需要先建测量（TL-004）。
