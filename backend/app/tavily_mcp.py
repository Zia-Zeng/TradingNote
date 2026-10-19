"""Small, bounded client for Tavily's hosted MCP search tool."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.parse import urlparse

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


DEFAULT_MCP_URL = "https://mcp.tavily.com/mcp/"
MAX_QUERY_LENGTH = 500
MAX_CONTENT_LENGTH = 900


def _tool_arguments(tool: Any, query: str, start_date: str, end_date: str, max_results: int) -> dict[str, Any]:
    """Build arguments from the server's live schema to tolerate MCP versions."""
    schema = getattr(tool, "inputSchema", {}) or {}
    props = schema.get("properties", {})
    args: dict[str, Any] = {"query": " ".join(query.split())[:MAX_QUERY_LENGTH]}
    candidates: dict[str, Any] = {
        "topic": "news",
        "search_depth": "basic",
        "max_results": max_results,
        "include_answer": False,
        "include_raw_content": False,
        "include_published_date": True,
        "start_date": start_date,
        "end_date": end_date,
    }
    for name, value in candidates.items():
        if name in props:
            args[name] = value
    return args


def _as_json_objects(result: Any) -> list[dict[str, Any]]:
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return [structured]
    objects: list[dict[str, Any]] = []
    for item in getattr(result, "content", []) or []:
        value = getattr(item, "text", None)
        if not value:
            continue
        try:
            decoded = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(decoded, dict):
            objects.append(decoded)
    return objects


def _normalize_results(payloads: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for payload in payloads:
        results = payload.get("results", [])
        if not isinstance(results, list):
            continue
        for item in results:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            title = str(item.get("title") or "").strip()
            content = str(item.get("content") or item.get("raw_content") or "").strip()
            if not url or not title or not content or url in seen_urls:
                continue
            seen_urls.add(url)
            normalized.append({
                "title": title[:240],
                "url": url[:1000],
                "published_date": item.get("published_date"),
                "source": str(item.get("source") or urlparse(url).hostname or "").removeprefix("www.")[:120],
                "score": item.get("score"),
                "snippet": content[:MAX_CONTENT_LENGTH],
            })
            if len(normalized) >= limit:
                return normalized
    return normalized


async def search_market_news(
    query: str,
    start_date: str,
    end_date: str,
    *,
    max_results: int = 5,
) -> dict[str, Any]:
    """Search news through Tavily MCP; return evidence or a non-fatal warning."""
    query = " ".join(query.split())
    if not query:
        return {"available": False, "results": [], "warning": "Market-news query was empty."}

    url = os.getenv("TAVILY_MCP_URL", DEFAULT_MCP_URL).strip() or DEFAULT_MCP_URL
    headers = {"X-Tavily-Access-Mode": "keyless"}
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if api_key:
        headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with asyncio.timeout(14):
            async with streamablehttp_client(url, headers=headers, timeout=10, sse_read_timeout=10) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    search_tool = next((tool for tool in tools.tools if tool.name in {"tavily_search", "tavily-search"}), None)
                    if search_tool is None:
                        return {"available": False, "results": [], "warning": "Tavily MCP did not expose a search tool."}
                    arguments = _tool_arguments(search_tool, query, start_date, end_date, max(1, min(max_results, 8)))
                    result = await session.call_tool(search_tool.name, arguments=arguments)
                    if getattr(result, "isError", False):
                        return {"available": False, "results": [], "warning": "Tavily MCP search returned an error."}
                    results = _normalize_results(_as_json_objects(result), max_results)
                    return {
                        "available": bool(results),
                        "results": results,
                        "warning": None if results else "Tavily returned no market-news results for this query and date range.",
                    }
    except TimeoutError:
        return {"available": False, "results": [], "warning": "Tavily MCP search timed out."}
    except Exception as exc:
        # Do not forward MCP/server error bodies, which can expose request details.
        return {"available": False, "results": [], "warning": f"Tavily MCP is unavailable ({type(exc).__name__})."}
