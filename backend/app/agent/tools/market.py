import asyncio
from datetime import date, timedelta

from ...cached_history import cached_daily_history
from ...market_data import _BAOSTOCK_LOCK, fetch_daily_history
from ...news_data import _published_day, fetch_market_news
from ...tavily_mcp import search_market_news
from ..types import ToolFailure
from . import ledger, notes


CN_INDEXES = [("sh.000001", "上证指数"), ("sh.000300", "沪深300"), ("sz.399001", "深证成指"), ("sz.399006", "创业板指")]
YAHOO_INDEXES = {
    "HK": [("^HSI", "恒生指数")],
    "US": [("^GSPC", "标普500"), ("^IXIC", "纳斯达克综合"), ("^DJI", "道琼斯工业平均")],
}
# Broad-market news uses fixed queries so no user wording ever reaches the search provider.
BROAD_NEWS_QUERY = {"CN": "A股 大盘 市场 新闻", "HK": "港股 恒生指数 市场 新闻", "US": "US stock market news"}


def _number(value, digits=3):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if number == number and abs(number) != float("inf") else None


def _window(date_from, date_to, default_days, max_days):
    today = date.today()
    end = min(date.fromisoformat(date_to), today) if date_to else today
    start = date.fromisoformat(date_from) if date_from else end - timedelta(days=default_days)
    if start > end:
        raise ToolFailure("INVALID_ARGS", "date_from must not be after date_to or today.")
    if (end - start).days > max_days:
        raise ToolFailure("INVALID_ARGS", f"The date range cannot exceed {max_days} days.")
    return start, end


def _bar(bar):
    return {"date": str(bar.get("date"))[:10], **{key: _number(bar.get(key)) for key in ("open", "high", "low", "close")},
            "volume": _number(bar.get("volume"), 0)}


def _stats(bars):
    rows = [_bar(bar) for bar in bars if _number(bar.get("close")) is not None]
    if not rows:
        return None
    first, last = rows[0], rows[-1]
    high = max(rows, key=lambda row: row["high"] if row["high"] is not None else row["close"])
    low = min(rows, key=lambda row: row["low"] if row["low"] is not None else row["close"])
    closes = [row["close"] for row in rows]
    return {
        "bar_count": len(rows),
        "first_close": {"date": first["date"], "close": first["close"]},
        "last_close": {"date": last["date"], "close": last["close"]},
        "change_pct": round((last["close"] - first["close"]) / first["close"] * 100, 2) if first["close"] else None,
        "high": {"date": high["date"], "price": high["high"] if high["high"] is not None else high["close"]},
        "low": {"date": low["date"], "price": low["low"] if low["low"] is not None else low["close"]},
        "ma5": round(sum(closes[-5:]) / 5, 3) if len(closes) >= 5 else None,
        "ma20": round(sum(closes[-20:]) / 20, 3) if len(closes) >= 20 else None,
    }


def _stats_text(stats):
    return (f"截至 {stats['last_close']['date']} 收盘 {stats['last_close']['close']}，区间涨跌 {stats['change_pct']}%，"
            f"最高 {stats['high']['price']}（{stats['high']['date']}），最低 {stats['low']['price']}（{stats['low']['date']}）")


async def get_price_history(code: str, market: str, date_from: str | None = None, date_to: str | None = None) -> dict:
    start, end = _window(date_from, date_to, 30, 400)
    code = notes._value(code, market)
    try:
        result = await cached_daily_history(code, market, start, end)
    except ValueError as exc:
        raise ToolFailure("INVALID_ARGS", str(exc)) from exc
    except Exception as exc:
        raise ToolFailure("UPSTREAM_UNAVAILABLE", f"Daily history is unavailable ({type(exc).__name__}).") from exc
    bars = result.get("bars") or []
    stats = _stats(bars)
    recent = [_bar(bar) for bar in bars[-10:]]
    summary = (f"{market}:{result['code']} {start}~{end} 日线 {stats['bar_count']} 根，{_stats_text(stats)}。数据非实时。"
               if stats else f"{market}:{result['code']} 在 {start}~{end} 没有可用日线。")
    return {"code": result["code"], "market": market, "source": result.get("source"), "as_of": result.get("as_of"),
            "is_realtime": False, "frequency": "daily", "adjustment": result.get("adjustment"),
            "refresh_failed": bool(result.get("refresh_failed")), "period": {"start": start.isoformat(), "end": end.isoformat()},
            "stats": stats, "recent_bars": recent, "truncated": len(bars) > len(recent), "summary": summary}


