# Tlines 可访问性基线

目标：WCAG 2.2 AA。以下规则与实现、测试对应，不是愿望清单。

## 对比度

- 普通文本 ≥ 4.5:1；大文本 ≥ 3:1。
- 控件边界（输入框、选择器、文本域）≥ 3:1。
- 焦点指示 ≥ 3:1，且不能只靠半透明阴影。
- 状态文字在其 wash 背景上 ≥ 4.5:1。

当前实测：

| 配对 | 结果 |
|---|---|
| Light 主按钮 `#fff` / `#5e6ad2` | 4.70:1 |
| Dark 主按钮 `#08090a` / `#7c8aff` | 6.58:1 |
| Light tertiary `#636a74` / `#f1f2f4` | 4.88:1 |
| Dark tertiary `#858c96` / `#1a1d33` | 4.88:1 |
| Light control border `#828891` / `#fff` | 3.57:1 |
| Dark control border `#62666d` / `#0f1011` | 3.30:1 |
| Light warning `#8a5a12` / `#fdf3e3` | 5.38:1 |
| Light gold `#80530f` / `#fbf0d9` | 5.87:1 |
| Light positive `#146c4c` / `#e8f5ef` | 5.71:1 |

## 键盘

- 所有交互元素可 Tab 到达。
- 焦点环为 2px 实色 `--focus-ring`，offset 1–2px。
- Search / MobileNav 焦点闭环；Escape 关闭并归还触发按钮。
- 不允许 `outline:0` 且没有替代焦点指示。
- 跳转链接、分页、筛选器保持原生语义。

## 重排与目标

- 320px 宽度无横向滚动；320 / 390 / 768 / 1280 / 1440 均需检查。
- 独立交互目标最小 24×24px；移动端主操作 44px。审计仍报告 34 条小于 24px 的交互目标，主要是正文/元数据内联链接，适用 WCAG 2.5.8 inline 例外。
- 正文内联链接适用 WCAG 2.5.8 的 inline 例外，但也应保留足够行距。

当前已修复：登录页 320px 头部溢出、768px 平板头部溢出、独立按钮/页脚链接/面包屑/阅读全文/来源链接的 24px 目标。

## 主题与偏好

- 主题在首屏前从 `localStorage` 恢复，避免刷新后跳回系统主题。
- `color-scheme` 跟随主题，原生控件不会在深色页面上出现白色下拉面板。
- 主题切换按钮暴露 `aria-pressed`。
- `prefers-reduced-motion: reduce` 时关闭平滑滚动、进度动画和压感位移。

## 语义与内容

- 每个公开页面有且只有一个 `h1`；首页设计版的主标题是“此刻值得关注”。
- 标题层级连续，不用字号代替语义。
- 图片有 alt；纯装饰图形 `aria-hidden="true"`。
- 状态不只用颜色；错误信息有文本，不用颜色单独表达。
- 表单错误与提示使用可读文本，不用 placeholder 代替 label。

## 验收证据

已执行：

- `npm test`（685 项，含 6 项设计 token/内联预算测试）
- `npm run typecheck`
- `npm run lint`
- `TL_REDESIGN=all TLINE_DIST_DIR=.next-verify npm run build`
- `DESIGN_AUDIT_BASE=http://127.0.0.1:3100 npm run design:audit`：0 failures、0 axe violations；检查 `html lang`、标题、唯一 `main`、图片 `alt`、可访问名称、焦点环、主题、98 个视口/主题组合、6 个 forced-colors 组合，以及 axe WCAG A/AA（桌面 Light + 手机 Dark）。设置 `ADMIN_COOKIE` 后同一命令还会检查 16 个后台页面 × 3 个宽度和 7 个后台代表页 axe。
- 浏览器实测：320/390/640/768/981/1280/1440，Light/Dark；7 个页面 × 7 个宽度 × 2 主题 = 98 组合；搜索与移动端焦点闭环；主题刷新；输入框焦点环。
- forced-colors：390/1440 × 首页/研报/登录 = 6 组合通过。
- 640px 等效 1280px @ 200% 缩放重排通过。
- 后台：16 个 admin 页面在 390/768/1440 无横向溢出；7 个代表页 axe WCAG A/AA 为 0 violations。

未自动化的部分：

- Pa11y 未接入（axe-core 已接入 `design:audit`）；
- 截图视觉回归仍以本地基线为准，未进入 CI；
- 其他浏览器缩放基准（例如 390px 手机下的 200%）仍需人工复核。

这些是 Phase D 的剩余工作，不应被描述为已通过。
