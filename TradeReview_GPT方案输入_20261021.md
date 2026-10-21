# Trade Review 方案设计输入

> 用途：将本文交给 GPT，请它基于现有实现设计 Trade Review 的产品方案、复盘结构和提示词。请先分析当前链路及约束，再提出方案；不要只润色现有 prompt。

## 一、产品目标与核心假设

Trade Review 是交易日记产品里对当日交易及相关记录做复盘的模块。目标是帮助用户更清楚地看见：当时记录了什么理由和背景、实际做了什么、结果如何，以及哪些判断或行为值得继续观察。它是复盘辅助，不是买卖建议，也不是纪律打分器。

**默认解释：用户记录的交易理由，是用户对自己当时为何做出交易的说明。** Motive、Plan、交易 notes、当日日记和相关标的笔记都是可综合使用的记录材料。不要要求用户证明它们属于正式交易计划或证明其为事前承诺；不要预设 Plan 比 Motive 或 notes 更权威；不机械对照计划与执行偏差从而武断地评价决策质量，需要综合整个交易笔记（包括motive、plan、notes等等）。复盘应综合可用记录，缺证据时明确指出缺口，不编造动机、纪律或因果。

用户希望 GPT 设计复盘方案和提示词，重点考虑：如何将用户记录的理由、交易行为、结果和上下文组织成有用而克制的复盘；不同信息缺失时如何降级；输出应如何简洁、可读、可信。具体结构与措辞请 GPT 提出建议，不预设一定采用固定 checklist、评分或“计划执行度”结构。

## 二、当前技术架构

- 前端：React + TypeScript + Vite，Trade Review 展示在 `src/pages/Home.tsx`。
- 客户端 API：`src/lib/daily-review.ts` 调用 `src/lib/api.ts`。
- API 默认地址：`http://127.0.0.1:8000`；可通过构建时 `VITE_API_BASE_URL` 覆盖。
- 后端：FastAPI，核心逻辑在 `backend/app/today.py`，分流器在 `backend/app/trade_review_route.py`。
- LLM：通过 OpenAI 兼容 SDK 请求 DeepSeek API；模型来自 `DEEPSEEK_MODEL`，默认 `deepseek-flash`，超时 45 秒、最多一次重试。
- 持久化：SQLite 的 `today_daily_review_parts` 表，`part='trades'` 按日期 upsert 保存；旧的 combined review 表有兼容读取逻辑。
- 市场辅助上下文：最多对 10 个当日标的拉取复盘日及前 45 天日线；文本出现财报、公告、政策等关键词时，最多对 3 个标的按复盘日检索新闻。

主要接口：

1. `GET /api/today/reviews/{trade_date}`：读当日输入、动态计算 review mode，并返回已存结果。
2. `POST /api/today/reviews/{trade_date}/trades/generate`：生成 Trade Review 并保存。

前端流程：进入日期时先 GET；点击 Generate 后 POST，成功后再 GET 刷新。录入交易/日记会在页面显示 stale 提示，但不会自动重新生成。

## 三、当前上下文与证据来源

`_trade_review_context()` 主要收集：

- 当日交易：成交方向、标的、市场/代码、数量、价格、币种、Motive、Plan、交易 notes。
- 同标的此前交易：每个标的最多 4 笔。
- 日记：当日最近 20 条；此前最多 5 条提及当日标的的日记。
- 标的笔记：每个相关标的最多 5 条。
- 明确标为 active 且仍有持仓、未过期的历史 Plan：当前主要用于无交易日跟踪，也可能作为当日交易的关联证据。
- 覆盖统计：交易数、含 Motive 的交易数、含 Plan 的交易数、含交易 note 的交易数、当日日记数。

证据目录 ID 形式：`trade:{id}`、`note:{id}`、`asset-note:{id}`、`market:{market}:{code}:{date}`。证据摘录最多 500 字。模型需为逐笔复盘返回证据 ID；后端会过滤无效或不相关的引用，并检查数字是否能在所引用证据中找到。

## 四、当前分流和输出

当前 `route_trade_review()` 有四种日级模式：

