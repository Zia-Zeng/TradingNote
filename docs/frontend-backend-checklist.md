# 前后端对接清单

这份清单记录 demo 前端接入后端时需要完成的事项，并明确当前接口使用的字段。

## 与曾的最新前端对齐（`zjj_version`：`8d362bd`）

- `TradesModule` 的记录对象字段与后端一致：`id`、`time`、`type`（Buy/Sell）、`symbol`、`code`、`market`、`price`、`qty`、`amount`、`closeVsFill`、`closeVsFillColor`、`motive`、`plan`、`modifiedAt`。
- `RecordDrawer` 保存表单字段为 `symbol`、`direction`、`price`、`qty`、`posTag`、`tags`、`tp`、`sl`、`planDesc`、`motiveDesc`；`TradesModule` 再把 `direction` 转为记录里的 `type`，把标签和说明装进 `motive`，把止盈止损装进 `plan`。这和后端当前存储形状一致。
- `RecordDrawer` 的证券输入目前是一个 `symbol`（可填代码或名称），但新增记录时 `TradesModule` 把 `code` 写死为 `000000`。后端把这个占位值转为空，避免拿占位代码请求行情；要让新交易参与 A 股行情分析，前端之后需把真实证券代码单独保存到 `code`。
- 前端七个内置 tag 的实际值带空格：`Stop Loss`、`Take Profit`、`Trend`、`Support Break`、`No Logic`、`Error Fix`、`Market Dip`。`zjj_version` 的 RecordDrawer 已支持创建、选择和移除自定义 tag；后端 `motive.tags` 接收这些字符串值。
- Detail 页 Tracking 使用 `direction`、`shares`、`buyPrice`、`currentPrice`、`plan.target/stopLoss/desc`、`timeline`。后端 `/api/tracking/analyze` 接收这一形状，保留五个 `analysis` 字段，同时增加与最新前端保存模型一致的 `tracking.asset`、`overallSummary`、`pnlResult`、`processResult`、`lessonsLearned`、`savedAt`；前端 Generate 按钮仍未发起该请求。
- Agent 普通聊天前端已在当前开发分支连接 `/api/agent/chat`；请求的 `message`、`conversation_id`、`action`、`trade_id`、`step`、`reference`、`asset`、`symbol`、`pnl` 和响应的 `conversation_id`、`reply` 与后端匹配。交易/每日复盘入口携带的 reference、symbol 和 PnL 是页面上下文，不能当成经过账本验证的数据。History 按钮仍未接入历史接口。

## 已有接口

### Agent 聊天

- `POST /api/agent/chat` 已接到普通聊天发送流程。
- 请求字段：`message`、`conversation_id`、`action`、`trade_id`、`step`、`reference`、`asset`、`symbol`、`pnl`、可选 `trade_context`。
- `GET /api/agent/conversations` 和 `GET /api/agent/conversations/{conversation_id}` 已提供历史列表和详情。

### Tracking 分析与行情

- `POST /api/tracking/analyze` 接收详情页的 `trade_context`，返回 `analysis.pnl`、`analysis.execution`、`analysis.deviation`、`analysis.comprehensive`、`analysis.suggestion`，并返回可直接存入最新前端模型的 `tracking` 字段。
- `GET /api/market/history/{code}` 按 `MARKET_DATA_PROVIDER_ORDER` 依次尝试 Wind Finmarket MCP、AkShare、BaoStock，响应中有 `source`、`providers_tried`、`frequency`、`adjustment`、`as_of`、`latest_close`、`is_realtime`、`bars`。
- 当前只覆盖六位 A 股代码，返回未复权日线，不是实时行情。其他市场要先选择数据源。

### 交易记录

- `GET /api/trades`、`POST /api/trades`、`GET /api/trades/{trade_id}`、`PUT /api/trades/{trade_id}`、`DELETE /api/trades/{trade_id}` 已提供本地 SQLite CRUD。
- 交易接口沿用 `TradesModule` 的字段：`type`、`price`、`qty`、`amount`、`motive`、`plan`。新增时可不传 `id`，后端会生成并返回。

## 前端待办

下列事项属于“后端已提供接口，等待前端接入/产品确认”，建议李先和曾确认页面改动时机，避免同时编辑同一文件：

