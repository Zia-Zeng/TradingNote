"""A-share daily history with ordered provider fallback."""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from datetime import date
from typing import Any

from starlette.concurrency import run_in_threadpool


_BAOSTOCK_LOCK = threading.Lock()


def _normalize_code(code: str) -> str:
    normalized = code.strip().upper()
    if not re.fullmatch(r"\d{6}", normalized):
        raise ValueError("A-share code must contain exactly six digits.")
    return normalized


def _date_text(value: date | str) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)[:10]


def _wind_code(code: str) -> str:
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
        "close": ("close", "收盘", "收盘价", "s_dq_close"),
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


def _response(code: str, bars: list[dict[str, Any]], source: str, tried: list[str]) -> dict[str, Any]:
    return {
        "code": code,
        "source": source,
        "providers_tried": tried,
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
            tools = await session.list_tools()
            candidates = [tool for tool in tools.tools if "get_stock_kline" in tool.name.lower()]
            if not candidates:
                raise RuntimeError("Wind MCP does not expose a stock kline tool.")
            tool = candidates[0]
            args = _wind_tool_args(tool.inputSchema, code, start, end)
            result = await session.call_tool(tool.name, args)
            if getattr(result, "isError", False):
                raise RuntimeError("Wind kline request failed.")
            rows = _rows_from_payload(_wind_payload(result))
            bars = _normalize_rows(rows, start, end)
            if not bars:
                raise RuntimeError("Wind returned no usable daily bars.")
            return bars


async def fetch_a_share_history(code: str, start_date: date | str, end_date: date | str) -> dict[str, Any]:
    """Fetch unadjusted A-share daily bars, falling back in configured order."""
    normalized_code = _normalize_code(code)
    start = _date_text(start_date)
    end = _date_text(end_date)
    if start > end:
        raise ValueError("start_date must be earlier than or equal to end_date.")

    configured = os.getenv("MARKET_DATA_PROVIDER_ORDER", "wind,akshare,baostock")
    provider_order = [name.strip().lower() for name in configured.split(",") if name.strip()]
    providers = {"wind": "Wind Finmarket", "akshare": "AkShare", "baostock": "BaoStock"}
    unknown = [name for name in provider_order if name not in providers]
    if unknown:
        raise ValueError(f"Unknown market data provider(s): {', '.join(unknown)}.")

    tried: list[str] = []
    failures: list[str] = []
    for provider in provider_order:
        tried.append(providers[provider])
        try:
            if provider == "wind":
                bars = await asyncio.wait_for(_wind_history(normalized_code, start, end), timeout=25)
            elif provider == "akshare":
                bars = await run_in_threadpool(_akshare_history, normalized_code, start, end)
            else:
                bars = await run_in_threadpool(_baostock_history, normalized_code, start, end)
            if bars:
                return _response(normalized_code, bars, providers[provider], tried)
            failures.append(f"{provider}: empty response")
        except Exception as exc:
            # Keep details out of API responses/logs because MCP errors can contain request metadata.
            failures.append(f"{provider}: {type(exc).__name__}")

    raise RuntimeError("All configured A-share history providers failed (" + "; ".join(failures) + ").")
