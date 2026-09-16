# 管理后台操作手册

## 进入后台与角色

后台入口为 `/admin`。所有页面要求已登录且拥有 `admin.access`。

- `member`：不能进入后台。
- `reviewer`：可进入内容审核和只读访问分析。
- `admin`：可使用全部后台功能，包括账户、来源、API 和审计管理。
- `ADMIN_EMAILS` 中的账户始终视为 admin，这是防止角色配置错误导致无人可管理系统的保底通道。

角色决定管理权限，`tier` 决定产品套餐，两者互不替代。系统不允许管理员降低自己的角色，也不允许降级最后一个数据库 admin。

## 账户管理

在「账户管理」中可按邮箱、姓名、角色、套餐及状态检索。详情页支持修改角色与套餐、记录运营备注、封禁/恢复、强制下线和删除账户。

- 封禁：立即删除全部数据库会话，并拒绝后续登录；恢复后可重新登录。
- 强制下线：删除全部 Session，并推进 `passwordChangedAt`，现有登录令牌随即失效。
- 删除：必须再次输入完整邮箱。API 密钥与审计记录中的历史外键会置空，历史记录保留。

每次写操作都会进入审计日志。执行危险操作前应核对邮箱和当前角色。

## 访问分析口径

- 浏览量：收到并成功写入的 pageview 数。
- 访客：按 UTC 日生成的匿名摘要去重；跨日不可关联，因此多日访客是各日独立访客之和。
- 会话：客户端 `sessionStorage` 中的随机 ID；空闲 30 分钟后开始新会话。
- 跳出：只有一个 pageview 的已结束会话。
- 停留时间：页面隐藏或离开时上报，单页最大计 4 小时。
- 实时访客：最近 30 分钟出现的匿名访客摘要数。
- DAU / WAU / MAU：对应窗口内出现过 pageview 的登录账户数；粘性为 DAU / MAU。
- Web Vitals：LCP、CLS、INP 样本的 p75；仅统计浏览器实际回传的样本。

分析不设置 Cookie，也不保存原始 IP。启用 `ANALYTICS_RESPECT_DNT=true` 时，带 `DNT: 1` 的请求直接丢弃。原始分析数据默认保留 90 天，日聚合长期保留。

## API 管理

密钥明文只在创建或轮换后显示一次。轮换会立即吊销旧密钥，以相同名称、scope 和限额创建新密钥；先复制新值，再更新调用方配置。修改每分钟限额不需要重新签发密钥。

用量看板统计成功及被拒绝的请求。错误率包含所有 4xx/5xx，429 单独展示；未通过鉴权的调用归入「未鉴权」，没有可关联的密钥。API 用量先在 Web 进程内存中缓冲，异常退出可能丢失一个 flush 周期内的少量计数。

## 审计与故障排查

「审计日志」可按动作、操作人、对象及 UTC 日期区间检索，展开元数据可查看变更前后值。系统任务或已删除账户显示为「系统 / 已删除用户」。

「任务与调度」显示采集和分析汇总任务状态；`analytics-rollup` 失败时应先检查数据库连接及 `ANALYTICS_RAW_RETENTION_DAYS`。健康检查 JSON 可从后台侧栏打开。
# 数据闭环运维

管理员从“内容运营 → 行情与宏观数据”查看统一状态：供应商同步、持久化额度、标的映射、用途授权、宏观预期快照和预测结算原因。页面只读，不会因访问页面触发供应商请求。

授权记录必须有可核验依据 URL、确认人和确认时间。UNKNOWN/过期/未包含当前用途的数据会在服务端被拒绝；仅打开标的或来源开关不能替代许可证明。

手动预期录入：

`npm run macro:expectation -- --release=<release-id-or-key> --indicator=<canonical-key> --type=SURVEY_CONSENSUS --source=<source> --source-url=<evidence-url> --license-key=<policy-dataset-key> --value=<number> --period=<YYYY-MM-DD> --captured-at=<ISO-time> --dry-run=true`

核对 dry-run 后去掉该参数保存。发布后补录必须显式 `--historical=true`，且永远不能成为实时 surprise 的发布前快照。样本量、调查方法、原始字段只有来源真实提供时才填写。

行情回填先预演：`npm run macro:market -- --from=2026-01-01 --to=2026-03-31 --limit=2 --dry-run`。确认时间窗和批次后去掉 `--dry-run`；重复执行通过观测唯一键保持幂等，且与在线行情共享持久化预算。

## 市场预期（共识）自动采集

`macro:expectations`（调度器每 30 分钟一次）读取公开经济日历的当周数据文件，把每个发布的市场预期写成 `SURVEY_CONSENSUS` 预期记录。预期只在其对应发布之前写入才有价值：发布后的同一数字是事后回顾，不能进入实时快照。

日历口径与指标口径不同，换算规则写在 `src/lib/macro/consensus/mapping.ts`：原油库存、非农是「变化量」按前值换算成水平值；CPI/PPI/核心 PCE 是环比百分比按上一期指数水平折算；利率与 GDP 直接采用。每条记录的 `rawField` 保留原始字段与推算过程，便于核对。换算结果与前值偏离超过 25% 会被拒绝并记入 `rejected`，那通常意味着单位读错。

授权闸门默认关闭：没有 `forexfactory:calendar` 的 `CONFIRMED` 授权记录时，预期会照常入库但所有读取方（AI 解读、页面、推文、警报）都不会使用它，同步日志会打印 `macro.consensus.license.missing`。确认授权：

- 控制台：Operations 工作流选择 `consensus-license`，勾选 apply
- 命令行：`npm run licenses` 查看全部授权，`npm run licenses -- confirm --dataset=forexfactory:calendar --provider=... --uses=internal_analysis,public_display,social --evidence-url=<url> --by=<name> --apply` 记录确认

想要收紧公开范围时，去掉 `public_display`（页面不显示共识）或 `social`（推文不带共识列）重新确认即可。

## 五级数据自动发布

`内容发布 → 审核与投递` 顶部的「五级数据自动发布」开关（默认关闭）控制一项例外：重要度为五级的宏观发布在**全部**条件满足时跳过人工批准直接发到账号。条件为：

1. 该发布已捕获数值，且推文会打印的序列（最多两条）都有前值与市场预期；
2. 双语 AI 解读已生成；
3. 推文文案通过发布校验（无链接、无违禁表述、长度合规）。

任一条件不满足的候选仍留在待审核，由人工决定；四~五级之外的发布完全不受此开关影响。自动通过的草稿记 `approvalMode=auto`，后台列表标注「自动发布」，审计动作是 `social.draft.auto_approve`（actor 记 `system:auto-approve`），飞书群仍会收到卡片——标题为「已自动发布」、不带批准按钮，因此群里的记录仍然完整。关闭开关后立即恢复人工审核，不影响已发布的记录。