def _baostock_indexes(start: date, end: date) -> list[dict]:
    import baostock as bs

    # Shared lock: BaoStock has one global session. Exchange prefixes matter since index 000001 (SH) != stock 000001 (SZ).
    with _BAOSTOCK_LOCK:
        if bs.login().error_code != "0":
            raise RuntimeError("BaoStock login failed.")
        try:
            results = []
            for code, _ in CN_INDEXES:
                query = bs.query_history_k_data_plus(code, "date,open,high,low,close,volume", start_date=start.isoformat(),
                                                     end_date=end.isoformat(), frequency="d", adjustflag="3")
                bars = []
                while query.error_code == "0" and query.next():
                    bars.append(dict(zip(query.fields, query.get_row_data())))
                results.append({"source": "BaoStock", "bars": bars})
            return results
        finally:
            bs.logout()


async def get_index_snapshot(market: str) -> dict:
    end = date.today()
    start = end - timedelta(days=14)
    if market == "CN":
        indexes = CN_INDEXES
        try:
            results = await asyncio.to_thread(_baostock_indexes, start, end)
        except Exception as exc:
            raise ToolFailure("UPSTREAM_UNAVAILABLE", f"Index history is unavailable ({type(exc).__name__}).") from exc
    else:
        indexes = YAHOO_INDEXES[market]
        results = await asyncio.gather(*(fetch_daily_history(code, "INDEX", start, end) for code, _ in indexes), return_exceptions=True)
    rows = []
    for (code, name), result in zip(indexes, results):
        stats = _stats(result.get("bars") or []) if isinstance(result, dict) else None
        rows.append({"code": code, "name": name, "source": result.get("source") if isinstance(result, dict) else None,
                     "stats": stats, "available": stats is not None})
    available = [row for row in rows if row["available"]]
    if not available:
        raise ToolFailure("UPSTREAM_UNAVAILABLE", "No index history could be retrieved.")
    as_of = max(row["stats"]["last_close"]["date"] for row in available)
    return {"market": market, "source": ", ".join(sorted({row["source"] for row in available if row["source"]})),
            "as_of": as_of, "is_realtime": False, "period": {"start": start.isoformat(), "end": end.isoformat()},
            "indexes": rows, "truncated": False,
            "summary": "；".join(f"{row['name']} {_stats_text(row['stats'])}" for row in available) + "。数据非实时。"}


async def search_news(market: str, code: str | None = None, date_from: str | None = None, date_to: str | None = None) -> dict:
    start, end = _window(date_from, date_to, 7, 31)
    if code:
        identity = ledger.resolve_instrument(code, market)
        name = identity["symbol"] if identity["symbol"] != identity["code"] else ""
        articles = await fetch_market_news(name or identity["code"], identity["code"] if name else None, market, start, end)
        basis = {"market": market, "code": identity["code"], "name": name or None}
    else:
        found = await search_market_news(BROAD_NEWS_QUERY[market], start.isoformat(), (end + timedelta(days=1)).isoformat(), max_results=8)
        articles = []
        for item in found.get("results", []):
            published = _published_day(item.get("published_date"))
            if published and start.isoformat() <= published <= end.isoformat():
                articles.append({"title": str(item.get("title") or "")[:300], "url": str(item.get("url") or "")[:500],
                                 "source": str(item.get("source") or "")[:120], "date": published,
                                 "summary": str(item.get("snippet") or "")[:400]})
        articles = articles[:5]
        basis = {"market": market, "code": None, "name": None}
    label = basis["name"] or basis["code"] or f"{market} 大盘"
    return {"query_basis": basis, "period": {"start": start.isoformat(), "end": end.isoformat()},
            "source": "Tavily", "is_realtime": False, "articles": articles, "truncated": False,
            "summary": (f"{label} {start}~{end} 检索到 {len(articles)} 条带日期的新闻；报道不能证明某次涨跌的原因。"
                        if articles else f"{label} {start}~{end} 没有检索到带日期的相关新闻（检索服务也可能暂不可用）。")}
