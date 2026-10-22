# M-TradingNote Demo

M-TradingNote is an AI-powered trading review and discipline coaching product designed for individual investors. TradingNote 是一款面向个人投资者的 AI 交易复盘与纪律陪练产品

A mobile trading journal prototype built with React, TypeScript, Tailwind CSS, and Vite. The screens use sample data.

## Run locally

```sh
npm ci
npm run dev
```

Open the URL printed by Vite to view the latest local prototype.

## Publish with GitHub Pages

```sh
npm run build:pages
```

The repository deploys the current `main` branch through GitHub Actions. Each push builds the demo and publishes it to GitHub Pages.

The site is a static prototype and does not connect to a brokerage or trading API.

### Agent Backtest

The Agent Backtest page offers five strategy presets for A-share codes such as `601899` and US tickers such as `AAPL`. Choose a 6-month, 1-year, or 3-year period and click **Run Test**. The default is three years. Results include a return curve starting at 0%, simulated buy/sell fill prices, total return, drawdown, and win rate on completed round trips after transaction costs. Zero percent means no completed round trip was profitable; no completed trades yield an unavailable rate.

A-share requests run through SuperMind. US requests use a separate HTTP backtest worker. The Agent API obtains US daily OHLCV from Wind first, then Yahoo Finance, and sends only normalized bars and the selected preset to the worker. The worker runs daily, long only, with a 99% target weight, 0.1% commission, 0.1% fill slippage per side, and next-session-open fills. It uses a normalized wealth index with fractional shares, so US share quantities are implementation units and the UI displays fill prices only. Input history is unadjusted as reported by the market data API; corporate actions may affect long-period results. The worker is a standalone deterministic simulator, not Qlib or SuperMind. Its HTTP URL can point to another trusted host.

Start the US worker in a separate PowerShell window from `backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn us_backtest_worker.main:app --host 127.0.0.1 --port 8001
```

The Agent API uses `US_BACKTEST_WORKER_URL=http://127.0.0.1:8001` by default. For a remote worker, use an HTTPS URL and set the same `US_BACKTEST_WORKER_TOKEN` in both process environments. Keep the worker behind access control. The Agent API must continue running on port 8000.

Install the `supermind-quant-developer` skill runner on the backend host. Put `MGLLM_API_KEY` in `backend/.env` (never in frontend variables or source control), then restart the backend. The optional `SUPERMIND_RUNNER_PATH` points to the runner script when it is installed outside the default skill directory. `SUPERMIND_JUPYTER_WORKDIR` fixes a common remote directory for file synchronization and execution; its default is `mcp/tradingnote-backtests`.

`POST /api/backtest/run` accepts `{ "strategy": "sma", "ticker": "AAPL", "months": 12 }` or an A-share code. Supported strategy IDs are `sma`, `rsi`, `macd`, `bollinger`, and `volume`; `months` accepts 6, 12, or 36 and defaults to 36. A-share runs use the existing remote engine defaults and pre-adjusted indicator history. Their completed results are cached for the same strategy, symbol, period, strategy code, and Shanghai calendar day. The API response and browser storage omit provider identity, remote job identifiers, and runner details. Result files, cache, and runner logs stay in `backend/.runtime/backtests/` and are ignored by Git.

### Daily Feed

The Feed page requests `GET /api/feed`. The API finds a recent financial-market headline with Tavily, generates five English essays through DeepSeek using five distinct books from the configured reading list, and caches the edition in SQLite. Each article includes a title, up to 3 tags, a 20–30-word summary, and an approximately 300-word essay. A background task prepares the next edition at midnight Asia/Shanghai; opening Feed also creates that day's edition if the scheduled run was missed. Each essay discusses the shared headline and closes with cautious, evidence-based trading guidance.

Swagger UI (`/docs`) has a **Feed** section with `GET /api/feed` and `GET /api/feed/prompt`. Expand the prompt endpoint to read its purpose or call it to retrieve the current system prompt as JSON. The prompt is stored in `backend/app/prompts/feed_system.txt`; the API reads the file for each generation and prompt request, so edits take effect without restarting the backend.

The scheduler runs inside the Agent API process. Keep that backend running for the midnight job, and configure both `TAVILY_API_KEY` and `DEEPSEEK_API_KEY` in `backend/.env`. GitHub Pages only hosts the static frontend, so a deployed Feed also needs a continuously running backend: set `VITE_API_BASE_URL` to its HTTPS API URL when building the frontend, and add the frontend origin to `FRONTEND_ORIGINS` on the backend. Without a reachable backend and those keys, Feed shows a setup message instead of generated articles.

## Run the local Agent API

The backend provides Agent chat, locally persisted conversation history, historical A-share daily bars, and AI Tracking analysis. API keys stay in a local environment file and must not be committed.

