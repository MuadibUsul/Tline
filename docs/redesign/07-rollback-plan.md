# 07 · 回滚方案

> 前提（本仓现状）：**无 CI**、直连 VPS 部署、单镜像多容器、迁移由 app 启动命令应用。
> 回滚必须覆盖四层：**部署、数据库、特性开关、SEO**。每层均有可执行步骤与验证。

## 1. 部署回滚（镜像级，最常用）

现状机制（已多次演练）：
- 每次发布构建 `ghcr.io/muadibusul/tline:sha-<commit>`；`/home/deploy/tline/.deploy-tag` 记录当前版本；回滚镜像保持在服务器上（近 2-3 个）。
- 启动命令 `Dockerfile:40`：`env:check → db:postgres:deploy → npm start`。

回滚步骤（标准动作）：
```bash
# 1) 确认目标版本仍在（回滚点）
docker images | grep tline | head
# 2) 切回上一个 tag（示例：上一个已验收版本）
cd /home/deploy/tline
TAG=sha-<previous> docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
# 3) 验证
docker compose ps                       # 6 容器 healthy
curl -s -o /dev/null -w "%{http_code}" https://tlines.tech/en/research   # 200
# 4) 写回标记
printf 'sha-<previous>' > .deploy-tag
```
- 触发条件：健康检查失败、关键页 5xx、PRD §8.3 回滚门槛命中。
- 注意：回滚**不自动回滚数据库**——见 §2 的迁移策略保证旧镜像仍能运行。

## 2. 数据库回滚策略（靠设计而非逆向迁移）

规则（重构期间持续生效）：
1. **只允许附加式迁移**：新增列（带默认值/可空）、新增表、新增索引。禁止删列/改类型/改语义。
2. 每个新迁移必须先在一次性 Postgres 容器实跑（本仓既有做法）：`prisma migrate deploy` + `\d` 检查 + 漂移检查。
3. 旧镜像对新列完全无感知 → 部署回滚天然安全。
4. 数据修补脚本（若有）必须幂等、可重跑，且在 staging 数据拷贝上先跑。

## 3. 特性开关（PRD TL-005 / 灰度需要）

推荐最小机制（不引第三方）：
- 环境变量 `TL_REDESIGN`（如 `off|design-system|article|home|all`），在 `src/app/layout.tsx` 与服务端组件读取；
- 组件级替换：新组件放 `_components/editorial/`，页面按 flag 选择渲染分支；**默认 off**；
- 禁止：按 flag 改变任何 URL、metadata 生成逻辑或闸门调用——flag 只切换"视图层"。
- 回退 = 改 env 并重启 app 容器（`docker compose up -d app`），进程内生效，无需回滚镜像。

## 4. SEO 回滚（零损失原则的操作化）

1. **默认 keep**：旧 URL 不变即无需回滚（本审计已建立 [url-mapping-template.csv](./url-mapping-template.csv)，未决策不得上线）。
2. 若某次发布出现问题 URL：
   - 单跳 301/308 的反向操作必须在 PR 内预置（mapping 表含 `rollback_action` 列）；
   - 涉及 sitemap：回滚 `src/lib/sitemap.ts` 的注册项即恢复旧分片内容，分片地址不变。
3. **禁止**：为"恢复"而部署即刷新全站 `dateModified`；用 noindex 批量下架作为回滚手段（正确性方向相反）。
4. 监测：`scripts/seo-monitoring.mjs` 每日指标 + `docs/seo-recovery/06` 的 D+模板；URL 集合变化与质量判定分开看。

## 5. MCP 与新出口的回滚

- MCP 端点：清理为 scope 级（控制台吊销/停用密钥）+ 镜像回滚双保险；`/api/mcp/*` 的 noindex 头在镜像回滚后行为不变（next.config 与代码双写）。
- Publisher MCP 直接发布产生的文章：下架走既有 `npm run withdraw -- --ids=... --reason=...`（可 `--restore`），审计在 `AuditLog`（`mcp.draft.publish`）。

## 6. 演练要求（TL-406）

- [ ] 部署回滚演练一次（选非高峰，回滚点选当前版本前一个 tag）。
- [ ] flag 关闭演练：production 环境用 `TL_REDESIGN=off` 重启，确认旧观感瞬时恢复。
- [ ] 记录：演练日期、命令、耗时、发现的问题，写入本文件附录。
