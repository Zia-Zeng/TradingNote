"""Global instrument lookup for the manual trade form."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/stocks", tags=["stocks"])
_CACHE: dict[str, Any] = {"expires": 0.0, "items": []}
_CACHE_TTL_SECONDS = 24 * 60 * 60
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, str]]]] = {}
_SEARCH_CACHE_TTL_SECONDS = 5 * 60


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        records = [item for item in payload if isinstance(item, dict)]
        if any("columns" in item and ("rows" in item or "data" in item) for item in records):
            for item in records:
                nested = _rows(item)
                if nested:
                    return nested
        return records
    if isinstance(payload, dict):
        columns = payload.get("columns")
        values = payload.get("rows")
        if isinstance(columns, list) and isinstance(values, list):
            names = [column.get("name", "") if isinstance(column, dict) else str(column) for column in columns]
            return [dict(zip(names, row)) for row in values if isinstance(row, (list, tuple))]
        for key in ("stocks", "data", "rows", "items", "result", "records", "list"):
            nested = payload.get(key)
            if isinstance(nested, list):
                if any(isinstance(item, dict) and "columns" in item and ("rows" in item or "data" in item) for item in nested):
                    for item in nested:
                        found = _rows(item)
                        if found:
                            return found
                return [item for item in nested if isinstance(item, dict)]
            if isinstance(nested, dict):
                found = _rows(nested)
                if found:
                    return found
    return []


def _value(row: dict[str, Any], aliases: tuple[str, ...]) -> str:
    lowered = {str(key).lower().replace("_", ""): value for key, value in row.items()}
    for alias in aliases:
        value = lowered.get(alias.lower().replace("_", ""))
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _normalize(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    result = []
    for row in items:
        code = _value(row, ("code", "ticker", "windcode", "wind_code", "symbol", "证券代码", "股票代码"))
        name = _value(row, ("name", "security_name", "stock_name", "证券名称", "证券简称", "股票名称", "股票简称", "名称"))
        if not code:
            code = next((str(value).strip() for value in row.values() if re.fullmatch(r"[A-Za-z0-9^=][A-Za-z0-9.^=:_-]{0,31}", str(value).strip())), "")
        if not name and code:
            values = [str(value).strip() for value in row.values()]
            name = next((value for value in values if value and value != code and not re.fullmatch(r"[A-Za-z0-9^=][A-Za-z0-9.^=:_-]{0,31}", value)), "")
        if not code or not name:
            continue
        market = _value(row, ("market", "exchange", "exch", "market_name", "交易所", "市场"))
        currency = _value(row, ("currency", "currency_code", "currencycode", "币种", "交易币种"))
        asset_class = _asset_class_label(_value(row, ("asset_class", "assetclass", "quote_type", "quoteType", "security_type", "证券类型")))
        inferred_market, inferred_currency = _infer_market_currency(code, market, currency)
        result.append({"code": code, "name": name, "market": inferred_market, "currency": inferred_currency, "asset_class": asset_class})
    return result


def _asset_class_label(value: str) -> str:
    key = value.strip().upper().replace(" ", "_")
    known = {
        "EQUITY": "Stock", "STOCK": "Stock", "ASTOCK": "Stock", "HKSTOCK": "Stock", "USSTOCK": "Stock", "普通股": "Stock", "A股": "Stock",
        "ETF": "ETF", "ETP": "ETF", "MUTUALFUND": "Fund", "MUTUAL_FUND": "Fund", "FUND": "Fund",
        "BOND": "Bond", "CRYPTOCURRENCY": "Crypto", "CRYPTO": "Crypto", "CURRENCY": "Currency",
        "FUTURE": "Future", "FUTURES": "Future", "OPTION": "Option", "OPTIONS": "Option",
        "COMMODITY": "Commodity", "INDEX": "Index", "MONEYMARKET": "Fund",
    }
    return known.get(key, "Stock" if not key else "Other")


def _infer_market_currency(code: str, exchange: str = "", currency: str = "") -> tuple[str, str]:
    normalized = code.upper()
    venue = exchange.upper()
    if normalized.endswith((".HK",)) or any(key in venue for key in ("HKEX", "HKG", "HONG KONG", "香港")):
        market, default_currency = "HK", "HKD"
    elif normalized.endswith((".SH", ".SS", ".SZ", ".BJ")) or (normalized.isdigit() and len(normalized) == 6):
        market, default_currency = "CN", "CNY"
    elif re.fullmatch(r"0\d{3,4}", normalized):
        # Hong Kong tickers are commonly four or five digits and retain a
        # leading zero (for example 02259). Do not misclassify them as global.
        market, default_currency = "HK", "HKD"
    elif any(key in venue for key in ("NASDAQ", "NYSE", "AMEX", "ARCA", "US", "BATS", "NMS", "NGM", "NCM", "NYQ", "ASE")):
        market, default_currency = "US", "USD"
    elif "CRYPTO" in venue or "CRYPTO" in normalized or "-USD" in normalized:
        market, default_currency = "CRYPTO", "USD"
    else:
        market = "GLOBAL"
        global_venues = (
            ((".T", "TYO", "TOKYO"), "JPY"), ((".L", "LSE", "LONDON"), "GBP"),
            ((".DE", ".F", "XETRA", "FRANKFURT", "GERMANY", "PAR", ".PA", ".AS", ".BR", ".HE"), "EUR"),
            ((".TO", "TSX", "TORONTO", "CANADA"), "CAD"), ((".AX", "ASX", "AUSTRALIA"), "AUD"),
            ((".SI", "SGX", "SINGAPORE"), "SGD"), ((".NS", ".BO", "NSE", "BSE", "INDIA"), "INR"),
            ((".KS", ".KQ", "KOREA"), "KRW"), ((".TW", ".TWO", "TAIWAN"), "TWD"),
            ((".SW", "SIX", "SWITZERLAND"), "CHF"), ((".ST", "STOCKHOLM", "SWEDEN"), "SEK"),
            ((".CO", "COPENHAGEN", "DENMARK"), "DKK"), ((".OL", "OSLO", "NORWAY"), "NOK"),
        )
        default_currency = next((code_value for hints, code_value in global_venues if any(hint in normalized or hint in venue for hint in hints)), "")
    return market, (currency or default_currency).upper()


def _yahoo_search(query: str) -> list[dict[str, str]]:
    url = f"https://query1.finance.yahoo.com/v1/finance/search?q={quote(query)}&quotesCount=12&newsCount=0&enableFuzzyQuery=true"
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 TradingNote/0.1"})
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    items = []
    for quote_item in payload.get("quotes", []):
        symbol = str(quote_item.get("symbol", "")).strip()
        name = str(quote_item.get("longname") or quote_item.get("shortname") or symbol).strip()
        if not symbol:
            continue
        exchange = " ".join(str(quote_item.get(key) or "") for key in ("exchange", "exchDisp", "region"))
        market, currency = _infer_market_currency(symbol, exchange, str(quote_item.get("currency") or ""))
        items.append({
            "code": symbol,
            "name": name,
            "market": market,
            "currency": currency,
            "asset_class": _asset_class_label(str(quote_item.get("quoteType") or "Stock")),
        })
    return items


def _eastmoney_search(query: str) -> list[dict[str, str]]:
    """Search mainland-listed securities via Eastmoney's public suggestion endpoint."""
    params = urlencode({
        "input": query,
        "type": "14",
        "token": "D43BF722C8E33BDC906FB84D85E326E8",
        "count": "20",
    })
    url = f"https://searchapi.eastmoney.com/api/suggest/get?{params}"
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 TradingNote/0.1",
        "Referer": "https://quote.eastmoney.com/",
    })
    with urlopen(request, timeout=6) as response:
        raw = response.read()
        # The service omits its charset; prefer UTF-8 and use GB18030 only if parsing fails.
        try:
            payload = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = json.loads(raw.decode("gb18030"))
    table = payload.get("QuotationCodeTable", {}) if isinstance(payload, dict) else {}
    data = table.get("Data", []) if isinstance(table, dict) else []
    items = []
    for row in data:
        if not isinstance(row, dict):
            continue
        code = str(row.get("Code") or row.get("UnifiedCode") or "").strip()
        name = str(row.get("Name") or "").strip()
        if not code or not name:
            continue
        market, currency = _infer_market_currency(code, str(row.get("SecurityTypeName") or ""))
        items.append({
            "code": code,
            "name": name,
            "market": market,
            "currency": currency or "CNY",
            "asset_class": _asset_class_label(str(row.get("Classify") or row.get("SecurityTypeName") or "Stock")),
        })
    return items


