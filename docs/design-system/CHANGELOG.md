# 设计系统变更记录

## 2026-10-19 · 首页公告位

- 发布 commit `76c30a9`，主机本地构建镜像 `sha-76c30a9`，`.deploy-tag` 已更新；迁移 `20261019190000_home_announcement` 已在生产应用。
- 新鲜事右栏顶部新增公告/广告位，卡片顶边与左侧“今日机构观察”标题顶边对齐（1440 实测均为 y=686）；首页新鲜事从 6 条降为 5 条。
- 新增后台“内容运营 → 公告与广告”：双语标签/标题/正文、链接、排序、启用状态，支持新建、修改、删除；首页只渲染排序最前的一条启用项。
- 链接只允许站内根路径或 https；`//host`、`javascript:`、反斜杠和控制字符在写入与渲染两侧都会被拒绝。
- 修复后台 `admin-columns` 的级联问题：`admin.css` 晚于 `globals.css` 加载，980px 以下单列规则此前被基础两列规则覆盖；公告管理页 390px 实测不再被压成 2px。
- 生产复测：中英文均显示公告；1440/390 无横向溢出；390 公告位在观察列表之后、新鲜事之前；新鲜事生产实际 5 条。

## 2026-10-18 · 生产发布

- 发布 commit `da6feb0`，主机本地构建镜像 `sha-da6feb0`，`.deploy-tag` 已更新。
- 追加 `ffb99eb`：研究卡片在 768/1440 同一行等高，actions 贴底对齐；发布镜像 `sha-ffb99eb`。
- 追加 `15c3bbf`：首页机构观察改为每家最新可公开研报中 importance 最高的可读观点，再按研报时间选 5 家；生产实测 5 家，不再被单篇研报的多条 view 挤占。
- 追加 `bf43a00`：研报详情 section 标题恢复右侧对齐；PDF 下载入口移到“研报原件”标题行右侧；移除底部完整中文译文、完整原文、机构免责声明折叠块。
- 追加 `62c101c`：引用卡“可引用研究简报”右缘与“研报原件 / AI 分析 / 本页如何生成”统一到页面内容右缘。
- 追加 `87ba6af`：移除 `publisherPdf ? 1080 : 820` 宽度分支，所有研报详情页统一为 main 1080 / citation card 1016 / title 900；有/无机构 PDF 的页面横向尺度不再变化。
- 追加 `84b4633`：没有 `source_native` PDF 的页面把 `original_pdf` 提升为“研报原件”主展示，取消底部“预览 PDF”入口，不再显示纯文字正文；下载按钮按文档类型显示“下载机构原始 PDF”或“下载英文 PDF”。
- 六容器 healthy；`/api/health` 返回 `200 {"status":"ok"}`。
- 生产复测：320/390/768/981/1440 无横向溢出；深色主按钮 6.58:1；主题刷新保持；首页/登录页 axe 0 violations；研究卡片同行等高、按钮同一底边。
- 回滚镜像 `sha-da6feb0`、`sha-33c21be` 保留在主机。

## 2026-10-18 · Phase C（核心组件，部分完成）

