# 行情与宏观预期闭环实施报告

已完成 P0 的增量骨架：标的身份与供应商映射、行情质量和用途门禁、持久化预算、Twelve Data 端点权重、价格兼容桥、资产行情区、主题混合状态、预测结算证据、Wilson 比例区间、宏观预期版本与冻结、无共识文案门禁、紧凑后台页、双 schema 与 PostgreSQL 迁移。

默认安全行为：无 key 不联网；无授权不返回数字；无严格映射不 fallback；无调查共识不计算 surprise、不触发数字型 surprise 告警、不生成超预期社交文案；行情缺失不阻塞研报、SEO 或官方宏观页面。

P1 未启用：Binance 仅在确认实际加密覆盖需求、地区可用性和数据用途授权后接入；Trading Economics 需用户提供有 calendar snapshot 权限的账户和字段/许可依据；事件后短窗行情需更高频且授权完整的数据，因此本轮不伪造实现。

待外部提供：Twelve Data 服务端 key、账户端点权重/额度、声明延迟、每个数据集的公开/API/社交/衍生使用依据及确认人；如启用宏观调查源，还需来源账户、原始字段文档和许可范围。所有秘密只进服务端环境或既有 secrets 能力。

官方资料核对（2026-09-13）：Twelve Data 的个人 Basic 页面写明 8 credits/minute、800/day，并将其描述为内部非展示用途，因此本站公开/社交用途仍默认关闭，不能由 API key 自动推断；Trading Economics 明确把 `Forecast` 描述为调查共识，而 `TEForecast` 是另一独立字段，未来 adapter 必须分别映射为 SURVEY_CONSENSUS 与 MODEL_FORECAST；Binance Spot REST 为候选但本轮没有实际加密资产需求；FRED 当前条款提示第三方序列版权，并限制缓存、AI 等用途，因此环境新增 `FRED_DATA_USE_CONFIRMED=false` 的默认门禁，完成逐序列法律/用途复核后才能显式开启。

- Twelve Data: https://twelvedata.com/pricing
- Trading Economics: https://docs.tradingeconomics.com/economic_calendar/snapshot/
- Binance Spot REST: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
- FRED API Terms: https://fred.stlouisfed.org/docs/api/terms_of_use.html