def _wind_search_args(schema: dict[str, Any], query: str) -> dict[str, Any] | None:
    properties = schema.get("properties", {})
    values = {"query": query, "keyword": query, "question": query, "name": query, "code": query, "stock": query, "search": query, "key": query}
    args = {name: values[name.lower()] for name in properties if name.lower() in values}
    if not args or set(schema.get("required", [])) - args.keys():
        return None
    return args


def _response_payload(response: Any) -> Any:
    structured = getattr(response, "structuredContent", None) or getattr(response, "structured_content", None)
    if structured is not None:
        return structured
    for block in getattr(response, "content", []) or []:
        content = getattr(block, "text", "")
        if content:
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                continue
    return None


def _tool_definition(payload: Any, tool_name: str) -> tuple[str, dict[str, Any]] | None:
    if not isinstance(payload, dict):
        return None
    rows = payload.get("rows", [])
    columns = payload.get("columnNames", [])
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, (list, tuple)):
            continue
        item = dict(zip(columns, row))
        if str(item.get("toolName", "")).lower() == tool_name.lower():
            schema = item.get("params", {})
            if isinstance(schema, str):
                try:
                    schema = json.loads(schema)
                except json.JSONDecodeError:
                    schema = {}
            return tool_name, schema if isinstance(schema, dict) else {}
    return None


