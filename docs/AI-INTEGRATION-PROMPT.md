# AI 接入提示词

发给对接方的一段提示词。他们把 `[...]` 处填好，粘贴进任意 AI 编程助手
（Claude Code / Cursor / Copilot Chat / ChatGPT 均可），助手就能一次性写出可用的客户端，
不需要再来问我们要文档。

提示词里已经内嵌完整规格，**不要求助手联网抓取 `docs/API.md`** —— 断网、无检索能力的
助手同样能跑通。规格变了记得同步这里。

---

## 完整版（推荐）

````
你是一名资深后端工程师。请帮我接入 Tline 机构研究情报 API,写出可直接上生产的客户端代码。

## 我的情况

- API key: [在此粘贴 tli_ 开头的密钥]
- 技术栈: [例如 TypeScript + Node 20 / Python 3.11 / Java 17]
- 我要做的事: [例如 每 15 分钟增量拉取新研报入库 PostgreSQL / 每天早上把共识分推到企业微信]
- 数据落到哪: [例如 PostgreSQL / MongoDB / 只存 JSON 文件 / 直接转发给下游服务]

## API 规格(以下内容准确无误,请严格按此实现,不要臆造字段)

Base URL: https://tlines.tech/api/v1
认证: 每个请求都要带 `Authorization: Bearer <API key>`
返回: 一律 JSON。成功是 `{ "data": ... }`,列表额外带 `nextCursor`。

### 端点

1) `GET /research` — 已发布研报,按 publishedAt 倒序
   查询参数:
   - `limit`   1–200,默认 50
   - `cursor`  上一页返回的 nextCursor
   - `since` / `until`  ISO-8601 时间,过滤 publishedAt
   - `institution`  机构 slug
   - `ticker`  标的代码,如 SPX
   返回: `{ "data": [ <研报对象> ], "nextCursor": "xxx" | null }`

2) `GET /research/{id}` — 单篇研报,`{ "data": <研报对象> }`。未处理完的返回 404。

3) `GET /institutions` — 机构列表,即 institution 过滤器的取值表
   `{ "data": [ { "slug", "name", "country", "language", "authorityScore", "reportCount" } ] }`

4) `GET /consensus` — 跨机构共识分,可选 `ticker` 只取一个
   `{ "data": [ {
       "ticker", "name", "assetClass",
       "score",            // 0–100,50 为中性
       "label",            // Strong Bullish | Bullish | Neutral | Bearish | Strong Bearish
       "tone",             // bull | neu | bear
       "institutionCount", "bullishCount", "neutralCount", "bearishCount",
       "isFallback",       // true = 窗口内无新研报,用了更早的数据
       "windowStart", "windowEnd",
       "change": { "d1": 数字|null, "d7": 数字|null, "d30": 数字|null }
   } ] }`

### 研报对象结构

```json
{
  "id": "cmtitm77i001un3fgrv5qlrbc",
  "title": { "en": "US rates chartbook", "zh": "美国利率图表手册" },
  "author": null,
  "language": "en",
  "publishedAt": "2026-09-01T12:51:54.700Z",
  "ingestedAt": "2026-09-01T13:04:11.208Z",
  "sourceUrl": "https://www.example-bank.com/research/us-rates",
  "institution": { "slug": "natixis", "name": "Natixis", "country": "FR", "authorityScore": 0.85 },
  "analysis": {
    "summary":       { "en": "...", "zh": "..." },
    "keyArguments":  { "en": ["..."], "zh": ["..."] },
    "keyNumbers":    { "en": [{ "label": "...", "value": "..." }], "zh": [] },
    "risks":         { "en": ["..."], "zh": ["..."] },
    "interpretation":{ "en": "...", "zh": "..." },
    "importanceScore": 0.62,
    "confidence": 0.6
  },
  "assets": [{
    "ticker": "US10Y", "name": "US 10Y Treasury", "assetClass": "rate",
    "direction": 1.0,                 
    "directionLabel": "Bullish",      
    "target": 4.2, "previousTarget": 4.0, "timeHorizon": "3M", "confidence": 0.6
  }],
  "views": [{
    "position": 0, "type": "forecast", "asset": "US 10Y", "assetTicker": "US10Y",
    "topic": "rates", "direction": "bullish", "timeHorizon": "3M", "value": "4.2%",
    "text":      { "en": "...", "zh": "..." },
    "condition": { "en": null, "zh": null },
    "rationale": { "en": "...", "zh": "..." },
    "confidence": "high", "importance": 4
  }]
}
```

字段说明,建模时按此处理:
- `analysis` 整体可能为 null;其中每个 `zh` 字段也可能为 null(尚未翻译)。
- `assets[].direction` 是数值分,约 -2 到 +2:>=1.5 强多、>=0.5 多、(-0.5,0.5) 中性、
  >-1.5 空、否则强空。`directionLabel` 是它对应的英文标签。
