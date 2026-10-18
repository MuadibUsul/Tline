# Tlines Token 契约

实现位置：`src/app/globals.css` 顶部 token block。

## 三层结构

```text
Primitive → Semantic → Component → Legacy alias
```

- **Primitive**：品牌色阶与基础量，不表达用途。
- **Semantic**：按职责命名，例如 `surface-page`、`text-tertiary`、`border-control`。
- **Component**：组件专用别名，例如 `button-primary-fg`。
- **Legacy alias**：现有组件使用的 `--bg`、`--panel`、`--ink` 等，全部继续可用。

迁移期间，页面可以继续使用旧变量；新代码必须使用 semantic/component token。

## 颜色 token

### Primitive

| 组 | Token | Light | Dark |
|---|---|---|---|
| Neutral | `--neutral-0` | `#fff` | `--neutral-dark-0` `#0f1011` |
| Neutral | `--neutral-1` | `#f7f8f8` | `--neutral-dark-1` `#08090a` |
| Neutral | `--neutral-2` | `#f1f2f4` | `--neutral-dark-2` `#141516` |
| Neutral | `--neutral-3` | `#e8eaee` | `--neutral-dark-3` `#1b1c1e` |
| Neutral | `--neutral-4` | `#d0d4da` | `--neutral-dark-4` `#2e3035` |
| Neutral | `--neutral-5` | `#828891` | `--neutral-dark-5` `#62666d` |
| Neutral | `--neutral-6` | `#636a74` | `--neutral-dark-6` `#858c96` |
| Neutral | `--neutral-7` | `#5f6670` | `--neutral-dark-7` `#8a8f98` |
| Neutral | `--neutral-8` | `#3c4149` | `--neutral-dark-8` `#d0d6e0` |
| Neutral | `--neutral-9` | `#08090a` | `--neutral-dark-9` `#f7f8f8` |
| Indigo | `--indigo-2` | `#eef0ff` | `--indigo-dark-2` `#1a1d33` |
| Indigo | `--indigo-9` | `#5e6ad2` | `--indigo-dark-9` `#7c8aff` |
| Indigo | `--indigo-10` | `#4f5bc8` | `--indigo-dark-10` `#a4aeff` |

状态色：

| 用途 | Light | Dark |
|---|---|---|
| 正向 `status-positive` | `#146c4c` on `#e8f5ef` | `#4cc38a` on `#10231a` |
| 负向 `status-negative` | `#c43c3c` on `#fdecec` | `#f07171` on `#2a1414` |
| 警示 `status-warning` | `#8a5a12` on `#fdf3e3` | `#e2b86a` on `#292215` |
| 金色强调 `status-gold` | `#80530f` on `#fbf0d9` | `#e8bd72` on `#2b2316` |

### Semantic

| Token | Light 取值 | Dark 取值 | 用途 |
|---|---|---|---|
| `--surface-canvas` | neutral-1 | neutral-dark-1 | 页面底 |
| `--surface-page` | neutral-0 | neutral-dark-0 | 主面板 |
| `--surface-subtle` | neutral-2 | neutral-dark-2 | 次级面 |
| `--surface-sunken` | neutral-3 | neutral-dark-3 | 下沉面 |
| `--surface-selected` | indigo-2 | indigo-dark-2 | 选中/强调底 |
| `--text-primary` | neutral-9 | neutral-dark-9 | 主文本 |
| `--text-secondary` | neutral-8 | neutral-dark-8 | 正文 |
| `--text-muted` | neutral-7 | neutral-dark-7 | 次级辅助 |
| `--text-tertiary` | neutral-6 | neutral-dark-6 | 最小号辅助 |
| `--border-subtle` | neutral-10 | neutral-dark-10 | 装饰分隔 |
| `--border-emphasis` | neutral-4 | neutral-dark-4 | 强调边线 |
| `--border-control` | neutral-5 | neutral-dark-5 | 输入/控件边界 |
| `--action-primary-bg` | indigo-9 | indigo-dark-9 | 主按钮底 |
| `--action-primary-bg-hover` | indigo-10 | indigo-dark-10 | 主按钮 hover |
| `--action-primary-fg` | `#fff` | `#08090a` | 主按钮文字 |
| `--focus-ring` | indigo-9 | indigo-dark-10 | 键盘焦点环 |

### Component

```css
--button-primary-bg
--button-primary-bg-hover
--button-primary-fg
--input-border
```

### Legacy alias

`--paper`、`--bg`、`--panel`、`--panel-2`、`--panel-3`、`--ink`、`--ink-2`、`--muted`、`--faint`、`--border`、`--border-strong`、`--line`、`--accent`、`--accent-ink`、`--accent-wash`、`--signal`、`--signal-wash`、`--bull`、`--bull-wash`、`--bear`、`--bear-wash`、`--neu`、`--neu-wash`、`--warn`、`--warn-wash`、`--accent-gold`、`--accent-gold-wash`、`--shadow`、`--shadow-lift`。

这些变量是兼容层，不是新代码的推荐入口。

## 字号角色

| Token | 建议值 | 用途 |
|---|---|---|
| `--text-display` | `clamp(42px,5.8vw,68px)` | 品牌/封面 |
| `--text-h1` | `clamp(36px,5vw,54px)` | 页面主标题 |
| `--text-h2` | 28px | 区块标题 |
| `--text-h3` | 20px | 子区标题 |
| `--text-body` | 15px | 正文 |
| `--text-body-sm` | 13px | 信息流/表格 |
| `--text-meta` | 11px | 来源、日期、标签 |
| `--text-micro` | 10px | 非必读辅助 |

迁移期间旧规则仍保留自己的字号；新规则按角色取值。本轮已将 119 处精确匹配的字号/圆角声明替换为角色 token（102 处 globals、17 处 admin），其余非角色值继续逐页迁移。

## 间距 / 圆角 / 动效

- 间距：`--space-1` 4、`--space-2` 8、`--space-3` 12、`--space-4` 16、`--space-5` 20、`--space-6` 24、`--space-8` 32、`--space-10` 40、`--space-12` 48、`--space-16` 64。
- 圆角：`--radius-control` 6、`--radius-chip` 4、`--radius-card` 10、`--radius-dialog` 12、`--radius-pill` 999。
- 动效：`--motion-fast` 120ms、`--motion-normal` 180ms、`--motion-slow` 280ms；全部受 `prefers-reduced-motion` 约束。

## 对比度校验

`src/lib/designTokens.test.ts` 固定检查：

- 主按钮 Light / Dark ≥ 4.5:1；
- `text-tertiary` 在页面/次级面 ≥ 4.5:1；
- status 文字在其 wash 上 ≥ 4.5:1；
- `border-control` 与页面/面板 ≥ 3:1；
- 焦点环为实色 `var(--focus-ring)`，不是透明色。

新增 token 时必须同时更新测试。
