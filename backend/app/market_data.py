"""A-share daily history with ordered provider fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from copy import deepcopy
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from time import monotonic
from typing import Any
from urllib.parse import urlencode
from urllib.error import URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from starlette.concurrency import run_in_threadpool


_BAOSTOCK_LOCK = threading.Lock()
_HISTORY_CACHE: dict[tuple[str, str, str, str], tuple[float, dict[str, Any]]] = {}
_HISTORY_LOCKS: dict[tuple[str, str, str, str], asyncio.Lock] = {}
_HISTORY_CACHE_SECONDS = 600
_HISTORY_FALLBACK_CACHE_SECONDS = 300
DEFAULT_A_SHARE_PROVIDER_ORDER = "wind,baostock,akshare,yahoo"
logger = logging.getLogger(__name__)
_HISTORY_CACHE_LOCK = threading.Lock()


def _normalize_code(code: str) -> str:
    normalized = code.strip().upper()
    if not re.fullmatch(r"\d{6}", normalized):
        raise ValueError("A-share code must contain exactly six digits.")
    return normalized


def _date_text(value: date | str) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)[:10]


def _wind_code(code: str) -> str:
    if re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", code) and not re.fullmatch(r"\d{6}", code):
        return code if code.endswith((".O", ".N")) else f"{code}.O"
    if code.startswith(("5", "6", "9")):
        exchange = "SH"
    elif code.startswith(("4", "8")):
        exchange = "BJ"
    else:
        exchange = "SZ"
    return f"{code}.{exchange}"


def _number(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _bar(row: dict[str, Any]) -> dict[str, Any] | None:
    aliases = {
        "date": ("date", "日期", "trade_date", "trade_dt", "datetime", "time"),
        "open": ("open", "开盘", "开盘价", "s_dq_open"),
        "high": ("high", "最高", "最高价", "s_dq_high"),
        "low": ("low", "最低", "最低价", "s_dq_low"),
        "close": ("close", "match", "收盘", "收盘价", "s_dq_close"),
        "volume": ("volume", "vol", "成交量", "s_dq_volume"),
        "amount": ("amount", "成交额", "turnover", "s_dq_amount"),
    }
    normalized = {str(key).lower(): value for key, value in row.items()}
    picked: dict[str, Any] = {}
    for target, keys in aliases.items():
        for key in keys:
            if key.lower() in normalized:
                picked[target] = normalized[key.lower()]
                break
    date_value = picked.get("date")
    close = _number(picked.get("close"))
    if date_value is None or close is None:
        return None
    date_string = str(date_value).strip()
    if re.fullmatch(r"\d{8}", date_string):
        date_string = f"{date_string[:4]}-{date_string[4:6]}-{date_string[6:8]}"
    result: dict[str, Any] = {"date": date_string[:10], "close": close}
    for key in ("open", "high", "low", "volume", "amount"):
        value = _number(picked.get(key))
        if value is not None:
            result[key] = value
    return result
def _rows_from_payload(payload: Any) -> list[dict[str, Any]]:
    """Extract record-shaped rows from common JSON and MCP tool response shapes."""
    if isinstance(payload, list):
        if payload and all(isinstance(item, dict) for item in payload):
            return payload
        return []
    if isinstance(payload, dict):
        columns = payload.get("columns")
        row_values = payload.get("rows")
        if isinstance(columns, list) and isinstance(row_values, list):
            fields = [
                column.get("name") if isinstance(column, dict) else column
                for column in columns
            ]
            if all(isinstance(field, str) for field in fields):
                return [
                    dict(zip(fields, row))
                    for row in row_values
                    if isinstance(row, (list, tuple))
                ]
        for key in ("bars", "data", "rows", "items", "result", "records", "history"):
            if key in payload:
                rows = _rows_from_payload(payload[key])
                if rows:
                    return rows
        fields = payload.get("fields")
        values = payload.get("data")
        if isinstance(fields, list) and isinstance(values, list):
            return [dict(zip(fields, row)) for row in values if isinstance(row, (list, tuple))]
    return []


def _normalize_rows(rows: list[dict[str, Any]], start_date: str, end_date: str) -> list[dict[str, Any]]:
    bars = [_bar(row) for row in rows]
    return sorted(
        [bar for bar in bars if bar and start_date <= bar["date"] <= end_date],
        key=lambda bar: bar["date"],
    )


def _response(
    code: str,
    bars: list[dict[str, Any]],
    source: str,
    tried: list[str],
    failures: list[dict[str, str]],
) -> dict[str, Any]:
    return {
        "code": code,
        "source": source,
        "providers_tried": tried,
        "provider_failures": failures,
        "as_of": bars[-1]["date"] if bars else None,
        "latest_close": bars[-1]["close"] if bars else None,
        "is_realtime": False,
        "frequency": "daily",
        "adjustment": "unadjusted",
        "bars": bars,
    }


def _akshare_history(code: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    import akshare as ak

    frame = ak.stock_zh_a_hist(
        symbol=code,
        period="daily",
        start_date=start_date.replace("-", ""),
        end_date=end_date.replace("-", ""),
        adjust="",
    )
    return _normalize_rows(frame.to_dict(orient="records"), start_date, end_date)


def _baostock_history(code: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    import baostock as bs

    exchange = "sh" if code.startswith(("5", "6", "9")) else "sz"
    if code.startswith(("4", "8")):
        raise RuntimeError("BaoStock does not provide this Beijing-listed code.")

    with _BAOSTOCK_LOCK:
        login = bs.login()
        if login.error_code != "0":
            raise RuntimeError("BaoStock login failed.")
        try:
            result = bs.query_history_k_data_plus(
                f"{exchange}.{code}",
                "date,open,high,low,close,volume,amount",
                start_date=start_date,
                end_date=end_date,
                frequency="d",
                adjustflag="3",
            )
            if result.error_code != "0":
                raise RuntimeError("BaoStock history request failed.")
            rows: list[dict[str, Any]] = []
            while result.next():
                rows.append(dict(zip(result.fields, result.get_row_data())))
            return _normalize_rows(rows, start_date, end_date)
        finally:
            bs.logout()


def _wind_tool_args(input_schema: dict[str, Any], code: str, start: str, end: str) -> dict[str, Any]:
    properties = input_schema.get("properties", {})
    args: dict[str, Any] = {}
    choices = {
        "windcode": _wind_code(code),
        "wind_code": _wind_code(code),
        "code": _wind_code(code),
        "symbol": _wind_code(code),
        "ticker": _wind_code(code),
        "begin_date": start,
        "start_date": start,
        "start": start,
        "from_date": start,
        "end_date": end,
        "end": end,
        "to_date": end,
        "period": "10",
        "frequency": "daily",
        "bar_type": "daily",
    }
    daily_values = {"10", "d", "day", "daily", "1d"}
    for name, schema in properties.items():
        lowered = name.lower()
        if lowered == "period" and isinstance(schema, dict) and schema.get("enum"):
            enum_values = schema["enum"]
            selected = next((value for value in enum_values if str(value).lower() in daily_values), None)
            if selected is not None:
                args[name] = selected
        elif lowered in choices:
            args[name] = choices[lowered]
    required = set(input_schema.get("required", []))
    missing = required - args.keys()
    if missing:
        raise RuntimeError("Wind kline tool requires unsupported arguments.")
    return args


def _wind_payload(result: Any) -> Any:
    structured = getattr(result, "structuredContent", None) or getattr(result, "structured_content", None)
    if structured is not None:
        return structured
    content = getattr(result, "content", None) or []
    for item in content:
        text = getattr(item, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                continue
    raise RuntimeError("Wind returned no structured market data.")


def _wind_tool_rows(payload: Any) -> list[dict[str, Any]]:
    """Normalize the rows returned by Wind's generic tool-discovery endpoint."""
    if isinstance(payload, dict):
        rows = payload.get("rows")
        columns = payload.get("columnNames") or payload.get("columns")
        if isinstance(rows, list) and isinstance(columns, list):
            return [dict(zip(columns, row)) for row in rows if isinstance(row, (list, tuple))]
        if isinstance(rows, list) and rows and all(isinstance(row, dict) for row in rows):
            return rows
        for key in ("data", "result", "content"):
            if key in payload:
                found = _wind_tool_rows(payload[key])
                if found:
                    return found
    return []


