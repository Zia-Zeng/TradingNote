"""Deterministic presentation model for the market and portfolio daily brief.

The existing P&L engine values recorded securities, but the app does not yet
have a complete cash-flow and FX ledger. Its result must therefore never be
presented as verified whole-account P&L.
"""

from __future__ import annotations

import math
from typing import Any


INDEX_NAMES = {
    "Shanghai Composite": "Shanghai Composite",
    "Shenzhen Component": "Shenzhen Component",
    "ChiNext": "ChiNext",
    "CSI 300": "CSI 300",
    "Hang Seng Index": "Hang Seng Index",
    "S&P 500": "S&P 500",
    "Bitcoin": "Bitcoin",
    "上证指数": "Shanghai Composite", "上证综指": "Shanghai Composite",
    "深证成指": "Shenzhen Component", "创业板指": "ChiNext",
    "沪深300": "CSI 300", "恒生指数": "Hang Seng Index",
    "标普500": "S&P 500", "比特币": "Bitcoin",
}
COMMODITY_NAMES = {"Gold futures": "Gold futures", "黄金期货": "Gold futures", "黄金现货": "Gold spot"}
SECTOR_NAMES = {
    "Energy": "Energy", "Materials": "Materials", "Industrials": "Industrials",
    "Consumer Discretionary": "Consumer Discretionary", "Consumer Staples": "Consumer Staples",
    "Health Care": "Health Care", "Financials": "Financials", "Real Estate": "Real Estate",
    "Information Technology": "Information Technology", "Communication Services": "Communication Services",
    "Utilities": "Utilities",
    "能源": "Energy", "原材料": "Materials", "工业": "Industrials",
    "可选消费": "Consumer Discretionary", "必需消费": "Consumer Staples",
    "医疗保健": "Health Care", "金融": "Financials", "房地产": "Real Estate",
    "信息技术": "Information Technology", "通信服务": "Communication Services",
    "公用事业": "Utilities",
}


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _signed_percent(value: float) -> str:
    return f"{value:+.2f}%"


