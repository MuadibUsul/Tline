# 语言一致性与导航修复

## 1. 语言切换跳到旧页面

### 现象

点击顶部语言按钮跳到 `/zh/watchlist`，而不是当前页面。

### 根因

`src/app/layout.tsx` 的根布局在客户端导航时不会重新渲染。语言按钮原先由服务端从 `x-pathname` 计算 `href`，所以它保留的是**首次进入页面**的路径。实测：

```text
/zh         → 点“最新研究” → URL /zh/research，但语言 href 仍是 /en
/zh/watchlist → 导航到 /zh/research → 语言 href 仍是 /en/watchlist
```

直接打开每个页面时 href 正确，所以之前的逐页检查没有暴露它。

### 修复

- 新增 `src/app/_components/LanguageSwitch.tsx`：客户端 `usePathname()` 读取当前路径。
- 新增 `src/lib/languageSwitch.ts`：纯函数把 `/zh/...` 映射到 `/en/...`，反向同理；`/admin` 返回 null。
- 保持普通 `<a>`，跨语言仍做完整文档加载，不把两种语言混在同一个布局里。
- `languageSwitch.test.ts` 覆盖根页、列表、详情、反向和 admin。

### 线上验证

```text
/zh/watchlist → 点“最新研究” → /zh/research
语言按钮 href → /en/research
点击语言按钮 → /en/research
```

## 2. 中文首页出现英文观察

### 现象

`/zh` 的“今日机构观察”出现：

- “The deal is expected to close in 2028.”
- “Recent inflation data has been uncomfortably strong…”

### 根因

两层回退：

1. `selectDiverseObservations` 在中文页使用 `viewZh || viewEn`；
2. 即使改成只读 `viewZh` 也不够：部分行的 `viewZh` 字段里存的就是英文原文，字段名不能证明语言。

### 修复

- 观察选择器在中文页只接受 `viewZh`，英文页只接受 `viewEn`；缺失即跳过，由下一家合格机构补位。
- 增加文字脚本检查：中文文本要求 Han 字符占字母比例 ≥20%；英文页拒绝这样的中文文本。
- 测试覆盖：
  - 中文页拒绝英文-only 行；
  - 英文页拒绝中文-only 行；
  - `viewZh` 存英文时仍被拒绝；
  - 原有 fragment/一家一条/广度逻辑保持。

### 线上验证

`/zh` 当前 5 条机构观察均含中文；英文-only 行和 `EN` fallback 标签消失。`/en` 仍只显示英文。

## 发布

- 最终 commit：`8602a49`
- 运行镜像：`ghcr.io/muadibusul/tline:sha-8602a49`
- `.deploy-tag`：`sha-8602a49`
- 6 容器 healthy；`/api/health` 200
- 回滚镜像：`sha-c92dd31`、`sha-76d1093`
- `npm test`：696 项通过
- 生产 SEO baseline（sample 30）：0 failures、2 known warnings、12 sitemap shards、4389 URLs

## 边界

- 语言切换仍会丢失 query string（与旧行为一致）；本次只修复 stale pathname。
- 首页观察若某家机构只有错误语言的文本，会被跳过；这是有意行为，不再用英文填充中文页。
