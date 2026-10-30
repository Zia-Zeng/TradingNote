"""Persistent, incremental daily market history for asset detail charts."""

import asyncio
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .market_data import fetch_daily_history
from .storage import get_market_history_cache, save_market_history_segment


_locks: dict[tuple[str, str], asyncio.Lock] = {}
logger = logging.getLogger(__name__)


def _identity(code: str, market: str) -> tuple[str, str]:
    normalized_market = market.strip().upper()
    if normalized_market in {"A-SHARE", "A_SHARE", "STOCK", "STOCKS"}:
        normalized_market = "CN"
    normalized_code = code.strip().upper()
    if normalized_market == "CN":
        match = re.fullmatch(r"(\d{6})(?:\.(?:SH|SZ|BJ|SS))?", normalized_code)
        if not match:
            raise ValueError("A-share code must contain six digits, optionally followed by an exchange suffix.")
        normalized_code = match[1]
    if not normalized_code:
        raise ValueError("A market ticker is required for price history.")
    return normalized_market, normalized_code


async def cached_daily_history(code: str, market: str, start_date: date, end_date: date) -> dict[str, Any]:
    if start_date > end_date:
        raise ValueError("start_date must be earlier than or equal to end_date.")
    normalized_market, normalized_code = _identity(code, market)
    start, end = start_date.isoformat(), end_date.isoformat()
    async with _locks.setdefault((normalized_market, normalized_code), asyncio.Lock()):
        cached = get_market_history_cache(normalized_market, normalized_code, start, end)
        coverage = cached["coverage"]
        segments = [(start, end)] if coverage is None else []
        if coverage:
            if start < coverage["start_date"]:
                segments.append((start, (date.fromisoformat(coverage["start_date"]) - timedelta(days=1)).isoformat()))
            if end > coverage["checked_through"]:
                segments.append(((date.fromisoformat(coverage["checked_through"]) + timedelta(days=1)).isoformat(), end))
            # Refresh recent US bars so an intraday bar is corrected after close,
            # even if the next visit happens on a later day or over a weekend.
            recent_start = (datetime.now(ZoneInfo("America/New_York")).date() - timedelta(days=7)).isoformat()
            overlap_start = max(start, recent_start, coverage["start_date"])
            overlap_end = min(end, coverage["checked_through"])
            if normalized_market == "US" and overlap_start <= overlap_end:
                segments.append((overlap_start, overlap_end))
        refresh_failed = False
        for segment_start, segment_end in segments:
            try:
                fetched = await fetch_daily_history(normalized_code, normalized_market, segment_start, segment_end)
                save_market_history_segment(
                    normalized_market, normalized_code, segment_start, segment_end,
                    str(fetched.get("source") or "Unknown source"), fetched.get("bars") or [],
                )
            except Exception as exc:
                logger.warning("Daily history refresh failed for %s:%s (%s).", normalized_market, normalized_code, type(exc).__name__)
                if not cached["bars"]:
                    raise
                refresh_failed = True
                break
        cached = get_market_history_cache(normalized_market, normalized_code, start, end)
        bars = cached["bars"]
        return {
            "code": normalized_code,
            "source": (cached["coverage"] or {}).get("source"),
            "as_of": bars[-1]["date"] if bars else None,
            "latest_close": bars[-1]["close"] if bars else None,
            "is_realtime": False,
            "frequency": "daily",
            "adjustment": "unadjusted",
            "refresh_failed": refresh_failed,
            "bars": bars,
        }
