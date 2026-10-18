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

### Daily Feed

The Feed page requests `GET /api/feed`. The API finds a recent financial-market headline with Tavily, generates five English essays through DeepSeek using five distinct books from the configured reading list, and caches the edition in SQLite. Each article includes a title, up to 3 tags, a 20–30-word summary, and an approximately 300-word essay. A background task prepares the next edition at midnight Asia/Shanghai; opening Feed also creates that day's edition if the scheduled run was missed. Each essay discusses the shared headline and closes with cautious, evidence-based trading guidance.

The current system prompt is available in Swagger at `GET /api/feed/prompt` and in `backend/app/prompts/feed_system.txt`. The API reads the file for each generation, so prompt edits take effect without restarting the backend.

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

Chat history is stored locally in `backend/data/tradingnote.sqlite3`, which is created automatically when the backend starts and is ignored by Git. The backend exposes `GET /api/agent/conversations` to list recent conversations and `GET /api/agent/conversations/{conversation_id}` to load one conversation. The model receives up to the latest 12 messages as context.

Trade records can be persisted through `GET /api/trades`, `POST /api/trades`, `GET /api/trades/{trade_id}`, `PUT /api/trades/{trade_id}`, and `DELETE /api/trades/{trade_id}`. These endpoints keep the trade card field names used by `TradesModule`, including `type` (`Buy` or `Sell`), `price`, `qty`, `motive.tags`, and `plan.tp/sl/desc`. New records may omit `id`; the backend returns a generated ID. The optional `date` field uses `YYYY-MM-DD`; Today writes the selected journal date so Tracking can align trades with daily bars. Existing records without a date remain readable, but their chart markers cannot be positioned on a specific day.

The endpoint accepts an optional `trade_context` object so the Agent can review a specific record:

```json
{
  "message": "Please review this trade against my plan.",
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
    "motive": {
      "posTag": "Close",
      "tags": ["Error Fix", "Stop Loss", "My custom tag"],
      "desc": "Short-term logic broke after a failed intraday bounce."
    },
    "plan": {
      "tp": "170.00",
      "sl": "145.00",
      "desc": "Exit if the short-term logic breaks."
    }
  }
}
```

The trade object keeps the frontend's existing field names: `type`, `motive.tags`, `motive.desc`, and `plan.tp/sl/desc`. The existing UI displays the system tags as `Stop Loss`, `Take Profit`, `Trend`, `Support Break`, `No Logic`, `Error Fix`, and `Market Dip`; custom strings are also accepted in `motive.tags`.

### Market history and AI Tracking

`GET /api/market/history/{code}?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` returns historical daily bars for six-digit mainland China A-share codes. Providers are tried in the order in `MARKET_DATA_PROVIDER_ORDER`, which defaults to Wind Finmarket MCP, AkShare, then BaoStock. Wind requires `WIND_MCP_BEARER_TOKEN`; when it is absent or a provider request fails, the next source is tried. Successful responses include `source`, `providers_tried`, `provider_failures`, `frequency`, `adjustment`, `as_of`, `latest_close`, `is_realtime`, and `bars`. All three integrations currently request unadjusted daily history; none is treated as a real-time quote feed. AkShare aggregates data from upstream public services, so availability and upstream data terms can vary.

`POST /api/tracking/analyze` accepts the current Detail page field names and returns the four-field `analysis` object consumed by the UI. It uses the transaction timeline and available daily bars around entry/exit dates, retrieves dated asset and market news snippets through Tavily Search when `TAVILY_API_KEY` is configured, then asks DeepSeek to produce the four analysis strings as JSON. News retrieval uses the `news` topic, searches the last 30 days independently of the last trade date, and discards results without an asset match. If relevant market news is unavailable, the prompt tells the model to disclose that limitation without inventing news or macro factors. Wind remains the first configured source for A-share daily bars; it is no longer used for Tracking news.

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
    "plan": {
      "target": 170.0,
      "stopLoss": 145.0,
      "desc": "Short-term bounce play, strict hold if above 145"
    },
    "timeline": [
      {"id": "1", "type": "Trade", "action": "Buy", "date": "2026-07-09 14:00", "price": 155.0, "qty": 100},
      {"id": "n1", "type": "Note", "date": "2026-07-12 09:15", "text": "Need to stick to the stop loss strictly."},
      {"id": "2", "type": "Trade", "action": "Sell", "date": "2026-07-14 14:30", "price": 140.0, "qty": 100}
    ]
  }
}
```