1. **Tracking 接入（优先）**：`Detail.tsx` 调 `POST /api/tracking/analyze`，传 `trade_context`，用 `analysis` 渲染结果；展示加载、失败重试、无行情状态，以及行情来源/日期/日线属性。
2. **交易记录持久化**：`TradesModule.tsx` 以 `/api/trades` 的 GET/POST/PUT/DELETE 替换本地 demo CRUD；确认空库首次打开时的展示方式。
3. **Agent 交易上下文**：聊天请求除 `trade_id`、页面 `reference`、`symbol`、展示用 `pnl` 外，尽量附上完整交易记录。Agent 的 `trade_context` 使用交易卡片形状（`type`、`price`、`qty`、`motive`、`plan.tp/sl/desc`），与 Tracking 的详情形状（`direction`、`shares`、`buyPrice/currentPrice`、`plan.target/stopLoss/desc`、`timeline`）不同，不能把 Tracking 对象原样传给 Agent。
4. **Agent 历史**：History 页面接 `GET /api/agent/conversations` 和 `GET /api/agent/conversations/{conversation_id}`，实现列表、选择和恢复。
5. **真实证券代码**：录入表单需把证券代码单独存入 `code`；目前新增交易将 `code` 写成 `000000`，后端会将它视为空，因此不能据此拉取 A 股历史行情。建议 `symbol` 继续作为展示名称/代码，另加可选的 A 股 6 位 `code` 输入；不猜测代码，非 A 股可留空。
6. **API 地址与跨域**：统一从 `VITE_API_BASE_URL` 读取后端地址；本机以 `http://127.0.0.1:8000` 为默认值。当前浏览器实际在 `127.0.0.1:5175`，后端 CORS 配置目前只列了 5173，需要李补上当前前端来源或改成可配置来源。手机/部署访问时也不能继续用访问者本机的 `127.0.0.1`。

- 自定义 tag 已在 `zjj_version` 前端实现，后端接受 `motive.tags: string[]`，此项完成。
- 可以交给 Qoder 的机械性工作：在曾确认不同时编辑 `Detail.tsx` 后，按现有请求/响应字段接入 Tracking API，并补齐加载、错误重试和行情来源提示。涉及字段语义或 UI 取舍的部分先由李、曾确认。

- [ ] 在 `Detail.tsx` 调用 `POST /api/tracking/analyze`，把当前详情数据传入 `trade_context`；用返回的 `analysis` 替换页面硬编码的分析文字。
- [ ] Tracking 区域增加加载中、请求失败后重试和行情缺失提示；有行情时展示 `market_data.source`、`market_data.as_of`，不要把日线显示成实时价。
- [ ] Tracking 展示行情时说明数据来源，并使用 `is_realtime` 和 `frequency` 表达日线历史数据，避免让用户误认为实时行情。
- [ ] Agent 在交易卡片上下文可用后附带符合 Agent schema 的 `trade_context`；不要直接发送 Tracking 的详情 schema。
- [ ] 把 Agent 页 History 按钮接到 `GET /api/agent/conversations` 和 `GET /api/agent/conversations/{conversation_id}`，实现列表、选择和恢复对话。
- [x] `RecordDrawer.tsx` 已支持自定义 tag 输入、创建、选择和移除；系统建议 tag 与自定义 tag 都保存在 `motive.tags: string[]`。
- [ ] 统一交易方向字段：录入表单的 `direction` 当前在 `TradesModule` 保存成 `type`；详情页当前使用 `direction`。两者值都是 `Buy` / `Sell`，调用各接口时沿用对应页面已有字段。
- [ ] 为 `127.0.0.1:8000` 增加可配置的 API base URL。部署到其他电脑或手机访问时，`127.0.0.1` 会指向访问者自己的设备。

## 仍需后端工作

- [ ] 在 `TradesModule.tsx` 用 `GET /api/trades` 加载记录，新增用 `POST`、编辑用 `PUT`、删除用 `DELETE`；需决定空数据库时如何展示三条 demo 初始记录。
- [ ] 如比赛需要非 A 股或实时行情，为港股、美股、债券、加密资产分别确定数据源、授权、币种和更新时间，并统一成页面需要的行情响应。
- [ ] Tracking 多次分批买入/卖出的盈亏核算需要按完整成交序列处理；当前接口返回的是简化估算，展示前需与真实账本字段核对。

## Tracking 请求样例

```json
{
  "trade_context": {
    "id": "2",
    "symbol": "JEREH",
    "code": "002353",
    "market": "A-Share",
    "direction": "Sell",
    "status": "Closed",
    "time": "2026-07-14 14:30:00",
    "shares": 100,
    "buyPrice": 155.0,
    "currentPrice": 140.0,
    "plan": {
      "target": 170.0,
      "stopLoss": 145.0,
      "desc": "Short-term bounce play, strict hold if above 145"
    },
    "timeline": [
      {"id": "1", "type": "Trade", "action": "Buy", "date": "2026-07-09 14:00", "price": 155.0, "qty": 100},
      {"id": "2", "type": "Trade", "action": "Sell", "date": "2026-07-14 14:30", "price": 140.0, "qty": 100}
    ]
  }
}
```