- `empty`：当日没有交易、当日日记或有效 active Plan。前端不显示 Generate，而提示记录内容。
- `plan_tracking`：无交易但有当日日记或 active Plan。有当日日记时调用 DeepSeek；只有 active Plan 时使用固定文案。
- `fact_based_review`：有交易，但当前所有交易都缺少 Motive、Plan、交易 notes、关联标的笔记/日记和有效关联计划。后端不调用 LLM，逐笔描述成交事实并询问交易理由。
- `execution_review`：有交易，至少一笔有上述笔记上下文。调用 DeepSeek 生成日级 overview 和逐笔复盘；无笔记上下文的单笔仍被强制降级成事实描述及追问。

最近一次代码调整已将逐笔深度从 `full_plan` / `partial_note` 合并为 `notes_based` / `facts_only`，并修改了 execution prompt，要求综合 Motive、Plan、交易 notes、日记及标的笔记，不要求正式计划或笔记类型排序。前端按钮在无交易但有相关上下文时显示 “Review notes”。请在评估方案时以此新方向为准。

当前生成输出字段：

- `trade_review_overview`：日级总览。
- `trade_reviews[]`：逐笔 `trade_id`、`symbol`、`review`、`evidence_refs`、`analysis_depth`、可选 `follow_up_question`。
- `trade_review_evidence[]`：被引用的证据条目。
- `trade_review_plan_updates[]`：无交易日的跟踪文案（字段命名仍带 plan）。
- `trade_review_focus[]`：预留下一步关注点，但当前生成逻辑保存为空。
- `trade_review_market_news[]` 和 warning：生成逻辑写入数据库 payload。

现有 execution prompt 要求英文、overview/逐笔各少于 100 词、逐笔最多引用 1–4 个证据 ID、数字必须有证据支持；要求区分执行与盈亏，不虚构。它目前偏重“防错约束”，对如何产生有洞察的复盘、如何合并多条笔记、什么算有用的下一步观察，定义不足。

## 五、已知实现缺口与方案设计时需考虑的点

1. `GET /reviews/{trade_date}` 当前没有返回已保存 payload 中的 `trade_review_market_news` 和 `trade_review_market_news_warning`，所以 UI 虽有新闻展示区，实际 GET 刷新后读不到这些字段。
2. `DailyTradeReviewsDraft` 接收 `focus_next`，但生成接口保存时 `trade_review_focus` 固定为空，模型的下一步关注点会丢失。
3. 同一日期输入变化后，GET 只在 mode 变化时丢弃旧 review；mode 不变时仍可能返回旧结果。前端 stale 提示只提醒重生成，不阻止显示旧文案。
4. 无交易逻辑、数据字段和 UI 仍有 `plan_tracking` / `plan_updates` 等旧命名；用户希望语义上泛化为“笔记与观察”，后续可评估是否做兼容性重命名。
5. 单笔 `facts_only` 会被代码硬编码为事实复述+追问，即使模型可能基于其他相关笔记做出综合判断。方案需要判断合理的证据关联与降级边界，避免过硬分流。
6. 当日相关日记目前按标的代码/名称做文本匹配；ticker 未出现时可能漏掉有用日记。GPT 可考虑如何在不误关联的情况下整合用户明确标注的笔记关系。

## 六、请 GPT 完成的工作

请基于上述事实输出：

1. 推荐的 Trade Review 产品逻辑与信息层级，并说明每层解决的问题。
2. 对不同证据完整度的处理策略，尤其是如何综合 Motive、Plan、notes、日记、历史交易，避免把“无正式计划”当成“无理由”。
3. 推荐的 LLM 输入 JSON 结构、系统提示词和用户提示词；提示词需可直接进入代码，并给出至少 3 类输入案例的预期输出示例（记录充分、记录零散、只有成交事实）。
4. 建议的输出 JSON schema，明确 overview、逐笔内容、证据引用和下一步观察如何表达。
5. 哪些判断适合确定性代码，哪些交给模型；如何做证据引用与数字校验；如何避免模板话、过度归因、事后偏见和空泛建议。
6. 列出迁移兼容点、应修复的上述接口/数据流断点，以及可验证的验收标准。

请区分：**当前代码事实、你的产品判断、推荐方案**。不要把当前实现当成必须保留的产品设计。