def build_daily_brief(context: dict[str, Any]) -> dict[str, Any]:
    """Build display facts without LLM-generated figures or account claims."""
    review_date = context["trade_date"]
    indices = []
    for row in context.get("market_benchmarks", []):
        if str(row.get("market") or "").upper() == "COMMODITY":
            continue
        change = _number(row.get("change_pct"))
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None:
            continue
        indices.append({
            "name": INDEX_NAMES.get(str(row.get("name")), str(row.get("name") or "Index")),
            "change_pct": round(change, 2), "date": review_date,
            "source": row.get("source"),
        })
    indices = indices[:3]

    sectors = []
    for row in context.get("industry_performance", []):
        change = _number(row.get("change_pct"))
        holdings = [str(name) for name in row.get("related_holdings", []) if name]
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None or not holdings:
            continue
        sectors.append({
            "name": SECTOR_NAMES.get(str(row.get("name")), str(row.get("name") or "Sector")),
            "change_pct": round(change, 2), "related_holdings": holdings[:3],
            "date": review_date, "source": row.get("source"),
        })
    sectors = sectors[:2]

    commodities = []
    for row in context.get("market_commodities", []):
        change = _number(row.get("change_pct"))
        close = _number(row.get("close"))
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None or close is None:
            continue
        commodities.append({
            "name": COMMODITY_NAMES.get(str(row.get("name")), str(row.get("name") or "Commodity")),
            "code": row.get("code"), "close": round(close, 2),
            "change_pct": round(change, 2), "date": review_date,
            "currency": "USD", "unit": "oz",
            "source": row.get("source"),
        })
    market_sectors = []
    for row in context.get("market_sector_performance", []):
        change = _number(row.get("change_pct"))
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None:
            continue
        market_sectors.append({
            "name": SECTOR_NAMES.get(str(row.get("name")), str(row.get("name") or "Sector")),
            "change_pct": round(change, 2),
        })
    leaders = sorted(market_sectors, key=lambda item: item["change_pct"], reverse=True)[:2]
    laggards = sorted(market_sectors, key=lambda item: item["change_pct"])[:2]
    breadth = context.get("market_breadth")
    if not isinstance(breadth, dict) or breadth.get("status") != "complete":
        breadth = None

    warnings = []
    if not indices:
        warnings.append("Verified index data is unavailable for this date.")
    market_text = ", ".join(f"{item['name']} {_signed_percent(item['change_pct'])}" for item in indices)
    if market_text:
        market_text += "."
    if not market_text:
        market_text = "Market data is currently unavailable."
    if commodities and not indices:
        market_text = ""

    result = context.get("portfolio_result") or {}
    raw_pnl = result.get("pnl_by_currency") or {}
    amounts = []
    if context.get("portfolio_status") == "complete" and not result.get("snapshot_mismatch"):
        for currency, value in sorted(raw_pnl.items()):
            amount = _number(value)
            if amount is not None:
                amounts.append({"currency": currency, "amount": round(amount, 2)})
    portfolio_status = "estimated" if amounts else "unavailable"
    portfolio_text = (
        "Estimated daily P&L for recorded securities; this has not been reconciled against the full account balance."
        if amounts else "Daily portfolio P&L could not be verified."
    )
    if amounts:
        warnings.append("Cash flows, fees, and FX have not been fully reconciled; figures are estimates for recorded securities only.")
    else:
        warnings.append("Complete holdings and trade data are unavailable, so P&L and attribution are not shown.")

    winners: list[dict[str, Any]] = []
    losers: list[dict[str, Any]] = []
    contributions_by_market: list[dict[str, Any]] = []
    if portfolio_status == "estimated":
        # Attribute within each currency independently. Never rank or net
        # CNY/HKD/USD amounts against one another without an FX conversion.
        for currency in [item["currency"] for item in amounts]:
            rows = []
            for item in result.get("attribution", []):
                value = _number(item.get("pnl"))
                if item.get("currency") == currency and value is not None:
                    rows.append({
                        "name": str(item.get("symbol") or item.get("code") or "Unknown security"),
                        "code": item.get("code"), "currency": currency,
                        "amount": round(value, 2), "status": "estimated",
                    })
            reported = next(row["amount"] for row in amounts if row["currency"] == currency)
            if abs(sum(row["amount"] for row in rows) - reported) > max(0.05, abs(reported) * 0.0001):
                warnings.append(f"{currency} security contributions do not reconcile with the estimated total; attribution for this currency is hidden.")
                continue
            winners.extend(sorted((row for row in rows if row["amount"] > 0), key=lambda row: -row["amount"])[:3])
            losers.extend(sorted((row for row in rows if row["amount"] < 0), key=lambda row: row["amount"])[:3])
            market_keys = list(dict.fromkeys(
                str(item.get("market") or "OTHER").upper()
                for item in result.get("attribution", [])
                if item.get("currency") == currency and _number(item.get("pnl")) is not None
            ))
            for market in market_keys:
                market_rows = []
                for item in result.get("attribution", []):
                    value = _number(item.get("pnl"))
                    if item.get("currency") != currency or str(item.get("market") or "OTHER").upper() != market or value is None:
                        continue
                    market_rows.append({
                        "name": str(item.get("symbol") or item.get("code") or "Unknown security"),
                        "code": item.get("code"), "currency": currency,
                        "amount": round(value, 2), "status": "estimated", "market": market,
                    })
                market_winners = sorted((row for row in market_rows if row["amount"] > 0), key=lambda row: -row["amount"])[:3]
                market_losers = sorted((row for row in market_rows if row["amount"] < 0), key=lambda row: row["amount"])[:3]
                if market_winners or market_losers:
                    market_names = {"CN": "A-shares", "HK": "Hong Kong stocks", "US": "U.S. stocks", "CRYPTO": "Crypto"}
                    contributions_by_market.append({
                        "market": market, "market_name": market_names.get(market, market),
                        "currency": currency, "winners": market_winners, "losers": market_losers,
                    })

    return {
        "report_type": "market_portfolio_daily_brief",
        "review_date": review_date,
        "overall_status": "partial" if indices or commodities or amounts else "unavailable",
        "market": {"indices": indices, "sectors": sectors, "commodities": commodities, "leaders": leaders, "laggards": laggards, "breadth": breadth, "text": market_text},
        "portfolio": {
            "status": portfolio_status, "scope": "recorded_securities",
            "amounts": amounts, "daily_return_pct": None, "text": portfolio_text,
        },
        "winners": winners[:3] if len(amounts) <= 1 else [],
        "losers": losers[:3] if len(amounts) <= 1 else [],
        "contributions_by_market": contributions_by_market,
        "caveats": warnings[:3],
    }