In PowerShell, from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# Edit backend/.env and set DEEPSEEK_API_KEY and TAVILY_API_KEY. Set WIND_MCP_BEARER_TOKEN if your account can use Wind daily market history.
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` to inspect and try the API. The chat endpoint is `POST /api/agent/chat`.

### Behavior Insights

The Agent page's **Behavior Insights** button sends the preset question “Tag me and analyze my recent trading style” to `POST /api/agent/insights`. The API reads the same trade ledger as Today → History Trades and the latest complete daily portfolio state used by Today → Portfolio Overview, with the latest holdings snapshot as a fallback. FIFO-matched sales give the completed average holding period; when no sale matches, the age of open buy lots is shown separately. Gross traded value covers the preceding six calendar months. Its ratio uses complete full-account assets when available; otherwise it is labeled as a current holdings market value proxy that excludes cash. DeepSeek writes `summary`, `profit_structure` commentary, and `suggestion`; the API returns verified `key_evidence` metrics from the backend calculations. The English prompt is in `backend/app/prompts/behavior_insights_system.txt` and available through `GET /api/agent/insights/prompt`.

The API calculates chart values, rather than accepting model-generated numbers. Allocation uses current valued holdings by currency and excludes cash. The bar chart shows each current position's unrealized P/L and return versus its recorded average cost; missing prices or costs remain unavailable. Green represents gains and red represents losses. Turnover is gross six-month trading value divided by the latest recorded account assets in the same currency, so it is approximate. No foreign-exchange conversion or invented six-month total return is applied. Import a holdings snapshot or dated trades before requesting Insights. A configured `DEEPSEEK_API_KEY` is required.

Chat history is stored locally in `backend/data/tradingnote.sqlite3`, which is created automatically when the backend starts and is ignored by Git. The backend exposes `GET /api/agent/conversations` to list recent conversations and `GET /api/agent/conversations/{conversation_id}` to load one conversation. The model receives up to the latest 12 messages as context.

Trade records can be persisted through `GET /api/trades`, `POST /api/trades`, `GET /api/trades/{trade_id}`, `PUT /api/trades/{trade_id}`, and `DELETE /api/trades/{trade_id}`. Each trade has one free-text `note` for its reason, intended next step, and any other observation, plus optional `note_tags`. Older saved `motive`, `plan`, and `notes` content is combined into the note when read; subsequent writes use the unified fields. New records may omit `id`; the backend returns a generated ID. The optional `date` field uses `YYYY-MM-DD`; Today writes the selected journal date so Tracking can align trades with daily bars. Existing records without a date remain readable, but their chart markers cannot be positioned on a specific day.

The endpoint accepts an optional `trade_context` object so the Agent can review a specific record:

```json
{
  "message": "Please review this trade against my note.",
  "conversation_id": null,
  "action": "review",
  "trade_id": "2",
  "step": null,
  "trade_context": {
    "id": "2",
    "symbol": "JEREH",
    "type": "Sell",
    "price": 140.0,
    "qty": 100,
    "amount": "¥ 14,000.00",
    "note": "Short-term logic broke after a failed intraday bounce. Next, review whether support holds.",
    "note_tags": ["Error Fix", "Stop Loss", "My custom tag"]
  }
}
```

The Note section suggests tags for buy and sell trades and accepts custom strings in `note_tags`. The free-text `note` is the only trade-level narrative source used by Trade Review and AI Tracking.

### Market history and AI Tracking

Today Daily Summary treats imported positions and trade records as the portfolio scope. It combines deterministic figures with one constrained DeepSeek narrative call; the model writes market, portfolio, and insight text only, while the application computes index moves, P&L amounts, and contribution rankings. Invalid or unavailable model output falls back to concise deterministic copy. For A-shares it uses the Shanghai Composite, Shenzhen Component, and ChiNext indices (CSI 300 fallback), plus exact-date sector performance and sectors associated with imported positions. The card presents market performance, imported-portfolio P&L, and reconciled contributor rows. It does not display return rate or account-scope caveats. `DAILY_SUMMARY_DEFAULT_MARKET` selects a broad index when no holdings or trades establish a market.

`GET /api/market/history/{code}?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` returns historical daily bars for six-digit mainland China A-share codes. Providers are tried in the order in `MARKET_DATA_PROVIDER_ORDER`, which defaults to Yahoo Finance, BaoStock, AkShare, then Wind Finmarket MCP. Wind requires `WIND_MCP_BEARER_TOKEN`; when it is absent or a provider request fails, the next source is tried. The shared `fetch_daily_history` helper uses Wind first and Yahoo Finance second for US stocks; BaoStock only supplies A-share history. Successful responses include `source`, `providers_tried`, `provider_failures`, `frequency`, `adjustment`, `as_of`, `latest_close`, `is_realtime`, and `bars`. These integrations request unadjusted daily history, not real-time quotes.

`POST /api/tracking/analyze` accepts the current Detail page field names and returns the four-field `analysis` object consumed by the UI. It uses the transaction timeline and available daily bars around entry/exit dates, retrieves dated asset and market news snippets through Tavily Search when `TAVILY_API_KEY` is configured, then asks DeepSeek to produce the four analysis strings as JSON. News retrieval uses the `news` topic, searches the last 30 days independently of the last trade date, and discards results without an asset match. If relevant market news is unavailable, the prompt tells the model to disclose that limitation without inventing news or macro factors. A-share daily bars use the configured provider order; Wind is no longer used for Tracking news.

Example request:

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
    "timeline": [
      {"id": "1", "type": "Trade", "action": "Buy", "date": "2026-07-09 14:00", "price": 155.0, "qty": 100, "note": "Short-term bounce setup; reassess if support breaks."},
      {"id": "n1", "type": "Note", "date": "2026-07-12 09:15", "text": "Need to stick to the stop loss strictly."},
      {"id": "2", "type": "Trade", "action": "Sell", "date": "2026-07-14 14:30", "price": 140.0, "qty": 100}
    ]
  }
}
```