async def _wind_resolve_tool(
    session: Any,
    tools: list[Any],
    target_name: str,
    question: str,
) -> tuple[str, dict[str, Any], bool]:
    """Resolve a direct Wind tool or discover it through the generic MCP router."""
    direct = next((tool for tool in tools if target_name in tool.name.lower()), None)
    if direct:
        return direct.name, direct.inputSchema, False

    search_tool = next((tool for tool in tools if tool.name == "market_search_tools"), None)
    if search_tool is None:
        raise RuntimeError(f"Wind MCP does not expose {target_name} or market_search_tools.")

    search_properties = (search_tool.inputSchema or {}).get("properties", {})
    search_args: dict[str, Any] = {}
    if "question" in search_properties:
        search_args["question"] = question
    if "topK" in search_properties:
        search_args["topK"] = 5
    elif "top_k" in search_properties:
        search_args["top_k"] = 5
    search_result = await session.call_tool(search_tool.name, search_args)
    if getattr(search_result, "isError", False):
        raise RuntimeError("Wind tool discovery failed.")

    rows = _wind_tool_rows(_wind_payload(search_result))
    match = next(
        (row for row in rows if str(row.get("toolName", row.get("tool_name", ""))).lower() == target_name),
        None,
    )
    if match is None:
        raise RuntimeError(f"Wind MCP did not discover {target_name}.")
    schema = match.get("params") or match.get("inputSchema") or match.get("input_schema")
    if isinstance(schema, str):
        schema = json.loads(schema)
    if not isinstance(schema, dict):
        raise RuntimeError(f"Wind discovery returned no schema for {target_name}.")
    return str(match.get("toolName", match.get("tool_name"))), schema, True


