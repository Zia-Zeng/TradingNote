"""Recent market news for single-asset Tracking analysis."""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from urllib.parse import urlparse

import httpx


logger = logging.getLogger(__name__)
TAVILY_SEARCH_URL = "https://api.tavily.com/search"


async def fetch_feed_news(start_date: date, end_date: date) -> list[dict[str, str]]:
    """Return recent, broadly relevant financial-market headlines for the daily Feed."""
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        logger.warning("Tavily Feed news unavailable: TAVILY_API_KEY is not configured.")
        return []

    request = {
        "query": "latest financial markets headline investor sentiment stocks bonds commodities central banks",
        "topic": "news",
        "search_depth": "advanced",
        "start_date": start_date.isoformat(),
        "end_date": (end_date + timedelta(days=1)).isoformat(),
        "filter_by_published_date": True,
        "max_results": 8,
        "include_answer": False,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                TAVILY_SEARCH_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json=request,
            )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", []) if isinstance(payload, dict) else []
    except httpx.HTTPStatusError as exc:
        logger.warning("Tavily Feed news unavailable (HTTP %s).", exc.response.status_code)
        return []
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("Tavily Feed news unavailable (%s).", type(exc).__name__)
        return []

    news: list[dict[str, str]] = []
    for result in results if isinstance(results, list) else []:
        if not isinstance(result, dict):
            continue
        title, url = result.get("title"), result.get("url")
        if not isinstance(title, str) or not title.strip() or not isinstance(url, str):
            continue
        item = {
            "title": title.strip()[:300],
            "url": url[:500],
            "source": urlparse(url).hostname or "",
        }
        published = result.get("published_date")
        if isinstance(published, str) and published.strip():
            item["date"] = published.strip()[:80]
        content = result.get("content")
        if isinstance(content, str) and content.strip():
            item["summary"] = content.strip()[:1200]
        news.append(item)
    return news


async def fetch_market_news(
    symbol: str, code: str | None, market: str | None, start_date: date | str, end_date: date | str
) -> list[dict[str, str]]:
    """Return dated Tavily news snippets for the asset and its market context."""
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        logger.warning("Tavily market news unavailable: TAVILY_API_KEY is not configured.")
        return []

    start = start_date.isoformat() if isinstance(start_date, date) else str(start_date)[:10]
    end = end_date.isoformat() if isinstance(end_date, date) else str(end_date)[:10]
    if start > end:
        return []
    asset = " ".join(part for part in (symbol.strip(), (code or "").strip()) if part)
    context = "股票 行业 板块 宏观 新闻" if market in {"A-Share", "Stock", "Stocks"} else "market sector macro news"
    query = f"{asset} {context}"
    symbol_key = symbol.strip().casefold()
    asset_alias = symbol_key.split()[0] if market in {"A-Share", "Stock", "Stocks"} else symbol_key.split("/")[0]
    if len(asset_alias) < 5 and market in {"A-Share", "Stock", "Stocks"}:
        asset_alias = ""
    request = {
        "query": query,
        "topic": "news",
        "search_depth": "basic",
        "start_date": start,
        "filter_by_published_date": True,
        "max_results": 8,
        "include_answer": False,
    }
    if end < date.today().isoformat():
        request["end_date"] = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                TAVILY_SEARCH_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json=request,
            )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", []) if isinstance(payload, dict) else []
    except httpx.HTTPStatusError as exc:
        logger.warning("Tavily market news unavailable (HTTP %s).", exc.response.status_code)
        return []
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("Tavily market news unavailable (%s).", type(exc).__name__)
        return []

    news: list[dict[str, str]] = []
    for result in results if isinstance(results, list) else []:
        if not isinstance(result, dict):
            continue
        title = result.get("title")
        url = result.get("url")
        if not isinstance(title, str) or not title.strip() or not isinstance(url, str):
            continue
        content = result.get("content")
        searchable = f"{title} {content if isinstance(content, str) else ''}".casefold()
        if not any(token in searchable for token in (symbol_key, (code or "").casefold(), asset_alias) if token):
            continue
        item = {
            "title": title.strip()[:300],
            "url": url[:500],
            "source": urlparse(url).hostname or "",
        }
        published = result.get("published_date")
        if isinstance(published, str) and published.strip():
            item["date"] = published.strip()[:80]
        if isinstance(content, str) and content.strip():
            item["summary"] = content.strip()[:800]
        news.append(item)
    return news
