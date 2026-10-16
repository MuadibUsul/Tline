# 04 · CSS 与组件复用分析

> 目标：对照 PRD §6（设计系统）与设计稿（编辑式排版 / 衬线标题 / 专业图表 / 移动端），盘点现有资产的可复用度。
> 结论先行：**不需要重写 CSS 体系，需要"重定 token + 新增组件层"**。

## 1. 现有样式体系

| 资产 | 规模 | 性质 |
|---|---|---|
| `src/app/globals.css` | 1,305 行 | 全站唯一公开样式表；CSS 变量双主题（`:root` 亮 + `[data-theme=dark]`/`prefers-color-scheme` 暗） |
| `src/app/admin/admin.css` | 516 行 | 运营后台专用，独立于公开站 |
| 组件内联样式 | 少量 | 页面以语义 class + 少量 `style={{}}` 为主 |

**现有 token（`globals.css:4-38`）**：`--paper --bg --panel --panel-2 --panel-3 --ink --ink-2 --muted --faint --border --border-strong --accent --accent-ink --accent-wash --bull/-wash --bear/-wash --neu/-wash --shadow --sans --mono --serif`。

**与 PRD §6.1 目标 token 的映射**：

| PRD token | 现值（亮色） | 迁移动作 |
|---|---|---|
| `--bg` `#F7F6F2`（纸张感） | `--bg:#f7f8fa`（冷灰） | 改色值即可（暖纸色），变量名不变 |
| `--surface` | `--panel:#fff` | 值保留，可加别名 |
| `--ink` `#17202B` | `--ink:#14161b` | 微调 |
| `--brand` `#2458A6` | `--accent:#2f55d4` | 微调（更沉稳的蓝） |
| `--hairline` | `--border` | 已有 |
| `--positive/negative/warning` | `--bull/--bear`（+缺 warning） | 加 `--warn`；PRD 要求涨跌不单靠颜色靠文字标记（现 `.chip.bull` 已有文字） |

**字体现状（`globals.css:12-14`）**：`--serif` 仅 Georgia/Songti SC（基本未用于标题）、`--sans` 系统无衬线栈、`--mono` 用于全部元信息（导航/日期/数字）。
**与 PRD §6.2 差距**：① 缺"中文衬线标题"环（设计稿用 Source Serif 4，SIL OFL 可自托管）；② 正文尺寸偏小（当前全局 ~13-14px，PRD 正文要求 16-18px / 行高 1.7-1.85，主要影响 `.article-body` 等长文类）；③ 数字等宽特性已有基础（`--mono` 广泛使用），需统一到 `font-variant-numeric: tabular-nums`。

## 2. 可复用的结构类（选摘，全部已存在）

`.wrap`（版心）、`.topbar/.brand/.nav`（页眉）、`.page-head/.eyebrow`（页头）、`.fcard/.ctile`（研究卡）、`.chip`（含 `.acc/.gray/.bull/.bear`）、`.minibtn`、`.tbl-wrap/.table`、`.rowlist`、`.tags/.tag-row`、`.pagination`、`.empty-state`、`.article-body/.article-section/.article-figure/.article-table`（**文章正文排版已有基础**）、`.atomic-view`（观点块+`<details>` 证据）、`.ai-analysis-label`（AI 标识**已存在**，PRD 强制要求项之一）、`.macro-*`、`.barlist/.chart-*`（图表体系）。

## 3. 组件复用表（PRD §6.3 的 22 项）

| PRD 组件 | 现状 | 判定 |
|---|---|---|
| SiteHeader | `layout.tsx` topbar + `.topbar` | **复用改版**（加"收起/回顶"行为见 PRD §7） |
| MobileNavigation | `_components/MobileNav.tsx`（完整：Esc/焦点/滚动锁） | **直接复用** |
| LanguageSwitcher | layout `languageSwitch`（设计上用整页加载，注释有因） | **保留机制**，仅视觉 |
| ThemeSwitcher | `_components/ThemeToggle.tsx` | **直接复用** |
| ResearchListItem | `_components/ui.tsx` FeedCard/ResearchCard（`.fcard`） | **改造**（补"编辑精选/机构新发布"标记、更新日期、≤3 标签） |
| TopicChip | `.chip` | **轻封装** |
| InstitutionByline | `.fcard .top` 内嵌 | **抽组件** |
| DataFigure | `_components/charts.tsx`（TimeSeries/BarList/StatCard）+ `.article-figure` | **复用+封装**（补截止期/来源/单位标注） |
| SearchOverlay | `_components/SearchBox.tsx`（页内下拉） | **扩建**（⌘K 弹层 + 键盘导航；`/api/search` 已有） |
| FilterBar | `/research` 的 `.research-filters`（Server 表单） | **复用改版**（PRD 要求可复制 URL/重置） |
| EmptyState | `.empty-state` | **复用** |
| EditorialHero | 无 | **新增**（PRD P01 编辑封面；与站主"去 hero"意见的关系见 02 §4 备注——PRD 的封面是编辑式头条，非营销大卡） |
| FeatureStoryCard / KeyTakeaways / EvidenceReference / ReadingProgress / SourceBadge(+已有 chip 基础) / CorrectionBanner / QuoteBlock / NewsletterCTA / Skeleton / ErrorState | 无（QuoteBlock 有 `blockquote` 样式基础） | **新增**，建议集中在 `src/app/_components/editorial/` 新目录 |

## 4. 复用注意事项

- `.article-body` 已有分段/图/表排版——P03 改造是**在既有结构上加阅读层**（阅读进度、证据引用、目录），不是重写正文渲染。
- 全站 `--mono` 承担元信息气质；设计稿保留此特征（数据表格/出处等宽）。**不要把 mono 大面积换成 sans**。
- 移动端：`MobileNav` 与既有响应式断点（`globals.css` 内多处 `@media`）是资产；PRD §6.2 的断点（768/1200）与现状接近，校准即可。
- 严禁：为重构引入新 CSS 框架（Tailwind 等）与大体积网络字库（PRD §6.2 同款约束）。
