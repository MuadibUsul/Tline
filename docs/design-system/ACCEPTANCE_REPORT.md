# Tlines 设计系统验收报告

- 基线：`33c21be`
- 日期：2026-10-18
- 范围：公共站点主要页面 + 登录页 + 管理后台设计系统页
- 环境：本地生产构建 + 2026-10-18 生产发布（镜像 `sha-da6feb0`）

## 1. 结论

Phase A（Token 层）与 Phase B（P0/P1 修复）已完成并通过本地验收。Phase C 已完成核心组件收口、完全重复规则清理、119 处 token 采用和静态内联样式回收。Phase D 已完成公开页 98 组合矩阵、640px 重排、forced-colors、axe，以及后台 16 页的 390/768/1440 响应式与 7 页 axe 检查；Pa11y 和 CI 视觉回归尚未完成。

没有修改业务逻辑、数据库、路由、发布闸门、API 或品牌方向。该版本已于 2026-10-18 发布到 tlines.tech。

## 2. 改动文件

| 文件 | 内容 |
|---|---|
| `src/app/globals.css` | Primitive/Semantic/Component token；对比度、焦点、状态、目标尺寸修复 |
| `src/app/layout.tsx` | 首屏前恢复主题；`suppressHydrationWarning` |
| `src/app/_components/ThemeToggle.tsx` | `aria-pressed`，与首屏主题同步 |
| `src/app/_components/SearchOverlay.tsx` | 焦点闭环、背景滚动锁定、关闭归还焦点 |
| `src/app/_components/MobileNav.tsx` | 焦点闭环 |
| `src/app/_components/focusTrap.ts` | 共用 Tab 焦点闭环 |
| `src/app/_components/HomeFront.tsx` | “此刻值得关注”改为唯一 `h1`；空态/区块标题静态样式改 class |
| `src/app/_components/NewsletterCTA.tsx` | 订阅块静态内联样式改 class |
| `src/app/signin/page.tsx` | 登录页静态内联样式改 class |
| `src/app/admin/admin.css` | 后台控件边界与焦点环；980px 以下单列布局、导航网格、表格滚动容器 |
| `src/app/admin/analytics/**` | 滚动表格补焦点入口与可读名称 |
| `src/app/admin/design-system/page.tsx` | 展示完整 token 分组、字号/间距/圆角与 disabled 状态 |
| `src/app/global-error.tsx` | 错误页跟随系统 Light/Dark |
| `src/lib/designTokens.test.ts` | 5 项 token/对比度回归测试 |
| `scripts/design-audit.mjs` | 可复现的多视口/主题/对比度/forced-colors 审计 |
| `package.json` | 新增 `npm run design:audit` |

## 3. 自动化结果

| 命令 | 结果 |
|---|---|
| `npm test` | **PASS** · 685 tests / 685 pass / 0 fail |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `TL_REDESIGN=all TLINE_DIST_DIR=.next-verify npm run build` | **PASS** · compiled successfully，14 个静态页生成 |
| `DESIGN_AUDIT_BASE=... ADMIN_COOKIE=... npm run design:audit` | **PASS** · 98 公开组合 + 6 个 forced-colors + 公开/后台 axe + 16 个 admin 页面 × 3 宽度，0 failures；34 条小目标提示为内联链接 |

扩展审计还检查：`html lang`、文档标题、唯一 `main`、图片 `alt` 属性、交互元素可访问名称、24px 小目标提示，并用 axe-core 跑 WCAG A/AA（桌面 Light + 手机 Dark）。设置 `ADMIN_COOKIE` 后同时检查 16 个后台页面和 7 个后台代表页 axe。当前 0 failures、0 axe violations；34 条小目标提示主要是正文/元数据中的内联链接。另有 `inline-style count only ratchets down` 测试，将 130 个 `style={{` 对象设为回归上限。

设计 token 测试覆盖：

- 主按钮 Light / Dark；
- tertiary 文本；
- status 文本与 wash；
- control border 与 focus ring；
- legacy alias 仍然解析到 semantic token。

## 4. 浏览器验收

视口：320 / 390 / 640 / 768 / 981 / 1280 / 1440；Light / Dark。页面：`/zh`、`/zh/research`、研报详情、`/zh/news`、新闻详情、`/zh/methodology`、`/signin`。640px 是 1280px 在 200% 缩放下的等效 CSS 宽度。

