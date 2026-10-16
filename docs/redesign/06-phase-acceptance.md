# 06 · 分阶段验收标准

> 原则：每个 PR 必须附可复跑的验证记录；**任何影响旧 URL 的 PR 必须附前后 URL 对照表**（PRD §12）。
> 仓库现有验证工具：`npm run typecheck`、`npm test`（108 文件 / 620 项）、`npm run lint`、`npm run build`、`scripts/seo-baseline.mjs`、`scripts/seo-monitoring.mjs`、`scripts/robots_audit.py`、`scripts/env:check`。

## M0 基线冻结（进入 EPIC 1 的门禁）

- [ ] TL-004 完成：六档宽度（360/390/768/1024/1440/1920）关键模板截图归档；LCP/INP/CLS 采样记录（测量方法须写明，不宣称未测的数字）。
- [ ] URL 基线复跑：`url-inventory` 与现场 sitemap 差异为 0（新增内容仅允许追加）。
- [ ] 50-100 条高价值 URL 的"不可回退集"建立：每条记录 title/H1/canonical/hreflang/robots/JSON-LD 类型/首屏文本 hash。
- [ ] 闸门基线：`npm run gate:recompute` 审计口径在案的 runbook 存在（与 R1 对应）。
- 通过标准：以上全部有可查记录；缺 GSC 时明确标注该列为"无凭据暂缺"而非留空。

## M1 设计系统（EPIC 1 验收）

- [ ] tokens 变更仅改 `globals.css` 变量值/新增变量，`grep -c "Tailwind"` 为 0，无新依赖。
- [ ] 组件展示页（TL-105）渲染全部新组件：默认/hover/focus-visible/disabled/loading/empty/长文本截断/键盘/触控状态齐全。
- [ ] 对比度：PRD §6.1 的 token 表逐项 WCAG AA 检查（脚本或人工记录）。
- [ ] `prefers-reduced-motion` 生效；键盘 Tab 遍历无陷阱。
- [ ] 既有组件回归：`MobileNav`/`ThemeToggle`/`SearchBox` 原行为测试仍绿。

## M2 内容页（文章先行验收，最重要门禁）

- [ ] **60 篇抽样研报页**（含中/英、PDF 原生/HTML 生成、含图/含表）逐页 diff：title/canonical/hreflang/robots/JSON-LD/breadcrumb 与 M0 快照一致（允许的差异仅在清单中列明）。
- [ ] JS 关闭时正文与来源可见（SSR 语义内容）。
- [ ] 证据链：来源链接可打开率抽样 ≥99%；失效来源显示"待核验"状态而非空白。
- [ ] AI 标签、机构原文归属、引文复制（含 canonical URL）齐备。
- [ ] 全量 `npm test` + `npm run build` 绿；`/research` 列表分页稳定排序（无重复/遗漏）。
- [ ] SEO 回归：`scripts/seo-baseline.mjs` 与 M0 基线比对，sitemap URL 只增不减（除非有 mapping 决策）。

## M3 首页与发现（在新内容页之后）

- [ ] 首页全部条目可溯源（每条有来源机构与外链）；接口失败时回退编辑精选而非空白。
- [ ] 计数口径文案与 TL-006 结论一致；无"伪实时"数字。
- [ ] 搜索：键盘全流程（⌘K → 输入 → ↑↓ → Enter → Esc）；中文 IME 组合状态不误触。
- [ ] 新 `/search` 类页面默认 noindex 已生效（`curl -I` 验证）。

## M4 高级内容与兼容

- [ ] 机构目录旧 URL 决策落地（keep 或单跳 301，mapping 表有记录）。
- [ ] 宏观图表：单位/期次/截止日显示；修改展示单位不改变底层值（抽样比对数据库）。
- [ ] 旧工具回归：登录/退出、`/watchlist`、`/dashboards`、`/alerts` 全可用（本仓账号 + API 冒烟）。
- [ ] MCP 回归：两端点 401/405 行为、`tools/list` 不变、发布路径闸门校验（对应 03 R9）。

## M5 发布（灰度 + 监测）

- [ ] 灰度：无 CDN 环境的灰度手段 = 部署窗口 + 快速回滚（07 §1），记录演练一次（TL-406）。
- [ ] 上线断言（PRD §11）：首页 + 不可回退集全部 JS-off 可读；来源/日期/机构无丢失；爬虫访问无新增 401/403；旧 URL 全部可达。
- [ ] D+1/7/14/28 监测按 `docs/seo-recovery/06-monitoring.md` 模板执行；**URL 变更导致的曝光波动与质量型波动分开判定**（该文档 §29-40 已定义口径）。
- [ ] 回滚门槛（PRD §8.3，需与历史波动校准后生效）。

## 每 PR 的 Done 定义（与 PRD §12 对齐的仓库化）

1. `npm run typecheck` && `npm test` && `npm run lint` && `npm run build` 全绿（附输出摘要）。
2. 至少核心宽度（390/1440）截图对比。
3. SEO 影响说明：是否触碰 metadata/canonical/hreflang/sitemap/链接；触碰则附对照表。
4. 性能影响说明：新增查询/包体变化；不得引入新的大依赖。
5. 文档更新：本目录对应任务状态 + 必要时更新 01/03。
