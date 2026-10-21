"""Deterministic presentation model for the market and portfolio daily brief.

The existing P&L engine values recorded securities, but the app does not yet
have a complete cash-flow and FX ledger. Its result must therefore never be
presented as verified whole-account P&L.
"""

from __future__ import annotations

import math
from typing import Any


INDEX_NAMES = {
    "Shanghai Composite": "上证指数",
    "Shenzhen Component": "深证成指",
    "ChiNext": "创业板指",
    "CSI 300": "沪深300",
    "Hang Seng Index": "恒生指数",
    "S&P 500": "标普500",
    "Bitcoin": "比特币",
}
SECTOR_NAMES = {
    "Energy": "能源", "Materials": "原材料", "Industrials": "工业",
    "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费",
    "Health Care": "医疗保健", "Financials": "金融", "Real Estate": "房地产",
    "Information Technology": "信息技术", "Communication Services": "通信服务",
    "Utilities": "公用事业",
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
        change = _number(row.get("change_pct"))
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None:
            continue
        indices.append({
            "name": INDEX_NAMES.get(str(row.get("name")), str(row.get("name") or "指数")),
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
            "name": SECTOR_NAMES.get(str(row.get("name")), str(row.get("name") or "行业")),
            "change_pct": round(change, 2), "related_holdings": holdings[:3],
            "date": review_date, "source": row.get("source"),
        })
    sectors = sectors[:2]

    market_sectors = []
    for row in context.get("market_sector_performance", []):
        change = _number(row.get("change_pct"))
        if row.get("status") != "complete" or row.get("date", review_date) != review_date or change is None:
            continue
        market_sectors.append({
            "name": SECTOR_NAMES.get(str(row.get("name")), str(row.get("name") or "行业")),
            "change_pct": round(change, 2),
        })
    leaders = sorted(market_sectors, key=lambda item: item["change_pct"], reverse=True)[:2]
    laggards = sorted(market_sectors, key=lambda item: item["change_pct"])[:2]

    warnings = []
    if not indices:
        warnings.append("该日期缺少可核实的指数行情。")
    market_text = "、".join(f"{item['name']}{_signed_percent(item['change_pct'])}" for item in indices)
    if market_text:
        market_text += "。"
    if not market_text:
        market_text = "市场数据暂不可用。"

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
        "根据已记录持仓和成交估算证券当日损益；尚未核实为账户实际盈亏。"
        if amounts else "账户当日盈亏暂不可核实。"
    )
    if amounts:
        warnings.append("缺少完整资金流水、费用及汇率核对；所列金额仅为已记录证券的估算。")
    else:
        warnings.append("缺少可完整核算的持仓和交易数据，暂不显示盈亏及归因。")

    winners: list[dict[str, Any]] = []
    losers: list[dict[str, Any]] = []
    if len(amounts) > 1:
        warnings.append("各币种尚未按统一汇率换算，暂不跨币种排列证券贡献。")
    if portfolio_status == "estimated" and len(amounts) == 1:
        for currency in [amounts[0]["currency"]]:
            rows = []
            for item in result.get("attribution", []):
                value = _number(item.get("pnl"))
                if item.get("currency") == currency and value is not None:
                    rows.append({
                        "name": str(item.get("symbol") or item.get("code") or "未知证券"),
                        "code": item.get("code"), "currency": currency,
                        "amount": round(value, 2), "status": "estimated",
                    })
            reported = next(row["amount"] for row in amounts if row["currency"] == currency)
            if abs(sum(row["amount"] for row in rows) - reported) > max(0.05, abs(reported) * 0.0001):
                warnings.append(f"{currency} 的证券贡献与估算总额未对齐，已隐藏该币种归因。")
                continue
            winners.extend(sorted((row for row in rows if row["amount"] > 0), key=lambda row: -row["amount"])[:3])
            losers.extend(sorted((row for row in rows if row["amount"] < 0), key=lambda row: row["amount"])[:3])

    return {
        "report_type": "market_portfolio_daily_brief",
        "review_date": review_date,
        "overall_status": "partial" if indices or amounts else "unavailable",
        "market": {"indices": indices, "sectors": sectors, "leaders": leaders, "laggards": laggards, "text": market_text},
        "portfolio": {
            "status": portfolio_status, "scope": "recorded_securities",
            "amounts": amounts, "daily_return_pct": None, "text": portfolio_text,
        },
        "winners": winners[:3], "losers": losers[:3],
        "caveats": warnings[:3],
    }
