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

## Run the local Agent API

The backend provides Agent chat, locally persisted conversation history, historical A-share daily bars, and AI Tracking analysis. API keys stay in a local environment file and must not be committed.

In PowerShell, from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# Edit backend/.env and set DEEPSEEK_API_KEY. Add a rotated Wind token to WIND_MCP_BEARER_TOKEN if your account can use the Wind MCP service.
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` to inspect and try the API. The chat endpoint is `POST /api/agent/chat`.

Chat history is stored locally in `backend/data/tradingnote.sqlite3`, which is created automatically when the backend starts and is ignored by Git. The backend exposes `GET /api/agent/conversations` to list recent conversations and `GET /api/agent/conversations/{conversation_id}` to load one conversation. The model receives up to the latest 12 messages as context.

Trade records can be persisted through `GET /api/trades`, `POST /api/trades`, `GET /api/trades/{trade_id}`, `PUT /api/trades/{trade_id}`, and `DELETE /api/trades/{trade_id}`. These endpoints keep the trade card field names used by `TradesModule`, including `type` (`Buy` or `Sell`), `price`, `qty`, `motive.tags`, and `plan.tp/sl/desc`. New records may omit `id`; the backend returns a generated ID.

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

`GET /api/market/history/{code}?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` returns historical daily bars for six-digit mainland China A-share codes. Providers are tried in the order in `MARKET_DATA_PROVIDER_ORDER`, which defaults to Wind Finmarket MCP, AkShare, then BaoStock. Wind requires `WIND_MCP_BEARER_TOKEN`; when it is absent or a provider request fails, the next source is tried. Responses include `source`, `providers_tried`, `frequency`, `adjustment`, `as_of`, `latest_close`, `is_realtime`, and `bars`. All three integrations currently request unadjusted daily history; none is treated as a real-time quote feed. AkShare aggregates data from upstream public services, so availability and upstream data terms can vary. Other markets (bonds, Hong Kong, US assets, and crypto shown in the demo) need separate providers; until then, Tracking analysis can proceed with values already present in the detail page and must disclose missing market data.

`POST /api/tracking/analyze` accepts the current Detail page field names and returns an `analysis` object matching the existing UI (`pnl`, `execution`, `deviation`, `comprehensive`, `suggestion`). It uses the transaction timeline for entry/exit facts, attempts the configured A-share providers from the trade date through today, then asks DeepSeek to produce the five analysis strings as JSON. If all providers are unavailable, the endpoint still analyzes the provided trade fields and identifies the missing market context.

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