- `views[].direction` 与之不同,是字符串(bullish / bearish / neutral 等)。两者别混用。
- `target`、`previousTarget`、`author`、各 `condition` 都可能为 null。
- 所有时间是 ISO-8601 UTC。

### 错误

统一格式 `{ "error": { "code": "...", "message": "..." } }`:

| 状态 | code | 处理方式 |
|---|---|---|
| 400 | invalid_parameter / invalid_cursor | 参数错,不要重试 |
| 401 | unauthorized / key_revoked | 密钥无效或被吊销,不要重试,报警 |
| 403 | insufficient_scope | 密钥缺少该端点的 scope,不要重试,报警 |
| 404 | not_found | 视为暂不可用 |
| 429 | rate_limited | 按响应头 `Retry-After`(秒)退避后重试 |
| 5xx | internal_error | 指数退避重试,最多 5 次 |

### 限流

每个响应都带:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1788365668     ← unix 秒
```
默认每分钟 60 次(以实际返回的 Limit 为准)。Remaining 接近 0 时主动放慢,别等 429。

## 实现要求

1. **增量同步,不要全量重扫。** 持久化"已见过的最大 publishedAt",下次作为 `since` 传入;
   单次同步内部用 `nextCursor` 翻页直到它为 null。重试 429 时保持 cursor 不变、原地重试,
   不要把 cursor 重置回开头。
2. **密钥放环境变量**(如 `TLINE_API_KEY`),绝不硬编码进源码、不写进日志、不提交进 git。
   同时生成 `.env.example`,并确认 `.gitignore` 覆盖了 `.env`。
3. **响应是 `Cache-Control: no-store`**,内容随密钥而变。不要放进 CDN 或共享缓存,
   需要缓存就在本地做。
4. **幂等入库**:以研报 `id` 作为唯一键 upsert,同一篇重复拉到不能产生重复记录。
5. **`isFallback: true` 要区分对待** —— 它表示该标的近期没有新研报、用的是更早的读数,
   属于"最近没人写"而不是"当前观点"。做告警或信号时不要把它当成新鲜数据。
6. **错误分类处理**:401/403/400 属于不可重试,直接失败并告警;429 按 Retry-After 退避;
   5xx 指数退避。不要写成无脑无限重试。
7. 结构化日志:每次同步记录拉取条数、耗时、剩余配额;不要打印密钥。

## 请交付

1. 一个独立的 API 客户端模块(带类型定义 / dataclass / POJO,覆盖上面全部字段)。
2. 一个增量同步任务,含游标持久化、重试退避、幂等写入。
3. 一份最小可跑的示例:拉取最近 7 天研报并打印标题、机构、涉及标的方向。
4. 针对分页、429 退避、字段为 null 这三种情况的单元测试(HTTP 层打桩,不要真调线上)。
5. 一个 README,写明如何配置环境变量与运行。

先用 `GET /institutions` 做连通性冒烟测试确认密钥可用,再写其余部分。
````

---

## 精简版（只想快速试通）

````
帮我用 [语言/框架] 写一个调用 Tline API 的最小客户端。

Base URL: https://tlines.tech/api/v1
认证: 请求头 `Authorization: Bearer [在此粘贴密钥]`(密钥从环境变量 TLINE_API_KEY 读,别硬编码)

端点:
- GET /research?since=<ISO时间>&limit=200&cursor=<上页nextCursor>  → { data: [...], nextCursor: string|null }
- GET /research/{id}                                              → { data: {...} }
- GET /institutions                                               → { data: [...] }
- GET /consensus?ticker=SPX                                       → { data: [...] }

要求:用 since + nextCursor 做增量翻页;429 时读 Retry-After 头退避重试;
错误格式是 { error: { code, message } },401/403 直接失败不重试。
先跑通 /institutions 验证密钥,再拉最近 7 天研报打印标题和机构名。
````

---

## 按场景追加的一句话

贴在完整版末尾即可：

| 对接方想做的 | 追加内容 |
|---|---|
| 落库 | `数据库用 [PostgreSQL/MySQL/MongoDB],请一并给出建表 DDL 和迁移脚本,research 表以 id 为主键。` |
| 推送告警 | `新研报到达时推送到 [企业微信/Slack/飞书] 机器人,只推 analysis.importanceScore >= 0.6 的,消息里带标题、机构、涉及标的方向和 sourceUrl。` |
| 做看板 | `再写一个只读 HTTP 服务,把本地库里的数据按标的聚合暴露给前端,共识分来自 /consensus,并在 isFallback 为 true 时在响应里标注 stale。` |
| 低代码 | `不要写代码,给我 [n8n/Zapier/Make] 的节点配置:HTTP Request 节点的完整参数、分页循环怎么连、凭据怎么存。` |
| 喂给大模型 | `把每篇研报整理成适合向量化的文本块(标题 + 摘要 + 各条 views 的 text),保留 id、机构、publishedAt、assetTicker 作为元数据。` |
