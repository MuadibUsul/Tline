# SEO 安全型注册墙（P0/P1/P2）

## 决策

不做文章阅读墙。公开研究正文、结论、论点、数字、风险、证据、来源、内链、canonical、hreflang、robots、sitemap 和 `contentQuality` 保持不变。注册墙只包裹已有且确实需要账户存储的动作。

## 已实现

### P0/P1 · 点击专属功能后注册

统一组件：

- `src/app/_components/RegistrationGate.tsx`：桌面右侧 430px 抽屉，移动端底部弹层（最大 75vh）；Esc 关闭、焦点闭环、关闭恢复触发按钮、背景滚动锁定；只在用户主动点击后渲染。
- `src/app/_components/RegistrationActionButton.tsx`：包住资产/机构“关注”表单；未登录时打开抽屉，已登录时保持原来的 submit。
- `src/app/_components/RegistrationGateLink.tsx`：包住看板“登录/登录后使用”入口；未登录抽屉，已登录普通链接。
- `src/app/_components/BookmarkButton.tsx`：研报收藏未登录时打开抽屉，已登录仍是原来的 server action 表单。
- `src/lib/authReturn.ts`：`next` 只接受站内 rooted path，拒绝 `https://`、`//`、反斜杠、编码绕过、控制字符和超长值；signin 和 server actions 共用。

接入点：研报收藏、资产关注、机构关注、看板登录/模板入口。服务端 `addWatch`、`toggleBookmarkAction` 等原有权限校验未改。

### P2 · 非阻断提示

- `src/app/_components/InlineRegistrationCTA.tsx`：同一会话读过至少 2 篇研报、滚动 60% 后，在 citation card 之后插入一张普通卡片；同一会话最多一次，可关闭，不遮挡正文。
- 默认关闭。开启步骤：
  - `REG_NUDGE_ENABLED="true"`；
  - `REG_NUDGE_ROLLOUT` 控制会话百分比（默认 `10`，可逐步调到 50/100）。
- 关闭后组件直接返回 `null`，不增加 DOM。

### 开关

- `REG_GATE_ENABLED`：默认开启；设为 `false` 时收藏/关注/看板恢复原来的 sign-in 链接或服务端跳转。
- `REG_NUDGE_ENABLED`：默认关闭。
- `REG_NUDGE_ROLLOUT`：默认 `10`，仅在 nudge 开启时生效。

## SEO 保护

- 注册组件只作为少量 client components 附着在已 SSR 的公开页面；没有把研究页改成 client-only。
- 未登录 HTML 仍包含 H1、核心结论、关键论点、数字、风险、证据和来源链接。
- 不按 UA 给 Googlebot 特供正文；没有自动弹窗、滚动锁或正文模糊。
- `/signin`、`/account`、`/watchlist` 继续 `noindex`，未加入 sitemap。
- 无 JS 时：收藏/关注触发器保留原 sign-in 链接或表单提交；正文完整可读。
- 不改变 `contentQuality`、`publicationReadyWhere`、canonical/hreflang 或公开 URL。

## 验证

已执行（本地生产构建）：

- 匿名研报页：1 个 H1、核心结论在 SSR、来源链接在、初始无 gate panel。
- 点击收藏：抽屉标题“把这份研究保存下来”；`next` 编码为当前 `/zh/research/...`；正文仍在 DOM；Esc 关闭并回到触发按钮；body overflow 恢复。
- 资产/机构“关注”：打开“关注它，持续看后续观点”抽屉。
- 看板“登录”：打开“创建你的研究工作台”抽屉。
- 已登录：研报页仍显示收藏表单，不显示 gate。
- 无 JS：收藏链接直接去 `/zh/signin?next=...`，正文完整。
- `REG_GATE_ENABLED=false`：恢复普通 sign-in 链接，无 nudge。
- nudge 开启后：两篇研报 + 60% 滚动出现内嵌卡片；关闭后 session 不再出现。
- 移动端 390px：底部弹层宽 390、无横向溢出；桌面 1440px：右侧 430px 抽屉。

基线（改动前，生产）：

```text
npm run seo:baseline -- --base=https://tlines.tech --sample=30
Failures: 0
Warnings: 2（PDF 预览与完整英文源文的手工复核；无 Cloudflare 头）
Sitemap shards: 12
Sitemap URLs: 4381（2191 English / 2190 Chinese）
```

## 未实现

- P3 高级能力（高级比较、历史变化、笔记）没有新空壳 CTA；只接已有收藏/关注/看板入口。
- `signup_start`/`auth_return_success`/`first_value_action` 尚未逐事件接入；当前有 `gate_view`、`gate_dismiss`、`gate_cta_click`、`gate_eligible`。后续接入时应继续避免 PII 和未同意的追踪。
- 10% A/B 的统计显著性评估需要生产流量；当前只实现会话 bucket 和开关。

## 发布记录

- 2026-10-19：注册墙与语言一致性修复发布，commit `8602a49`，镜像 `sha-8602a49`。
- 6 容器 healthy，`/api/health` 200。
- 生产 SEO baseline（sample 30）：0 failures、2 known warnings、12 sitemap shards、4389 URLs。
- `npm test`：696 项通过。
- 回滚镜像：`sha-c92dd31`、`sha-76d1093`。
