# 2026-10-28 采集中断恢复

## 已核验的影响与根因

- 初始核验：2026-10-28 06:17:56 America/New_York（10:17:56 UTC）。
- 研报共 2,284 篇，最后入库时间为前一天 21:07:21 UTC，已经停更约 13 小时。
- 49 个来源记录同一错误：`EACCES: permission denied, mkdir '/app/data/cache'`。
- 容器以 `node`（UID 1000）运行；镜像中的 `/app/data` 权限为 `0555`，且缓存子目录未预先创建。`chown` 改变所有者但不会补充写权限。
- 来源失败后进入长退避，调度器继续报告成功完成空批次；进程健康检查因此不能证明内容持续新增。
- `macro:policy` 也因同一缓存目录权限问题失败。
- watchdog 每分钟启动一次，原先未保存通知状态，导致同一个 `pipeline.stalled` 故障持续发送飞书告警。

## 修复与生产部署

1. 在运行中的应用和三个 worker 容器创建 `data/cache/http`、`data/cache/robots`，赋予 `node` 目录所有权和写权限，并用实际写入、删除探针验证。
2. 备份受影响的 49 个来源状态，只重置这些来源的退避时间及失败计数；未启用被禁用或合规规则禁止的来源。
3. 将缓存目录预创建和权限处理加入项目 `Dockerfile`，防止后续构建复发。
4. watchdog 保存故障签名和成功通知时间；忽略持续增长的停更小时数，同一故障最多每小时重报一次，新故障原因立即通知，恢复后清除状态。
5. 在原生产镜像上构建最小热修复镜像，保留现有应用构建及数据库迁移版本。部署应用及三个 worker，未重建数据库或备份容器。

生产版本：`ghcr.io/muadibusul/tline:ops-cachefix-20261028`。

原版本：`sha-7e833d7d224c`；原部署标记保存在 VPS 的 `/home/deploy/tline/.deploy-tag.before-cachefix-20261028`。原镜像仍有缓存权限缺陷，回退时也必须保留相同目录权限修复。

来源状态备份：VPS `/home/deploy/tline/cache-recovery-20261028.CZ3TRG.csv`。备份临时表在导出成功后已删除，没有遗留应用数据库 schema 变更。

## 验收

2026-10-28 06:29:17 America/New_York（10:29:17 UTC）核验：

- 总研报 2,301 篇，实际新增入库 17 篇；其中 15 篇已经通过英文及中文公开门槛。其余来源继续按调度补采和处理。
- watchdog：`pipeline.healthy`，`reasons: []`；新容器内缓存目录仍可由 UID 1000 写入。
- 新部署后的 `macro:policy`、`macro:sync` 均为 `succeeded`；本次部署后已运行来源没有新增缓存权限错误。
- `/api/health`、`/zh/research` 及以下两篇新报告的中文页均返回 200：
  - `/zh/research/saxo-bank-market-quick-take-uk-autumn-budget-in-focus-28-october-2026-bd283ae6b2`
  - `/zh/research/mufg-asia-fx-talk-focus-on-fomc-ba979b605b`
- 本地与实际生产热修复镜像内的 7 项 pipelineHealth 测试全部通过。
- 本次修改及其依赖的定向 TypeScript 检查通过。全项目检查另受已有 `.next/types` 引用已删除的 `src/app/share/food-wholesale-wechat-order-automation-7e2d490718` 页面影响；没有修改该不相关生成缓存。
