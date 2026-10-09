# Tlines SEO 恢复：已确认技术修复

日期：2026-10-09

阶段边界：仅代码、自动测试和本地生产构建；未发布生产、未修改生产数据库、未调整研报质量门控。

## 结果摘要

本阶段修复了审计已经复现的 URL 规范化、空分页和非 HTML 接口索引边界问题，并把 Sitemap 从“页面混合分片 + 双语研报混合分片”改为按内容类型、语言和研报容量拆分。研报已有的不可变 slug 设计被保留，没有新增数据库表或 URL 迁移。

未改动以下尚未证实的问题：研报质量门控阈值、PDF 页面内容策略、生产 worker `degraded` 原因、Cloudflare 配置和生产缓存头。这些仍需对应证据或生产权限。

## A. URL、Canonical 与 hreflang

### 研报规范 URL 契约

- 规范地址继续使用 `/en/research/{stored-slug}` 和 `/zh/research/{stored-slug}`。
- slug 只在首次入库时由机构、原始标题和 URL 指纹生成并存入 `Article.slug`；标题修复、翻译和重新分析不会重算 slug，因此标题变化不会改变公开 URL。
- `researchLookupWhere()` 统一用数据库 ID 或存量 slug 查找研报。
- `researchRedirectPath()` 只对历史 ID 地址返回最终 slug 地址；访问最终 slug 时不重定向，避免循环。
- 详情页 Metadata、正文重定向、站内卡片、RSS、搜索和 Sitemap 均继续使用共享的 `researchPath()`。
- 现有 slug 本身就是从首次公开起保留的旧 slug；仓库中没有更新 `Article.slug` 的写路径，因此不需要新增 alias 表或迁移。

### 资产 URL

- `/en/markets/SPX`、`/en/markets/spx` 等能够解析但不规范的地址现在 308 到 `/en/markets/sp-500`。
- `/en/markets/sp-500` 本身不重定向。
- 中英文均使用同一资产路径规则，并保留原有 `/asset/*` 和旧专题映射的一跳 308。

### 空分页

- `/en|zh/institutions?page=N` 在超出实际页数时返回 404。
- Metadata 在渲染前也把空页标为 `noindex, follow`，作为防御性保护。
- 合法分页的自引用 Canonical 和前后页链接不变。

### hreflang

- 普通双语页面继续输出 `en`、`zh-CN` 和英语 `x-default`。
- 研报页和研报 Sitemap 只输出通过该语言质量门控、确实存在的语言版本。
- 自动测试覆盖双向英文/中文关联、英文单语页面不声明中文 alternate，以及 10 篇模拟研报 × 2 种语言的 20 组 ID/slug/Canonical 映射。

## B. Sitemap

### 新的规范子 Sitemap

Sitemap 索引继续位于 `/sitemap.xml`，子 Sitemap 改为：

- `/sitemap/pages-en.xml`、`pages-zh.xml`
- `/sitemap/institutions-en.xml`、`institutions-zh.xml`
- `/sitemap/assets-en.xml`、`assets-zh.xml`
- `/sitemap/topics-en.xml`、`topics-zh.xml`
- `/sitemap/research-en-{n}.xml`、`research-zh-{n}.xml`

旧数字地址保留单跳 308：`/sitemap/0.xml` 到英语页面 Sitemap，`/sitemap/{n}.xml` 到对应英语研报分片。旧地址不再由 Sitemap 索引主动发布；完整中英文集合由新索引声明。

### 覆盖和排除规则

- 研报查询继续使用 `publicationReadyWhere(locale)`，因此重定向、404、noindex、撤稿和未通过语言门控的地址不进入对应语言 Sitemap。
- 机构、资产和专题 Sitemap 继续使用与公开页面相同的发布门控与最低覆盖规则。
- 所有 URL 都来自共享的 `researchPath()`、`assetPath()`、`topicPath()` 和 `localePath()`，不生成别名 URL。
- 每个研报分片最多 20,000 URL，低于协议的 50,000 URL 上限；渲染器同时强制 50,000 URL 和未压缩 50 MiB 上限。

### lastmod

- 研报英语 `lastmod` 使用 `Article.updatedAt`；中文使用译文 `updatedAt`，没有译文时间时回退到文章更新时间。
- 机构页使用最近一篇公开研报的更新时间；准确率页使用最近结算时间。
- 资产页使用相关研报更新时间和共识更新时间中的较新值。
- 专题页使用专题查询返回的真实最新内容时间。
- 宏观指标使用自身 `updatedAt`；数据型入口页使用其真实依赖数据的最新更新时间。
- 纯静态政策页使用各自最后一次实际内容/模板修改日期。
- Sitemap 索引省略可选的 `lastmod`，不再为了填索引时间扫描全部研报，也不会把请求时间伪装成更新时间。

### 查询和缓存

- Sitemap 索引只执行英文/中文两个带索引的 count 查询，不再扫描整库计算每个研报分片时间。
- 一个研报子 Sitemap 只读取该语言、该分片的行。
- 页面、机构、资产和专题各自执行范围内查询，不再为一个子 Sitemap 构造所有页面类型。
- 保留 `public, s-maxage=3600, stale-while-revalidate=86400`，首次生成后由现有 Caddy/上游缓存策略复用。