| 检查 | 结果 |
|---|---|
| `/signin` 320px | **PASS** · `scrollWidth 320 = clientWidth 320`，无横向滚动 |
| 深色主按钮 | **PASS** · `rgb(8,9,10)` on `rgb(124,138,255)` = **6.58:1** |
| 浅色主按钮 | **PASS** · 4.70:1 |
| 首页 `h1` | **PASS** · 唯一“此刻值得关注” |
| 输入框焦点 | **PASS** · 2px solid focus ring；边界为 control border |
| Search 焦点闭环 | **PASS** · 12 次 Tab 未离开 panel；Escape 回到 `.search-trigger` |
| MobileNav 焦点闭环 | **PASS** · 20 次 Tab 未离开 drawer；Escape 回到 `.mobile-nav-toggle` |
| 主题持久化 | **PASS** · 选择 dark 后刷新，`data-theme="dark"` 保留 |
| 主题按钮状态 | **PASS** · `aria-pressed="true"` |
| 交互 chip | **PASS** · `a.chip` 最小高度 24px |
| 登录页折叠控制 | **PASS** · “忘记密码”summary 最小高度 24px |
| axe WCAG A/AA | **PASS** · 7 页 × 1440 Light / 390 Dark，0 violations |
| 移动端品牌链接名称 | **PASS** · 补 `aria-label`，品牌文字隐藏时仍有可读名称 |
| 研报分页目标 | **PASS** · 数字分页 24×24 |
| 观察列表点击重叠 | **PASS** · 链接受限在 line-clamp 盒内，不再压住 CPI chip |
| 封面反相主按钮 hover | **PASS** · `#142238` on `#fff`，Light/Dark 一致 |
| 独立链接目标 | **PASS** · 页脚、面包屑、来源、阅读全文、页脚 CTA 均补到 24px |
| 320/390 横向溢出 | **PASS** · 已测页面均无溢出 |
| 768px 平板头部 | **PASS** · 首页 849→768、登录页 964→768；导航收起为抽屉，wordmark 保留 |
| 981px 断点 | **PASS** · 桌面导航显示、抽屉按钮隐藏 |
| 视口矩阵 | **PASS** · 7 页 × 7 宽度 × Light/Dark = 98 组合，无溢出、唯一 h1、无脚本错误 |
| forced-colors | **PASS** · 390/1440 × 首页/研报/登录 = 6 组合，无溢出、唯一 h1 |
| 后台 390/768/1440 | **PASS** · 16 个 admin 页面无横向溢出、唯一 h1 |
| 后台 axe | **PASS** · 设计系统/行为/机器人/模型/社交/MCP/新闻 7 页，桌面 Light + 手机 Dark，0 violations |
| 200% 等效重排 | **PASS** · 640px 宽度纳入 98 组合矩阵 |
| 研报页 390px 标题 | **PASS** · 42.9px（修复被覆盖的移动端规则），两行显示无溢出 |
| 研报详情标题 | **PASS** · Source Serif 4 / 31px / 40.92 行高 / 900px 最大宽 |
| 组件收口 | **PASS** · `.minibtn` 6/12、6px 圆角、12.5px；`.chip` 2/7、4px 圆角；计算值与收口前一致 |
| 静态内联样式 | **PARTIAL** · 当前 130 个 `style={{` 对象；剩余多为动态值或一次性布局 |
| 角色 token 采用 | **PASS** · 119 处精确字号/圆角值改为 `--text-*`/`--radius-*`，计算值不变 |

截图基线在 `tmp/design-baseline/`（本地工作产物，未纳入版本库）。覆盖首页、研报、新闻、方法论、登录页的 Light/Dark 与窄屏。

## 5. P0 / P1 状态

| ID | 状态 | 证据 |
|---|---|---|
| P0-01 深色主按钮 | **FIXED** | 6.58:1 |
| P0-02 320px 登录页 | **FIXED** | 320/320，无溢出 |
| P1-01 辅助文字 | **FIXED** | Light 4.88、Dark 4.88（最严格面） |
| P1-02 输入焦点 | **FIXED** | 2px 实色环，offset 1px |
| P1-03 弹层焦点 | **FIXED** | Search/MobileNav 焦点闭环 |
| P1-04 首页 h1 | **FIXED** | 唯一 h1 |
| P1-05 主题持久化 | **FIXED** | 刷新保持 |
| P1-06 Light 状态色 | **FIXED** | warning 5.38、gold 5.87、positive 5.71 |
| P1-07 小目标 | **PARTIAL** | 独立控件已 24px；正文内联链接按 WCAG 2.5.8 例外保留 |
| P1-08 组件契约 | **PARTIAL** | 主按钮/chip/页面标题/文章标题/搜索触发器/输入焦点已收口；其余页面仍待迁移 |
| P1-09 768px 头部溢出 | **FIXED** | 980px 以下导航改抽屉；98 组合矩阵无溢出 |
| P1-10 后台窄屏溢出 | **FIXED** | 16 个 admin 页面 390/768/1440 无溢出；7 页 axe 0 violations |

## 6. 仍未完成（Phase C 余量 / Phase D）

- 其余 130 个 `style={{` 对象（多为动态值或一次性布局）与未映射字号/圆角的逐页迁移。
- Pa11y 未接入（axe-core 已接入）；截图回归尚未进入 CI。
- 640px（1280@200%）与 forced-colors 已自动检查；其他缩放基准仍需人工复核。

## 7. 部署状态与回滚

**已部署**。2026-10-18 在生产主机本地构建并发布：

- 发布 commit：`da6feb0`
- 运行镜像：`ghcr.io/muadibusul/tline:sha-da6feb0`
- `.deploy-tag`：`sha-da6feb0`
- 回滚镜像：`sha-33c21be`（保留在主机）
- 六容器 healthy；`/api/health` 返回 `200 {"status":"ok"}`
- 生产复测：320/390/768/981/1440 无横向溢出；首页唯一 h1；深色主按钮 `rgb(8,9,10)` on `rgb(124,138,255)`；主题刷新保持；首页/登录页 axe 0 violations。

回滚方式：

```bash
cd /home/deploy/tline
TAG=sha-33c21be docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
printf 'sha-33c21be' > .deploy-tag
```

- 无数据库迁移，无需回滚数据；
- 发布使用主机本地构建，未启用 GitHub Actions。
