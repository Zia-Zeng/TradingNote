"""Dated market evidence for an Agent Review Trades response."""

from __future__ import annotations

import asyncio
import logging
import re
from bisect import bisect_right
from datetime import date, timedelta
from typing import Any

from .market_data import fetch_daily_history
from .tavily_mcp import search_market_news


logger = logging.getLogger(__name__)


def _trade_dates(trades: list[dict[str, Any]]) -> list[date]:
    dates: set[date] = set()
    for trade in trades:
        try:
            trade_date = date.fromisoformat(str(trade.get("date") or "")[:10])
        except ValueError:
            continue
        if trade_date <= date.today():
            dates.add(trade_date)
    return sorted(dates)


def _market_and_code(trades: list[dict[str, Any]], requested_asset: str) -> tuple[str | None, str | None]:
    trade = trades[0]
    code = str(trade.get("code") or requested_asset).strip().upper()
    market = str(trade.get("market") or "").strip().upper()
    if re.fullmatch(r"\d{6}(?:\.(?:SH|SZ|BJ|SS))?", code) or market in {"CN", "A-SHARE", "A_SHARE"}:
        return "CN", code if re.fullmatch(r"\d{6}(?:\.(?:SH|SZ|BJ|SS))?", code) else None
    if market in {"US", "USA", "NASDAQ", "NYSE"} or re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", code):
        return "US", code if re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", code) else None
    return None, None


async def build_review_market_context(
    requested_asset: str, asset_name: str, trades: list[dict[str, Any]],
) -> dict[str, Any]:
    """Fetch quotes and dated headlines without sending private ledger values to providers."""
    if not trades:
        return {"market_data": {"available": False}, "historical_news": [], "recent_news": []}

    trade_dates = _trade_dates(trades)
    market, code = _market_and_code(trades, requested_asset)
    today = date.today()
    start = (trade_dates[0] if trade_dates else today - timedelta(days=90)) - timedelta(days=21)

    async def prices() -> dict[str, Any]:
        if not market or not code:
            return {"available": False, "reason": "No supported A-share or US ticker was recorded."}
        try:
            result = await asyncio.wait_for(fetch_daily_history(code, market, start, today), timeout=28)
        except Exception as exc:
            logger.warning("Review Trades market history unavailable (%s).", type(exc).__name__)
            return {"available": False, "market": market, "code": code, "reason": "Historical daily quotes are temporarily unavailable."}

        bars = result.get("bars") or []
        if not bars:
            return {"available": False, "market": market, "code": code, "reason": "The quote provider returned no daily bars."}
        bar_dates = [str(bar["date"]) for bar in bars]
        selected = set(range(max(0, len(bars) - 15), len(bars)))
        for trade_date in trade_dates:
            prior_index = bisect_right(bar_dates, trade_date.isoformat()) - 1
            if prior_index >= 0:
                selected.update(range(max(0, prior_index - 5), min(len(bars), prior_index + 5)))
        return {
            "available": True,
            "market": market,
            "code": code,
            "source": result.get("source"),
            "as_of": result.get("as_of"),
            "frequency": "daily",
            "adjustment": result.get("adjustment", "unadjusted"),
            "is_realtime": False,
            "bars": [bars[index] for index in sorted(selected)],
        }

    semaphore = asyncio.Semaphore(3)
    query = f"{asset_name} {code or requested_asset} {'A股 股票 行业' if market == 'CN' else 'US stock market sector'}"

    async def dated_news(around: date, *, recent: bool = False) -> dict[str, Any]:
        from_day = around - timedelta(days=14 if recent else 5)
        through_day = around if recent else min(around, today)
        async with semaphore:
            found = await search_market_news(query, from_day.isoformat(), (through_day + timedelta(days=1)).isoformat(), max_results=3)
        results = []
        for item in found.get("results", []):
            published = str(item.get("published_date") or "")[:10]
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", published) or not from_day.isoformat() <= published <= through_day.isoformat():
                continue
            results.append({
                "title": item["title"],
                "published_date": published,
                "source": item.get("source"),
                "url": item["url"],
                "snippet": str(item.get("snippet") or "")[:450],
            })
        return {"trade_date": around.isoformat(), "results": results}

    # Bound external searches; older trades still receive dated price context.
    news_dates = trade_dates[-6:]
    price_result, *news_results = await asyncio.gather(
        prices(),
        *(dated_news(trade_date) for trade_date in news_dates),
        dated_news(today, recent=True),
    )
    return {
        "market_data": price_result,
        "historical_news": news_results[:-1],
        "recent_news": news_results[-1]["results"],
        "news_coverage": "Headlines were searched for up to the six most recent distinct trade dates and the latest 14 days.",
    }
