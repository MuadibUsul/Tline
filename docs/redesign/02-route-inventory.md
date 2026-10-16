# 02 · 实际页面与路由清单

> 来源：`find src/app -name page.tsx/route.ts`（2026-10-16, `main@38a3019`）。
> 索引策略列已逐一核对代码；sitemap 列以线上 `sitemap.xml` 10 分片实测为准。

## 1. 页面（43 个）

| 路由 | 访问控制 | 索引策略 | sitemap | 说明 |
|---|---|---|---|---|
| `/` | 公开 | index | pages 分片 p1.0 | 编辑首页（现 hero 版） |
| `/[policy]`（8 个政策页） | 公开 | index | pages 分片 p0.4-0.6 | about/methodology/editorial-policy/ai-usage/sources/privacy/corrections/financial-disclaimer |
| `/research` | 公开 | index（筛选参数 noindex） | pages 分片 p0.9 | 研报流；应用层全表分页（见 01 §5） |
| `/research/[id]` | 公开 | **闸门实时判定**；仅通过语言输出 hreflang | research 分片 | 研报详情（id 或 slug；id→slug 308） |
| `/institutions` | 公开 | index；空分页 noindex | pages 分片 p0.8 | **观点流**（7 天滚动窗口排名，非机构目录） |
| `/institution/[slug]` | 公开 | 无该语言可索引研报时 noindex | institutions 分片 | 机构档案（内容机构与发布机构两类） |
| `/institution/[slug]/accuracy` | 公开 | 同上 | institutions 分片（同上） | 机构准确度页 |
| `/markets` | 公开 | index | pages 分片 p0.8 | 资产目录（18 资产/45 机构，口径见 03 §4） |
| `/markets/[ticker]` | 公开 | index | assets 分片 | 资产共识页 |
| `/asset/[ticker]` | 公开 | 308 → `/markets/{canonical}` | 否 | 历史地址兼容 |
| `/macro` | 公开 | index | pages 分片 p0.8 | 宏观总览 |
| `/macro/calendar` | 公开 | index | pages 分片 p0.6 | 经济日历 |
| `/macro/indicator/[key]` | 公开 | index | pages 分片（30 个指标） | 指标页（单位/期次风险见 03 §4） |
| `/macro/release/[id]` | 公开 | index | 否 | 发布详情（仅从日历/首页内链） |
| `/topics` | 公开 | index | topics 分片 | 主题索引（en 58 / zh 40，语言闸门差异正常） |
| `/topics/[topic]` | 公开 | 语言闸门判定 | topics 分片 | 主题落地页 |
| `/economies` | 公开 | index | pages 分片 p0.7 | 经济体枢纽 |
| `/economies/[economy]` | 公开 | index | pages 分片（14 个） | 经济体详情 |
| `/market-themes` | 公开 | 无主线时 noindex | pages 分片（条件收录） | 交易主线公开摘要 |
| `/watchlist` | **登录** | noindex；middleware 反缓存 | 否 | 交易主线台账（门内完整版） |
| `/dashboards` | 公开（个人区登录） | noindex | 否 | 看板入口 |
| `/dashboards/[id]` | 本人 | noindex | 否 | 画布 |
| `/dashboards/explore` | 公开 | noindex | 否 | 模板广场 |
| `/topics` 同级的 `/search` | — | **不存在独立页** | — | 搜索走 `/api/search` + 首页/弹层 |
| `/alerts` | 公开路由 | 301/redirect → `/watchlist` | 否 | `src/app/alerts/page.tsx:6` |
| `/signin` | 公开 | noindex | 否 | |
| `/account/password` | 登录 | noindex | 否 | 未设密码账户强制跳转 |
| `/admin` + 15 个子页 | admin.access 起 | noindex（layout 级） | 否 | 含 `/admin/mcp`（2026-10-16 新增） |
| `/admin/api-keys` | admin.api | — | — | **历史地址 308 → `/admin/api`**（`src/app/admin/api-keys/page.tsx:8`） |

## 2. Route handler（20 个）

| 路由 | 性质 | 说明 |
|---|---|---|
| `/api/v1/research`、`/api/v1/research/[id]`、`/api/v1/institutions` | 公开 API | API Key（`research:read`），游标分页，`serializeResearch` 公开形状 |
| `/api/mcp/user`、`/api/mcp/publisher` | MCP | 无状态 Streamable HTTP；noindex/no-store；2026-10-16 上线 |
| `/rss.xml`、`/feed.xml` | Feed | feed.xml = rss.xml 的 re-export（同一内容双地址，低危重复） |
| `/llms.txt`、`/llms-full.txt` | AEO | llms-full 仅英文前 500 |
| `/sitemap.xml`、`/sitemap/[shard]` | Sitemap | index + 10 命名分片 |
| `/api/documents/[id]` | 受控下载 | 签名 URL；noindex 自行设置 |
| `/api/figures/[id]` | 公开图表 | 允许索引（与网站意图一致） |
| `/api/og` | 公开 OG 图 | 允许索引；每请求渲染 |
| `/api/search`、`/api/feed/pulse`、`/api/health`、`/api/analytics`、`/api/auth/*`、`/api/social/*` | 机器端点 | robots.txt 逐条 Disallow + 响应头 noindex |

## 3. 重定向清单（重构不得破坏）

1. **语言前缀**：无前缀公开页 308 → 规范语言前缀（`src/middleware.ts`）。
2. **legacy topic/asset**：退役主题与别名 308 到替代（`legacyTopicRedirectPath`、`assetPath`）。
3. **研报 id→slug**：308 单跳（`researchRedirectPath`）。
4. **历史分片地址**：数字分片名 308 → 命名分片（2026-10-09）。
5. `/admin/api-keys` → `/admin/api`；`/alerts` → `/watchlist`。

## 4. 导航现状 vs PRD 目标 IA（差异表）

现状一级导航（`src/app/layout.tsx:60-68`）：首页 / 资产 / 经济数据 / 经济体 / 观点 / 研报 / 交易主线 / 看板。

| PRD §3.1 目标 | 现状映射 | 差距 |
|---|---|---|
| 首页 | `/` | 版式重做（P01） |
| 最新研究 | `/research`（已存在） | 加编辑精选模式与筛选（P02） |
| 主题 | `/topics`（已存在，目标页在 PRD 树中同名） | 复用路由即可 |
| 机构 | `/institution/[slug]` + `/institutions`（观点流） | **语义冲突**：PRD 要求机构目录语义不与 `/institutions` 冲突，建议新路径（PRD 树写 `institutions-directory`）并保留旧 URL |
| 数据与图表 | `/macro`、`/macro/calendar`、`/economies` | 图表故事组件（P06） |
| 关于 | `/[policy]` 八页 | 信任中心聚合（P09） |
| （无） | 交易主线 `/market-themes`、看板 `/dashboards` | PRD 判为二级入口，保留功能 |
| 订阅 | **不存在** | 全新增量（P08） |
| 搜索 | `/api/search`（无独立结果页） | 独立 `/search` 或 SearchOverlay（P07） |
| 深度专题 `/features` | **不存在** | 全新增量（P04 变体） |

> ⚠️ 与站主 2026-10-16 早前指令（观点下架、看板+交易主线+经济体合并）存在方向冲突——见 README 开放问题 1，执行前必须裁决。
