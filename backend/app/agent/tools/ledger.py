import re
from datetime import date

from ... import behavior_insights, storage
from ..types import ToolFailure
from . import notes


def _instrument(market, code, symbol, source):
    code = notes._value(code, market)
    result = {"asset": f"{market}:code:{code}", "market": market, "code": code, "symbol": symbol or code, "source": source}
    if source == "code_format":
        result["summary"] = "仅按代码格式解析，未核实该代码是否存在。"
    else:
        result["summary"] = f"本地{'账本' if source == 'ledger' else '已存别名'}识别为 {market}:{code}（{symbol or code}）。"
    return result


def resolve_instrument(query: str, market: str | None = None, *, allow_private: bool = True) -> dict:
    query = notes._text_arg(query, "query")
    selector = notes._selector(query, market)
    hint, kind, value = selector
    if hint and hint not in {"CN", "HK", "US"}:
        raise ToolFailure("INVALID_ARGS", "market must be CN, HK or US.")
    if allow_private:
        trades = storage.list_trades()
        matches = notes._matching(trades, selector)
        identities = notes._identities(trades)
        keys = {identities[str(trade["id"])] for trade in matches}
        if len(keys) > 1:
            raise ToolFailure("NOT_FOUND", "Local instrument identity is ambiguous; specify market.")
        if len(keys) == 1:
            key = next(iter(keys))
            resolved_market, resolved_kind, code = key.split(":", 2)
            if resolved_kind == "code":
                trade = sorted(matches, key=notes._sort_key, reverse=True)[0]
                return _instrument(resolved_market, code, trade.get("symbol"), "ledger")
    for alias_query in dict.fromkeys((query, value)):
        alias = storage.get_instrument_alias(alias_query)
        if alias:
            alias_market = notes._market(alias.get("market"))
            code = notes._value(alias.get("code"), alias_market)
            if code and code != "000000" and (not hint or hint == alias_market):
                return _instrument(alias_market, code, alias.get("name") or alias.get("symbol"), "alias")
    ticker = notes._value(value, hint)
    if kind != "symbol":
        if hint in {None, "CN"} and re.fullmatch(r"[0-9]{6}", ticker) and ticker != "000000":
            return _instrument("CN", ticker, ticker, "code_format")
        if hint == "HK" and re.fullmatch(r"[0-9]{1,5}", ticker) and int(ticker) > 0:
            return _instrument("HK", ticker, ticker, "code_format")
        if hint is None and re.fullmatch(r"0[0-9]{4}", ticker) and int(ticker) > 0:
            return _instrument("HK", ticker, ticker, "code_format")
        if hint in {None, "US"} and (hint == "US" or value == value.upper()) and re.fullmatch(r"[A-Z]{1,5}(?:[.-][A-Z]{1,2})?", ticker):
            return _instrument("US", ticker, ticker, "code_format")
    raise ToolFailure("NOT_FOUND", "No unambiguous local identity or explicit instrument code was found.")


def search_trades(asset=None, date_from=None, date_to=None, side=None, limit=30) -> dict:
    limit = notes._limit(limit, 50)
    start, end = notes._date_range(date_from, date_to)
    if side is not None:
        side = notes._text_arg(side, "side").lower()
        side = {"买": "buy", "买入": "buy", "卖": "sell", "卖出": "sell"}.get(side, side)
        if side not in {"buy", "sell"}:
            raise ToolFailure("INVALID_ARGS", "side must be Buy or Sell.")
    trades = storage.list_trades()
    if asset is not None:
        trades = notes._matching(trades, notes._selector(asset))
    trades = [trade for trade in trades if notes._in_range(notes._trade_date(trade), start, end)
              and (side is None or str(trade.get("type") or "").lower() == side)]
    trades.sort(key=notes._sort_key, reverse=True)
    return {"trades": [notes._trade_fields(trade) for trade in trades[:limit]],
            "count": min(len(trades), limit), "total": len(trades), "truncated": len(trades) > limit,
            "summary": f"匹配 {len(trades)} 笔成交，按业务日期倒序返回 {min(len(trades), limit)} 笔；金额仅来自账本。" if trades else "没有匹配的成交。"}


def get_trade_stats(asset=None) -> dict:
    trades = storage.list_trades()
    if asset is not None:
        trades = notes._matching(trades, notes._selector(asset))
    trades = [trade for trade in trades if not behavior_insights._is_demo_trade(trade)]
    identities = notes._identities(trades)
    normalized = []
    for trade in trades:
        market, kind, value = identities[str(trade["id"])].split(":", 2)
        currency = str(trade.get("currency") or {"CN": "CNY", "HK": "HKD", "US": "USD"}.get(market, "")).upper()
        normalized.append({**trade, "market": market, "currency": currency,
                           "code": value if kind == "code" else "", "symbol": trade.get("symbol") or value})
    as_of = date.today()
    evidence = behavior_insights.closed_trade_evidence(as_of, normalized)
    currencies = sorted({trade["currency"] for trade in normalized})
    by_currency = {currency: behavior_insights.closed_trade_evidence(as_of, [trade for trade in normalized if trade["currency"] == currency])
                   for currency in currencies}
    return {"as_of": as_of.isoformat(), "period_start": behavior_insights._six_months_earlier(as_of).isoformat(),
            "trade_count": len(trades), "closed_trade_evidence": evidence, "by_currency": by_currency,
            "sample_limitation": "固定统计最近六个月平仓的已记录多头周期，使用更早买入记录匹配成本；缺失买入、数量或价格时无法验证盈亏。演示交易已排除，不做跨币种金额相加或汇率换算，也不代表完整账户收益。",
            "summary": f"读取 {len(trades)} 笔账本成交，六个月规则识别 {evidence['closed_trades']} 个平仓样本；盈亏按币种分别列示。"}