async def _wind_call_tool(
    session: Any,
    tools: list[Any],
    tool_name: str,
    args: dict[str, Any],
    use_router: bool,
) -> Any:
    if not use_router:
        return await session.call_tool(tool_name, args)

    call_tool = next((tool for tool in tools if tool.name == "market_call_tool"), None)
    if call_tool is None:
        raise RuntimeError("Wind MCP does not expose market_call_tool.")
    return await session.call_tool(call_tool.name, {
        "toolName": tool_name,
        "arguments": json.dumps(args, ensure_ascii=False),
    })


async def _wind_history(code: str, start: str, end: str) -> list[dict[str, Any]]:
    endpoint = os.getenv("WIND_MCP_URL", "https://mcp.wind.com.cn/vserver_wind_tools/mcp/").strip()
    token = os.getenv("WIND_MCP_BEARER_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Wind credential is not configured.")

    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, text/event-stream",
    }
    async with streamablehttp_client(endpoint, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            wind_code = _wind_code(code)
            question = f"Query daily K-line history for {wind_code} from {start} through {end}."
            tool_name, schema, use_router = await _wind_resolve_tool(
                session, tools, "get_stock_kline", question
            )
            candidates = [wind_code]
            if wind_code.endswith(".O") and code == code.split(".")[0]:
                candidates.append(f"{code}.N")
            for candidate in candidates:
                args = _wind_tool_args(schema, candidate, start, end)
                result = await _wind_call_tool(session, tools, tool_name, args, use_router)
                if getattr(result, "isError", False):
                    continue
                try:
                    rows = _rows_from_payload(_wind_payload(result))
                except RuntimeError:
                    continue
                bars = _normalize_rows(rows, start, end)
                if bars:
                    return bars
            raise RuntimeError("Wind returned no usable daily bars.")


def _longbridge_history(code: str, start: str, end: str) -> list[dict[str, Any]]:
    from longbridge.openapi import AdjustType, Config, OAuthBuilder, Period, QuoteContext

    symbol = re.sub(r"\.(?:O|N|US)$", "", code.upper()) + ".US"
    client_id = os.getenv("LONGBRIDGE_OAUTH_CLIENT_ID", "").strip()
    if client_id:
        def authorization_required(_url: str) -> None:
            raise RuntimeError("Longbridge OAuth requires interactive authorization.")
        oauth = OAuthBuilder(client_id).build(authorization_required)
        config = Config.from_oauth(oauth)
    else:
        config = Config.from_apikey_env()
    context = QuoteContext(config)
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    rows = []
    def append_bars(bars: Any) -> None:
        for bar in bars:
            timestamp = bar.timestamp
            if timestamp.tzinfo is not None:
                timestamp = timestamp.astimezone(ZoneInfo("America/New_York"))
            rows.append({"date": timestamp.date().isoformat(), "open": bar.open, "high": bar.high,
                         "low": bar.low, "close": bar.close, "volume": bar.volume, "amount": bar.turnover})
    while first <= last:
        # At most 1,000 calendar days per request, below the API's 1,000-bar cap.
        through = min(last, first + timedelta(days=999))
        try:
            append_bars(context.history_candlesticks_by_date(symbol, Period.Day, AdjustType.NoAdjust, first, through))
        except Exception as exc:
            if "301607" not in str(exc):
                raise
            recent = context.candlesticks(symbol, Period.Day, 1000, AdjustType.NoAdjust)
            rows = []
            append_bars(recent)
            if len(recent) >= 1000 and rows and rows[0]["date"] > start:
                raise RuntimeError("Longbridge recent bars do not cover the requested start date.") from exc
            return _normalize_rows(rows, start, end)
        first = through + timedelta(days=1)
    return _normalize_rows(rows, start, end)


async def fetch_us_history(
    code: str, start_date: date | str, end_date: date | str,
    required_fields: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Fetch US daily bars from Yahoo, then Longbridge, then Wind."""
    symbol = code.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", symbol):
        raise ValueError("A valid US stock ticker is required.")
    start, end = _date_text(start_date), _date_text(end_date)
    if start > end:
        raise ValueError("start_date must be earlier than or equal to end_date.")
    failures: list[dict[str, str]] = []
    tried: list[str] = []
    yahoo_symbol = re.sub(r"\.(?:O|N)$", "", symbol)
    tried.append("Yahoo Finance")
    try:
        result = await asyncio.wait_for(run_in_threadpool(_yahoo_history, yahoo_symbol, start, end), timeout=20)
        bars = result.get("bars", [])
        if not bars or any(any(field not in bar for field in required_fields) for bar in bars):
            raise RuntimeError("Yahoo returned incomplete daily bars.")
        return _response(symbol, bars, "Yahoo Finance", tried, failures)
    except Exception as exc:
        logger.warning("US market data Yahoo request failed: %s", type(exc).__name__)
        failures.append({"provider": "Yahoo Finance", "reason": type(exc).__name__})
    if os.getenv("LONGBRIDGE_OAUTH_CLIENT_ID", "").strip() or all(os.getenv(key, "").strip() for key in ("LONGBRIDGE_APP_KEY", "LONGBRIDGE_APP_SECRET", "LONGBRIDGE_ACCESS_TOKEN")):
        tried.append("Longbridge")
        try:
            bars = await asyncio.wait_for(run_in_threadpool(_longbridge_history, symbol, start, end), timeout=25)
            if not bars or any(any(field not in bar for field in required_fields) for bar in bars):
                raise RuntimeError("Longbridge returned incomplete daily bars.")
            return _response(symbol, bars, "Longbridge", tried, failures)
        except Exception as exc:
            logger.warning("US market data Longbridge request failed: %s", type(exc).__name__)
            failures.append({"provider": "Longbridge", "reason": type(exc).__name__})
    tried.append("Wind Finmarket")
    try:
        bars = await asyncio.wait_for(_wind_history(symbol, start, end), timeout=12)
        if not bars or any(any(field not in bar for field in required_fields) for bar in bars):
            raise RuntimeError("Wind returned incomplete daily bars.")
        return _response(symbol, bars, "Wind Finmarket", tried, failures)
    except Exception as exc:
        logger.warning("US market data Wind request failed: %s", type(exc).__name__)
        failures.append({"provider": "Wind Finmarket", "reason": type(exc).__name__})
    raise RuntimeError("All US stock history providers failed (" + "; ".join(
        f"{item['provider']}: {item['reason']}" for item in failures
    ) + ").")


async def fetch_a_share_history(code: str, start_date: date | str, end_date: date | str) -> dict[str, Any]:
    """Reuse recent daily history while keeping provider fallback for cache misses."""
    normalized_code = _normalize_code(code)
    start = _date_text(start_date)
    end = _date_text(end_date)
    if start > end:
        raise ValueError("start_date must be earlier than or equal to end_date.")

    provider_order = os.getenv("MARKET_DATA_PROVIDER_ORDER") or DEFAULT_A_SHARE_PROVIDER_ORDER
    key = (normalized_code, start, end, provider_order)
    cached = _HISTORY_CACHE.get(key)
    if cached and cached[0] > monotonic():
        return deepcopy(cached[1])

    async with _HISTORY_LOCKS.setdefault(key, asyncio.Lock()):
        cached = _HISTORY_CACHE.get(key)
        if cached and cached[0] > monotonic():
            return deepcopy(cached[1])
        result = await _fetch_a_share_history_uncached(normalized_code, start, end)
        ttl = _HISTORY_CACHE_SECONDS if result["source"] == "Wind Finmarket" else _HISTORY_FALLBACK_CACHE_SECONDS
        _HISTORY_CACHE[key] = (monotonic() + ttl, result)
        if len(_HISTORY_CACHE) > 64:
            oldest = min(_HISTORY_CACHE, key=lambda item: _HISTORY_CACHE[item][0])
            _HISTORY_CACHE.pop(oldest, None)
        return deepcopy(result)


async def _fetch_a_share_history_uncached(normalized_code: str, start: str, end: str) -> dict[str, Any]:
    """Fetch unadjusted A-share daily bars, falling back in configured order."""

    configured = os.getenv("MARKET_DATA_PROVIDER_ORDER") or DEFAULT_A_SHARE_PROVIDER_ORDER
    provider_order = [name.strip().lower() for name in configured.split(",") if name.strip()]
    providers = {"yahoo": "Yahoo Finance", "wind": "Wind Finmarket", "akshare": "AkShare", "baostock": "BaoStock"}
    unknown = [name for name in provider_order if name not in providers]
    if unknown:
        raise ValueError(f"Unknown market data provider(s): {', '.join(unknown)}.")

    tried: list[str] = []
    failures: list[dict[str, str]] = []
    for provider in provider_order:
        tried.append(providers[provider])
        try:
            if provider == "yahoo":
                yahoo_code = _wind_code(normalized_code).replace(".SH", ".SS")
                result = await asyncio.wait_for(run_in_threadpool(_yahoo_history, yahoo_code, start, end), timeout=20)
                bars = result.get("bars", [])
            elif provider == "wind":
                bars = await asyncio.wait_for(_wind_history(normalized_code, start, end), timeout=12)
            elif provider == "akshare":
                bars = await asyncio.wait_for(run_in_threadpool(_akshare_history, normalized_code, start, end), timeout=8)
            else:
                bars = await asyncio.wait_for(run_in_threadpool(_baostock_history, normalized_code, start, end), timeout=8)
            if bars:
                return _response(normalized_code, bars, providers[provider], tried, failures)
            failure = {"provider": providers[provider], "reason": "empty response"}
            failures.append(failure)
            logger.warning("A-share market data provider failed: %s (%s)", failure["provider"], failure["reason"])
        except Exception as exc:
            # Keep provider failures useful while preventing credentials or URLs from leaking.
            detail = str(exc).splitlines()[0][:240]
            detail = re.sub(r"(?i)with url: .*", "with url: <redacted>", detail)
            detail = re.sub(r"https?://\S+", "<url>", detail)
            detail = re.sub(r"(?i)(authorization|bearer|token|api[_-]?key)([=: ]+)\S+", r"\1\2<redacted>", detail)
            failure = {"provider": providers[provider], "reason": type(exc).__name__, "detail": detail}
            failures.append(failure)
            logger.warning("A-share market data provider failed: %s (%s): %s", failure["provider"], failure["reason"], detail)

    raise RuntimeError("All configured A-share history providers failed (" + "; ".join(
        f"{item['provider']}: {item['reason']}" for item in failures
    ) + ").")


def _yahoo_history(code: str, start_date: str, end_date: str) -> dict[str, Any]:
    """Fetch daily closes for non-mainland instruments from Yahoo Finance chart data."""
    symbol = code.strip().upper().replace("/", "-")
    if not symbol or not re.fullmatch(r"[A-Z0-9^=][A-Z0-9.^=_-]{0,31}", symbol):
        raise ValueError("A valid market ticker is required for price history.")
    # Yahoo's period2 is exclusive. Add a small lookback for baseline closes and include end_date.
    start = date.fromisoformat(start_date) - timedelta(days=14)
    end = date.fromisoformat(end_date) + timedelta(days=1)
    params = urlencode({
        "period1": int(datetime.combine(start, datetime_time.min, timezone.utc).timestamp()),
        "period2": int(datetime.combine(end, datetime_time.min, timezone.utc).timestamp()),
        "interval": "1d",
        "events": "div,splits",
    })
    payload = None
    last_error = None
    for host in ("query2.finance.yahoo.com", "query1.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{symbol}?{params}"
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 TradingNote/0.1"})
        try:
            with urlopen(request, timeout=8) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except (URLError, TimeoutError, ValueError) as exc:
            last_error = exc
            logger.warning("Yahoo Finance %s request failed: %s", host, type(exc).__name__)
    if payload is None:
        raise RuntimeError("Yahoo Finance chart endpoints are unavailable.") from last_error
    chart = payload.get("chart", {}) if isinstance(payload, dict) else {}
    if chart.get("error"):
        raise RuntimeError("Market data provider rejected this ticker.")
    result = (chart.get("result") or [None])[0]
    if not isinstance(result, dict):
        raise RuntimeError("Market data provider returned no history for this ticker.")
    quote_groups = result.get("indicators", {}).get("quote", [])
    quotes = quote_groups[0] if quote_groups else {}
    closes = quotes.get("close", [])
    timestamps = result.get("timestamp", [])
    timezone_name = result.get("meta", {}).get("exchangeTimezoneName", "UTC")
    try:
        market_timezone = ZoneInfo(timezone_name)
    except (KeyError, ValueError):
        market_timezone = timezone.utc
    bars = []
    for index, (timestamp, close) in enumerate(zip(timestamps, closes)):
        value = _number(close)
        if value is None:
            continue
        bar = {
            "date": datetime.fromtimestamp(int(timestamp), market_timezone).date().isoformat(),
            "close": value,
        }
        for field in ("open", "high", "low", "volume"):
            values = quotes.get(field) or []
            if index < len(values):
                field_value = _number(values[index])
                if field_value is not None:
                    bar[field] = field_value
        bars.append(bar)
    return {"code": symbol, "source": "Yahoo Finance", "bars": _normalize_rows(bars, start_date, end_date)}


async def fetch_daily_history(code: str, market: str, start_date: date | str, end_date: date | str) -> dict[str, Any]:
    """Use market-specific daily history providers with cached results."""
    normalized_market = str(market or "").upper()
    normalized_code = str(code or "").strip()
    start, end = _date_text(start_date), _date_text(end_date)
    cache_key = (normalized_market, normalized_code.upper(), start, end)
    with _HISTORY_CACHE_LOCK:
        cached = _HISTORY_CACHE.get(cache_key)
        if cached and cached[0] > monotonic():
            return cached[1]
    if normalized_market == "CN" and re.fullmatch(r"\d{6}(?:\.(?:SH|SZ|BJ|SS))?", normalized_code, re.IGNORECASE):
        result = await fetch_a_share_history(normalized_code[:6], start, end)
    elif normalized_market == "US":
        result = await fetch_us_history(normalized_code, start, end)
    else:
        # Broker ledgers commonly use a five-digit Hong Kong code (02259),
        # while Yahoo charts use the unpadded ticker (2259.HK).
        yahoo_code = f"{normalized_code.lstrip('0') or '0'}.HK" if normalized_market == "HK" and re.fullmatch(r"\d{1,5}", normalized_code) else normalized_code
        result = await asyncio.wait_for(run_in_threadpool(_yahoo_history, yahoo_code, start, end), timeout=20)
    with _HISTORY_CACHE_LOCK:
        _HISTORY_CACHE[cache_key] = (monotonic() + 300, result)
    return result