## C. API 与索引边界

- `/api/documents/{id}` 保持可抓取，没有加入 `robots.txt` Disallow。
- 成功文件响应、对象存储 307、403、找不到文件 404 和存储异常 404 均返回 `X-Robots-Tag: noindex, nofollow`。
- 下载、内嵌预览、权限校验、审计和统计逻辑未改变。
- 没有为研报 HTML 页面增加统一 noindex。
- robots 自动测试明确禁止以后把 `/api/documents` 加入 Disallow。

## D. 自动验证

### URL 契约

- 10 篇模拟研报 × 英文/中文，共 20 组历史 ID → 最终 slug 地址。
- 每组同时验证最终 slug 不重定向、标题变化不改变 URL。
- 验证 `SPX`、`spx`、`AAPL` 等别名到最终资产地址，规范 slug 不产生循环。
- 验证中英文自引用 Canonical、双向 hreflang 和单语 alternate 排除。

### Sitemap 与 Googlebot 边界

- 验证命名分片解析、语言/类型拆分、非法和第 0 研报分片拒绝。
- 验证 Sitemap 索引不伪造 `lastmod`。
- 验证最大 URL 数限制小于协议上限。
- 本地生产构建通过真实 HTTP 返回所有新 Sitemap 200/XML；旧 `/sitemap/0.xml` 单跳 308。
- 本地 Googlebot 请求缺失文档接口返回 404 且携带 `X-Robots-Tag: noindex, nofollow`。
- `scripts/seo-baseline.mjs` 默认抽样 24 个中英文核心、研报、机构、资产、专题和经济体 URL，并额外检查空分页、资产别名、旧 Sitemap 和文档接口。

### 功能回归

执行：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

结果：

- TypeScript：通过。
- ESLint：通过。
- 全量单测：581 passed，0 failed。
- Next.js 生产构建：通过，研报搜索、筛选、机构聚合、资产观点和全部动态路由均成功编译。

### 未部署前生产基线

`npm run seo:baseline -- --base=https://tlines.tech --sample=24` 实测 24/24 个核心抽样页面通过，Sitemap 3,065 URL 无重复、越域、alternate 缺失或 robots 冲突；四个边缘检查按预期仍失败：空机构分页、资产别名、旧数字 Sitemap 和缺失文档 404 的 noindex 头。它们对应本提交的四项修复，只有部署后才会在生产转为通过。

## Sitemap 性能

### 优化前：当前生产真实 HTTP，12 次顺序请求

| 地址 | median | p95 |
|---|---:|---:|
| `/sitemap.xml` | 742 ms | 1,443 ms |
| `/sitemap/0.xml` | 933 ms | 1,056 ms |
| `/sitemap/1.xml` | 1,169 ms | 3,037 ms |

### 优化后：本地相同数据快照、生产构建 HTTP，12 次顺序请求

| 地址 | 大小 | median | p95 |
|---|---:|---:|---:|
| `/sitemap.xml` | 960 B | 8 ms | 161 ms |
| `/sitemap/pages-en.xml` | 30,305 B | 12 ms | 34 ms |
| `/sitemap/research-en-1.xml` | 166,406 B | 17 ms | 20 ms |
| `/sitemap/research-zh-1.xml` | 132,320 B | 14 ms | 16 ms |

本地优化后 p95 全部低于 1 秒。生产前后环境不同，不能把绝对值直接当作生产提速比例；新生产 p95 必须在获得部署授权、发布后重新测量。当前代码层面已经去掉 Sitemap 索引的全库时间戳扫描，这是最主要的确定性性能改进。

## 修改文件

- `src/lib/researchPath.ts`、`src/app/research/[id]/page.tsx`、`src/lib/queries.ts`
- `src/lib/assetPath.ts`、`src/app/asset/[ticker]/page.tsx`
- `src/app/institutions/page.tsx`
- `src/lib/sitemap.ts`、`src/app/sitemap.xml/route.ts`、`src/app/sitemap/[shard]/route.ts`
- `src/lib/site.ts`、`src/app/api/documents/[id]/route.ts`
- 对应 `*.test.ts`、`scripts/seo-baseline.mjs` 和 `package.json`

## 回滚

- URL/分页/API 改动均为无迁移的应用代码，可逐文件回滚。
- Sitemap 回滚时恢复旧路由和 `src/lib/sitemap.ts` 即可；数据库结构和数据未变化。
- 新旧 Sitemap 路由不能只回滚一半：索引与子路由必须作为一个提交整体回滚，否则索引可能指向不存在的命名分片。
- 未执行生产部署，因此当前生产无需回滚。

## 部署后待执行

1. 运行 `npm run seo:baseline -- --sample=24`，应消除空机构分页、资产别名、旧 Sitemap 和文档接口四项失败。
2. 对新 Sitemap 各执行至少 20 次测量并记录生产 p50/p95。
3. 在 GSC 重新提交原有 `/sitemap.xml`；无需逐个提交子 Sitemap。
4. 保留旧数字 Sitemap 的访问日志至少一个抓取周期，确认 Googlebot 已迁移到命名分片。
