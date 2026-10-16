# 08 · 全量交付报告（2026-10-17）

> PRD v1.0 的设计系统、核心页面与新能力已实现并全量上线；`main` = `e0792ba`+ 本报告；生产运行 `sha-50f69f1`（代码与设计系统）+ 两个环境开关。

## 1. 交付内容

| 层 | 交付物 |
|---|---|
| 设计系统 | PRD §6.1 纸色 token（明/暗、变量名不变）、自托管 Source Serif 4 拉丁（SIL OFL，许可证随文件入库）、17px/1.85 长文排版、表格数字、focus-visible、reduced-motion、骨架屏 |
| 组件 | `_components/editorial.tsx`（Byline/KeyTakeaways/EvidenceEntry/SourceBadge/Quote/Correction）、SearchOverlay（⌘K）、ReadingProgress、TopbarScroll、ShareCiteButton、NewsletterCTA、BookmarkButton |
| 页面 | 编辑式首页（编辑精选封面+机构观察+主线/数据/主题带+一图+订阅+信任条）、文章阅读层（衬线大标题/署名/来源徽标/收藏/引文复制/进度条）、研究列表（精选置顶+徽标）、主题页（常青引言挂载点）、政策页排版 |
| 新入口 | `/institutions-directory`（进 sitemap，24 条新 URL 中的主体）、`/search`（noindex）、`/newsletter`（双向确认）、`/account/bookmarks`、`/admin/design-system`、后台"精选"开关、宏观指标单位/期次/来源标注条 |
| 数据 | 附加式迁移一条：`Article.featuredAt` + `NewsletterSubscriber` + `ArticleBookmark`（已在一次性 Postgres 预演 + 生产应用成功） |

## 2. 验收结果（2026-10-17 全部实测）

- **SEO 保护字段零变化**：`npm run baseline:redesign -- --check` 对 256 条基线 URL 的 status/canonical/robots/hreflang 全部一致；review 类变化 234 条正文指纹（改版本身）、24 条 NEW（新页面）、若干 MISSING 为取样偏移（抽查仍 200）。
- 全部既有出口 200/正确门禁：/institutions、/watchlist、/dashboards、/markets、/macro、/research、/topics、rss、sitemap、health；admin 307；MCP 401。
- 搜索：`/api/search` 连续 5 次 200（冷 6.9s→热 2.3s）；`/zh/search` 中英文查询 200。
- 新页面：目录/订阅 200；收藏页匿名 307 登录。
- 632/632 测试、typecheck、lint、生产构建全绿。

## 3. 交付途中发现并修复的生产事故（重要）

**搜索冷启动 OOM 击穿服务器（先于改版存在，被本次部署反复引爆）**：语料涨到 ~1,300 篇后，内存搜索索引的冷构建超过 768MB V8 上限，**每次 `/api/search` 请求都会让 app 崩溃重启**（实测三次 502、RestartCount 3 次攀升）。修复三件套（`src/lib/search.ts`）：正文/译文仅前 4KB 入索引（标题/摘要/观点/品种/主题仍全量——真正被搜索的信号）、候选 trigram 供给封顶 600 词、生产索引窗口 600 篇（超窗有诚实的日志预警）。修复后冷建 6.9s、连打 5 次 200、RestartCount 0、无 FATAL 日志。**代价**：仅最新 600 篇可全文检索，更老报告通过列表/主题/机构/sitemap 仍完全可达；迁到数据库全文检索是后续正确方向（代码注释已记）。

**部署机制的两个真相**（写进交付记忆，未来部署必读）：
1. push main **会**触发 workflow 构建并部署（末尾 verify 上报失败但前面步骤真实生效）——因此"直连部署"仍是主路径，但 push 后要等它跑完再验证，否则两套流程互相覆盖。
2. workflow 会用**发布提交里的 compose 文件**覆盖服务器 `/home/deploy/tline/*.yml`。**任何 compose/环境变更必须先进仓库**，仅在服务器上改会被下一次 push 冲掉（本报告中的 flag 丢失就是这样发生的，第二次已按仓库源修复并验证）。

## 4. 回滚（一条命令）

```bash
# 关闭改版、恢复旧外观（数据/URL 无变化）：
ssh deploy@104.207.82.85 "cd /home/deploy/tline && sed -i 's/^TL_REDESIGN=.*/TL_REDESIGN=\"off\"/' .env && TAG=\$(cat .deploy-tag) docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app"
# 或整镜像回滚：TAG=sha-<上一版> … up -d
```

## 5. 遗留与下一步

- **GSC 凭据**仍未接入（TL-002 的点击/展现列）。
- **主题常青引言**挂载点已就绪（`data/topic-intros.json` 为空对象），内容需运营撰写，两语言齐备才渲染。
- **搜索全文范围**为最新 600 篇（见 §3）；数据库全文检索是正确的中期方案。
- ARCHITECTURE.md 的 6 处过期陈述（见 01 文档）仍待更新。
- 每篇文章的"更正横幅"组件已备好，但站内暂无按文章记录的更正数据源，启用需先建该数据。