- `.minibtn` / `.minibtn.p` / `.minibtn.p:hover` 从多轮覆盖收口为一条最终规则；保留旧 class 名称。
- `.chip` 从三条基础规则收口为一条；保留 `chip bull/bear/neu/acc/gray` 状态类。
- `.page-head h1`、`.front-section-head h1/h2`、`.art-title`、`.search-trigger` 收口到最终角色规则。
- 修复 `.page-head h1` 的移动端规则被后续基础规则覆盖的问题：390px 现在实际使用 `clamp(34px,11vw,46px)`。
- 移除重复的 `input:focus` 规则，只保留同时覆盖 input/select/textarea 的焦点契约。
- 登录页、NewsletterCTA、Search 提示和首页空态的静态内联样式改为 class；随后把精确的 `var(--muted)`/`var(--faint)` 颜色、72ch 限宽、`align-self`、11px 元数据等静态值改为工具类，TSX 内联样式当前剩余 130 个 `style={{` 对象。
- CSS 批量采用角色 token：102 处 globals + 17 处 admin 的精确字号/圆角值改为 `--text-*`/`--radius-*`，计算值不变。
- 新增 `.signin-page/-head/-sub/-error/-provider/-demo*`、`.newsletter-*`、`.search-hint`、`.empty-copy` 工具类。
- 修复 768px 平板头部溢出：桌面导航在 980px 以下收起，抽屉接管；721–980px 保留 wordmark；981px 以上隐藏抽屉按钮。768px 首页 `scrollWidth` 从 849 回到 768，登录页从 964 回到 768。
- 删除 4 组完全重复规则，以及 15 条已被后续同 selector 规则完整覆盖的早期规则；当前 CSS 完全重复组为 0。
- Phase D 矩阵：7 个页面 × 7 个宽度（320/390/640/768/981/1280/1440）× Light/Dark = 98 组合，全部无横向溢出、唯一 h1、无页面脚本错误；另测 6 个 forced-colors 组合通过。
- 新增 `scripts/design-audit.mjs` 和 `npm run design:audit`：把 98 组合矩阵、640px 等效 200% 重排、主题持久化、焦点环、forced-colors、html lang/title/main、图片 alt、交互元素可访问名称和小目标变成可复现命令。
- 扩展审计结果：0 failures；34 条小目标提示主要是正文内联链接，按 WCAG 2.5.8 inline 例外保留。
- 登录页“忘记密码”折叠控制补到 24px 最小目标。
- 接入 `axe-core`（dev-only）到 `design:audit`：7 个页面 × 1440 Light / 390 Dark，WCAG A/AA 规则集，最终 **0 violations**。
- axe 修复：移动端品牌链接补 `aria-label`；研报分页数字补 24×24；页脚资产链接补 24px；首页机构观察链接改为 block，消除与元数据 chip 的点击区域重叠。
- 后台响应式修复：980px 以下 `.admin-shell` 改为单列、导航改为自动换行网格、统计卡 2 列；`.admin-body` 成为独立横向滚动容器；Social 表单/审核区在窄屏堆叠。16 个 admin 页面在 390/768/1440 均无横向溢出。
- 后台可访问性：行为分析/机器人流量的滚动表格补 `tabIndex`、`role="region"` 和可读名称；admin 抽样页面 axe WCAG A/AA 为 0 violations。
- `design:audit` 增加可选 `ADMIN_COOKIE`：公开审计之外，自动检查 16 个 admin 页面 × 390/768/1440 和 7 个代表页 axe；不设置时明确报告 admin skipped。
- 新增内联样式回归预算测试：当前 130 个 `style={{` 对象为上限，新增内联样式会失败。

## 2026-10-18 · Phase A/B

基线：`33c21be`。本轮不改业务逻辑、路由、数据库、发布闸门或品牌方向。

### 新增

- `Primitive → Semantic → Component → Legacy alias` token 层，位置 `src/app/globals.css`。
- 语义 token：surface、text、border-control、action、focus-ring、status。
- 字号/间距/圆角/动效角色 token。
- `src/app/_components/focusTrap.ts`：Search 与 MobileNav 共用焦点闭环。
- `src/lib/designTokens.test.ts`：5 项 token/对比度回归测试。
- `docs/design-system/*`：FOUNDATION、TOKENS、COMPONENTS、CONTENT、ACCESSIBILITY、CHANGELOG、ACCEPTANCE_REPORT。

### 修复

- 深色主按钮白字 3.03:1 → 深墨字 6.58:1；覆盖 `.minibtn.p`、`.chart-btn.on`、`.livepill`。
- Light tertiary 文本从 `#8a8f98` 提升到 `#636a74`；Dark 从 `#62666d` 提升到 `#858c96`。
- Light warning/gold/positive 状态色压深，在各自 wash 上达到 ≥4.5:1。
- 控件边界改为 `--border-control`，输入/选择/文本域达到 ≥3:1。
- 焦点环从 14% / 60% 透明色改为 2px 实色 `--focus-ring`。
- `/signin` 320px 头部溢出：380px 以下收起搜索标签和快捷键提示。
- 主题从 `localStorage` 在首屏前恢复；增加 `color-scheme` 与 `aria-pressed`。
- Search 打开后锁定背景滚动，焦点闭环，Escape 归还触发按钮。
- MobileNav 焦点闭环，Escape 归还菜单按钮。
- 首页设计版增加唯一 `h1`（“此刻值得关注”），视觉样式不变。
- 独立链接/按钮/面包屑/页脚/chip 链接补到 24px 最小目标。
- 首页深色封面的反相主按钮补 hover 前景与浅色焦点环，避免浅色主题 hover 时深字落在深靛蓝上。
- `global-error` 改为跟随系统 Light/Dark，不再硬编码单一深色。
- `/admin/design-system` 展示新 token 分组、字号/间距/圆角角色与 disabled 状态。
- 补上未定义的 `--line` 兼容别名。

### 保持

- 现有 class 名称与页面结构。
- 品牌色相、衬线标题、等宽数字、Light/Dark 双主题。
- 所有旧 CSS 变量继续可用。

### 未完成

- 其余页面仍有用内联样式（当前 130 个 `style={{` 对象，多为动态值或一次性布局）；未映射的字号/圆角仍逐页保留，按角色逐步替换。
- 旧页面/后台仍有局部源序覆盖；`.site-footer` 的 17 次出现是不同后代选择器，不是同一 selector 的重复。
- Phase D：其他缩放基准、Pa11y、CI 视觉回归；后台 16 页与公开 98 组合已纳入本地审计。
