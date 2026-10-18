# Tlines 组件契约

本文只定义现有组件应有的状态和 token 关系，不新增视觉框架。所有 class 名称继续可用。

## Button

### `.minibtn`

次级操作。

| 状态 | 规则 |
|---|---|
| default | 透明/面板底，1px 边线，`--text-primary` 或 `--text-muted` |
| hover | 边线转 `--border-emphasis`，文字转 `--text-primary` |
| focus | 2px `--focus-ring`，offset 2px |
| active | `transform: scale(.97)`，受 reduced-motion 约束 |
| disabled | 透明度 .55，`cursor:not-allowed` |

### `.minibtn.p`

主操作。

| 状态 | 规则 |
|---|---|
| default | `--button-primary-bg` + `--button-primary-fg` |
| hover | `--button-primary-bg-hover` + 同一前景 token |
| focus | 2px `--focus-ring` |
| disabled | 与 `.minibtn` 相同 |

深色主题下前景是 `#08090a`，不是白色；浅色主题是白色。不要在任何新主按钮上写 `color:#fff`。

**已知变体**：`.ed-feature .minibtn.p` 是深色封面上的反相按钮（奶油底/深字），保留其局部规则，不套用普通主按钮前景。

## Chip

`.chip` 是状态标签，不是主按钮。

- `chip acc`：编辑强调；
- `chip bull` / `chip bear` / `chip neu`：方向/状态；
- `chip gray`：中性元数据；
- 当 chip 本身是链接（`a.chip`）时，最小高度 24px；
- 状态文字必须与 wash 达到 4.5:1；状态不能只靠颜色表达。

## Input / Select / Textarea

- 边界：`--border-control`，与页面/面板至少 3:1；
- 圆角：`--radius-control`（6px）；
- 最小高度 40px；
- focus：2px 实色 `--focus-ring`，offset 1px；
- placeholder 使用 `--text-tertiary`，不能承载唯一说明；
- 标签用包裹式 `<label>` 或显式 `aria-label`，不能只靠 placeholder。

## Card

`.card`、`.research-card`、`.ctile`、`.citation-card`、`.front-band>.blk` 共用：

- 表面：`--surface-page`；
- 边线：`--border-subtle`（装饰性）；
- 圆角：`--radius-card`（10px）；
- 阴影：`--shadow-raised`；
- 不在卡片内部再套一层同色卡片制造层级。

## Dialog

适用：`SearchOverlay`、`MobileNav`。

- `role="dialog"` + `aria-modal="true"` + 可读名称；
- 打开后焦点进入对话框；
- Tab / Shift+Tab 焦点闭环（`src/app/_components/focusTrap.ts`）；
- Escape 关闭并把焦点还给触发按钮；
- 背景滚动锁定；
- 关闭后不得把焦点留在已卸载节点上。

## Table

- 表头使用 `--surface-subtle`，字号 `--text-meta`；
- 数字列使用 `.tnum` / mono；
- 行分隔线 `--border-subtle`，不依赖斑马纹；
- 横向滚动容器必须有可聚焦入口或可读的滚动提示；不要隐藏滚动条作为默认。

## Navigation

- 顶部导航链接最小高度 34px；移动抽屉链接 44px；
- 当前页用 `aria-current="page"`；
- 移动抽屉是 980px 以下的主要入口，不能隐藏；720px 以下使用更紧凑的头部；
- 页脚链接最小高度 24px；
- 语言切换保留完整文档加载，避免导航 chrome 与内容语言不一致。

## Empty / Skeleton / Error

- `.empty-state`：说明为什么为空，以及下一步可做什么；
- `.skeleton`：只占位，不假装内容；受 reduced-motion 约束；
- `global-error`：独立的错误边界，按系统 Light/Dark 渲染，提供重新加载。

## 静态布局工具类

这些类替代了关键页面上的静态内联样式：

- `.signin-page`、`.signin-head`、`.signin-sub`、`.signin-error`、`.signin-provider`、`.signin-demo`、`.signin-demo-submit`、`.signin-demo-alt`
- `.newsletter-column-intro`、`.newsletter-row`、`.newsletter-copy`、`.newsletter-form`、`.newsletter-fine`
- `.search-hint`
- `.section-t.newsroom-head`
- `.empty-copy`
- `.measure`（72ch 阅读行长）
- `.self-start`
- `.text-muted` / `.text-tertiary` / `.text-primary`
- `.meta-tertiary` / `.meta-muted`（11px 元数据）
- `.nowrap-muted`
- `.text-micro`
- `.mt-0/8/10/12/14/16/18/26`、`.mb-6/8/10/12/14/22`、`.m-0`
- `.list-tight`、`.block-tertiary`、`.stack-12`、`.section-row`

它们只承载布局和颜色角色；动态值（宽度、进度、用户数据）仍可使用内联样式。

## 迁移规则

1. 先加 token 别名，不直接删旧变量。
2. 一次只迁移一组组件，保留截图基线。
3. 发现重复覆盖时先列冲突，再收口；不要用 `!important` 掩盖顺序问题。
4. 任何组件改动都要在 Light/Dark × 390/1440 下检查，320px 适用于窄屏页面。