async def _wind_lookup(query: str) -> list[dict[str, str]]:
    token = os.getenv("WIND_MCP_BEARER_TOKEN", "").strip()
    if not token:
        return []
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    endpoint = os.getenv("WIND_MCP_URL", "https://mcp.wind.com.cn/vserver_wind_tools/mcp/").strip()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"}
    async with streamablehttp_client(endpoint, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            if "market_search_tools" in names and "market_call_tool" in names:
                discovery = await session.call_tool(
                    "market_search_tools",
                    {"question": "按名称或交易代码搜索全球证券，包括 A 股、港股、美股、ETF、基金及其他可交易标的：" + query, "topK": 12},
                )
                if getattr(discovery, "isError", False):
                    return []
                definition = _tool_definition(_response_payload(discovery), "search_stocks")
                if not definition:
                    return []
                _, schema = definition
                arguments = _wind_search_args(schema, query) or {"question": query}
                response = await session.call_tool(
                    "market_call_tool",
                    {"toolName": "search_stocks", "arguments": json.dumps(arguments, ensure_ascii=False)},
                )
                if getattr(response, "isError", False):
                    return []
                payload = _response_payload(response)
                if isinstance(payload, dict) and "data" in payload:
                    payload = payload["data"]
                return _normalize(_rows(payload))

            # Some Wind MCP deployments expose stock search as a direct tool.
            for tool in tools.tools:
                name = tool.name.lower()
                if "stock" not in name or not any(part in name for part in ("search", "lookup", "basic", "code")):
                    continue
                args = _wind_search_args(tool.inputSchema, query)
                if args is None:
                    continue
                response = await session.call_tool(tool.name, args)
                if not getattr(response, "isError", False):
                    normalized = _normalize(_rows(_response_payload(response)))
                    if normalized:
                        return normalized
    return []


def _akshare_list() -> list[dict[str, str]]:
    if time.time() < _CACHE["expires"] and _CACHE["items"]:
        return _CACHE["items"]
    import akshare as ak

    frame = ak.stock_info_a_code_name()
    items = _normalize(frame.to_dict(orient="records"))
    _CACHE.update(expires=time.time() + _CACHE_TTL_SECONDS, items=items)
    return items


@router.get("/search")
async def search_stocks(q: str = Query(min_length=1, max_length=40)) -> dict[str, Any]:
    query = q.strip()
    if not query:
        return {"items": [], "source": None, "available": True}
    cache_key = query.casefold()
    cached = _SEARCH_CACHE.get(cache_key)
    if cached and cached[0] > time.time():
        return {"items": cached[1], "source": "cache", "available": True}
    items: list[dict[str, str]] = []
    source = None
    provider_responded = False
    try:
        items = await asyncio.wait_for(_wind_lookup(query), timeout=12)
        provider_responded = True
        if items:
            source = "Wind"
    except Exception:
        pass
    looks_like_a_share = bool(re.fullmatch(r"\d{6}", query) or re.search(r"[\u3400-\u9fff]", query))
    if not items and looks_like_a_share:
        try:
            items = await run_in_threadpool(_eastmoney_search, query)
            provider_responded = True
            source = "Eastmoney" if items else None
        except Exception:
            items = []
    if not items and looks_like_a_share:
        try:
            all_items = await run_in_threadpool(_akshare_list)
            provider_responded = True
            lowered = query.casefold()
            items = [item for item in all_items if lowered in item["code"].casefold() or lowered in item["name"].casefold()][:12]
            source = "AkShare" if items else None
        except Exception:
            items = []
    # Yahoo's public endpoint rejects Chinese queries with HTTP 400; use it only for Latin/global symbols.
    if not items and not re.search(r"[\u3400-\u9fff]", query):
        try:
            items = await run_in_threadpool(_yahoo_search, query)
            provider_responded = True
            source = "Yahoo Finance" if items else None
        except Exception:
            pass
    items = items[:12]
    if items:
        _SEARCH_CACHE[cache_key] = (time.time() + _SEARCH_CACHE_TTL_SECONDS, items)
    return {"items": items, "source": source, "available": provider_responded}
