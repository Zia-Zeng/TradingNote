"""Bounded, cached CSI facts for mainland broad-market and sector context."""

from __future__ import annotations

import asyncio
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Any

import httpx

from .storage import database


CSI_SOURCE = "China Securities Index"
CSI_SECTORS = {
    "932077": "Energy",
    "932078": "Materials",
    "932079": "Industrials",
    "932080": "Consumer Discretionary",
    "932081": "Consumer Staples",
    "932082": "Health Care",
    "932083": "Financials",
    "931775": "Real Estate",
    "932084": "Information Technology",
    "932085": "Communication Services",
    "932086": "Utilities",
}
CSI_CONSTITUENTS_URL = "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/{code}cons.xls"
CSI_PERFORMANCE_URL = "https://www.csindex.com.cn/csindex-home/perf/index-perf"
MAJOR_A_SHARE_INDICES = (
    ("Shanghai Composite", "000001"),
    ("Shenzhen Component", "399001"),
    ("ChiNext", "399006"),
)


def _ensure_cache() -> None:
    with database() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS today_summary_market_cache (
                cache_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            )"""
        )


def _cached(cache_key: str, ttl_seconds: int) -> tuple[dict[str, Any] | None, bool]:
    _ensure_cache()
    with database() as connection:
        row = connection.execute(
            "SELECT payload, fetched_at FROM today_summary_market_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if row is None:
        return None, False
    try:
        fetched_at = datetime.fromisoformat(row["fetched_at"])
        fresh = (datetime.now(timezone.utc) - fetched_at).total_seconds() < ttl_seconds
        return json.loads(row["payload"]), fresh
    except (ValueError, TypeError, json.JSONDecodeError):
        return None, False


def _save(cache_key: str, payload: dict[str, Any]) -> None:
    _ensure_cache()
    with database() as connection:
        connection.execute(
            """INSERT INTO today_summary_market_cache (cache_key, payload, fetched_at)
            VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at""",
            (cache_key, json.dumps(payload, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
        )


def _stock_code(value: Any) -> str | None:
    raw = str(value or "").strip().split(".", 1)[0]
    if not raw.isdigit() or len(raw) > 6:
        return None
    return raw.zfill(6)


def _parse_constituents(content: bytes) -> dict[str, Any]:
    import xlrd

    sheet = xlrd.open_workbook(file_contents=content).sheet_by_index(0)
    if sheet.ncols < 5 or sheet.nrows < 2:
        raise ValueError("CSI constituent table is empty or incomplete")
    rows = [sheet.row_values(index) for index in range(1, sheet.nrows)]
    codes = sorted({code for row in rows if (code := _stock_code(row[4]))})
    if not codes:
        raise ValueError("CSI constituent table contains no stock codes")
    raw_date = str(rows[0][0]).strip().split(".", 1)[0]
    as_of = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if re.fullmatch(r"\d{8}", raw_date) else None
    return {"as_of": as_of, "codes": codes}


async def _constituents(client: httpx.AsyncClient, index_code: str) -> dict[str, Any] | None:
    cache_key = f"csi:constituents:{index_code}"
    cached, fresh = _cached(cache_key, 24 * 60 * 60)
    if fresh:
        return cached
    try:
        response = await client.get(CSI_CONSTITUENTS_URL.format(code=index_code))
        response.raise_for_status()
        result = await asyncio.to_thread(_parse_constituents, response.content)
        _save(cache_key, result)
        return result
    except Exception:
        return cached


async def csi_index_change(index_code: str, trade_date: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """Return an exact-date CSI daily change; never reuse another day's quote."""
    cache_key = f"csi:performance:{index_code}:{trade_date}"
    ttl = 300 if trade_date >= date.today().isoformat() else 7 * 24 * 60 * 60
    cached, fresh = _cached(cache_key, ttl)
    if cached and cached.get("status") == "no_session":
        _, fresh = _cached(cache_key, 300)
    if fresh:
        return cached
    start = (date.fromisoformat(trade_date) - timedelta(days=14)).strftime("%Y%m%d")
    end = date.fromisoformat(trade_date).strftime("%Y%m%d")
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=4)
    try:
        assert client is not None
        response = await client.get(CSI_PERFORMANCE_URL, params={"indexCode": index_code, "startDate": start, "endDate": end})
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or str(payload.get("code")) != "200":
            raise ValueError("CSI performance response is invalid")
        rows = payload.get("data") or []
        match = next((row for row in rows if str(row.get("tradeDate")) == end), None)
        result = {
            "date": trade_date,
            "change_pct": round(float(match["changePct"]), 4) if match and match.get("changePct") is not None else None,
            "source": CSI_SOURCE,
            "source_url": CSI_PERFORMANCE_URL,
            "status": "complete" if match and match.get("changePct") is not None else "no_session",
        }
        _save(cache_key, result)
        return result
    except (httpx.HTTPError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return cached or {"date": trade_date, "change_pct": None, "source": CSI_SOURCE, "source_url": CSI_PERFORMANCE_URL, "status": "unavailable"}
    finally:
        if owns_client:
            await client.aclose()


async def _eastmoney_index_change(client: httpx.AsyncClient, index_code: str, trade_date: str) -> dict[str, Any]:
    """Fetch a bounded index history directly, without AkShare's full-index lookup."""
    start = (date.fromisoformat(trade_date) - timedelta(days=14)).strftime("%Y%m%d")
    end = date.fromisoformat(trade_date).strftime("%Y%m%d")
    secid = f"1.{index_code}" if index_code == "000001" else f"0.{index_code}"
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    response = await client.get(url, params={
        "secid": secid, "fields1": "f1,f2,f3,f4,f5", "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "klt": "101", "fqt": "0", "beg": start, "end": end,
    })
    response.raise_for_status()
    rows = (response.json().get("data") or {}).get("klines") or []
    closes = [(parts[0], float(parts[2])) for row in rows if len(parts := row.split(",")) >= 3]
    current = next((value for day, value in closes if day == trade_date), None)
    previous = next((value for day, value in reversed(closes) if day < trade_date), None)
    if current is None or previous is None or previous <= 0:
        return {"date": trade_date, "change_pct": None, "source": "Eastmoney", "status": "no_session"}
    change = (current / previous - 1) * 100
    if not math.isfinite(change):
        raise ValueError("Index change is not finite")
    return {"date": trade_date, "change_pct": round(change, 4), "source": "Eastmoney", "status": "complete"}


async def a_share_major_indices(trade_date: str) -> list[dict[str, Any]]:
    """Exact-date moves for the three commonly reported mainland indices."""
    async with httpx.AsyncClient(timeout=5, limits=httpx.Limits(max_connections=3)) as client:
        async def load(name: str, code: str) -> dict[str, Any]:
            cache_key = f"a:major:{code}:{trade_date}"
            cached, fresh = _cached(cache_key, 300 if trade_date >= date.today().isoformat() else 7 * 24 * 60 * 60)
            if fresh and cached and cached.get("status") == "complete":
                result = cached
            else:
                try:
                    result = await _eastmoney_index_change(client, code, trade_date)
                    if result["status"] == "complete":
                        _save(cache_key, result)
                except Exception:
                    result = cached or {"date": trade_date, "change_pct": None, "source": "Eastmoney", "status": "unavailable"}
            return {"market": "CN", "name": name, "code": code, **result}

        return list(await asyncio.gather(*(load(name, code) for name, code in MAJOR_A_SHARE_INDICES)))


async def csi_sector_performance(trade_date: str) -> list[dict[str, Any]]:
    """Exact-date CSI first-level sector moves for market leaders and laggards."""
    async with httpx.AsyncClient(timeout=4, limits=httpx.Limits(max_connections=11)) as client:
        changes = await asyncio.gather(*(csi_index_change(code, trade_date, client) for code in CSI_SECTORS))
    return [
        {"index_code": code, "name": name, "related_symbols": [], "classification_as_of": None, **change}
        for (code, name), change in zip(CSI_SECTORS.items(), changes)
    ]


async def csi_industry_context(symbols: list[str], trade_date: str) -> list[dict[str, Any]]:
    """Map A-share codes through the latest CSI classification and fetch dated sector moves."""
    normalized = list(dict.fromkeys(code for symbol in symbols if (code := _stock_code(symbol))))
    if not normalized:
        return []
    limits = httpx.Limits(max_connections=11)
    async with httpx.AsyncClient(timeout=4, limits=limits) as client:
        tasks = [asyncio.create_task(_constituents(client, code)) for code in CSI_SECTORS]
        done, pending = await asyncio.wait(tasks, timeout=6)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        classifications: list[tuple[str, str, list[str], str]] = []
        for index_code, task in zip(CSI_SECTORS, tasks):
            if task not in done or task.cancelled() or task.exception():
                continue
            result = task.result()
            if not result or not result.get("as_of"):
                continue
            related = [symbol for symbol in normalized if symbol in result["codes"]]
            if related:
                classifications.append((index_code, CSI_SECTORS[index_code], related, result["as_of"]))
        classifications.sort(key=lambda item: (-len(item[2]), normalized.index(item[2][0])))
        selected = classifications[:3]
        changes = await asyncio.gather(*(csi_index_change(code, trade_date, client) for code, _, _, _ in selected))
        return [
            {"index_code": code, "name": name, "related_symbols": related, "classification_as_of": as_of, **change}
            for (code, name, related, as_of), change in zip(selected, changes)
        ]
