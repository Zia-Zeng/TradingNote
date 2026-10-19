"""Deterministic daily portfolio state roll-forward.

Facts (opening snapshot, trades and closes) are inputs. Returned states are
derived and safe to rebuild whenever any historical input changes.
"""

from __future__ import annotations

from datetime import date
from typing import Any


def _key(row: dict[str, Any]) -> tuple[str, str, str]:
    market = str(row.get("market") or "CN").upper()
    currency = str(row.get("currency") or {"CN": "CNY", "HK": "HKD", "US": "USD"}.get(market, "CNY")).upper()
    code = str(row.get("code") or row.get("symbol") or "").upper()
    for suffix in (".SH", ".SS", ".SZ", ".BJ"):
        if market == "CN":
            code = code.removesuffix(suffix)
    return market, currency, code


def roll_portfolio(
    baseline: dict[str, Any],
    trades: list[dict[str, Any]],
    prices: dict[tuple[str, str, str], list[dict[str, Any]]],
    end_date: str,
) -> dict[str, Any]:
    """Roll from a dated full-account snapshot across provider close dates.

    Uses moving weighted-average cost. Daily P&L is the change in portfolio
    unrealized P&L plus realized P&L booked by that day's sells. A buy/sell
    cash flow is not itself P&L. Explicit trade fees are included in cost basis
    and realized P&L; absent fees are treated as zero.
    """
    baseline_date = str(baseline["as_of"])
    start = date.fromisoformat(baseline_date)
    end = date.fromisoformat(end_date)
    keys = {_key(row) for row in baseline.get("rows", [])}
    keys.update(_key(row) for row in trades if baseline_date < str(row.get("time") or row.get("trade_date") or "")[:10] <= end_date)
    closes = {key: {str(bar["date"]): float(bar["close"]) for bar in prices.get(key, []) if bar.get("date") and bar.get("close") is not None} for key in keys}
    session_dates = sorted({day for per_key in closes.values() for day in per_key if baseline_date <= day <= end_date})

    positions: dict[tuple[str, str, str], dict[str, Any]] = {}
    initial_values: dict[str, float] = {}
    baseline_complete = True
    for row in baseline.get("rows", []):
        key = _key(row)
        close = closes.get(key, {}).get(baseline_date)
        if close is None:
            close = row.get("market_price")
        qty = float(row.get("quantity") or 0)
        cost = float(row.get("average_cost") or 0)
        if close is None:
            baseline_complete = False
        else:
            initial_values[key[1]] = initial_values.get(key[1], 0.0) + qty * float(close)
        current = positions.setdefault(key, {"symbol": row.get("symbol") or key[2], "code": row.get("code") or key[2], "market": key[0], "currency": key[1], "quantity": 0.0, "average_cost": 0.0, "last_close": close})
        old_qty = float(current["quantity"])
        current["quantity"] = old_qty + qty
        current["average_cost"] = ((old_qty * float(current["average_cost"])) + qty * cost) / current["quantity"] if current["quantity"] else 0.0
        if close is not None:
            current["last_close"] = float(close)

    total_assets = baseline.get("total_assets")
    total_currency = str(baseline.get("total_assets_currency") or "CNY").upper()
    initial_cash = baseline.get("initial_cash")
    if initial_cash is None and total_assets is not None and baseline_complete and set(initial_values) <= {total_currency}:
        initial_cash = float(total_assets) - initial_values.get(total_currency, 0.0)
    total_assets_complete = initial_cash is not None and set(initial_values) <= {total_currency}
    cash: dict[str, float] = {total_currency: float(initial_cash)} if initial_cash is not None else {}

    trades_by_date: dict[str, list[dict[str, Any]]] = {}
    for trade in trades:
        trade_date = str(trade.get("time") or trade.get("trade_date") or "")[:10]
        if baseline_date < trade_date <= end_date:
            trades_by_date.setdefault(trade_date, []).append(trade)
    for items in trades_by_date.values():
        items.sort(key=lambda item: (str(item.get("time") or item.get("trade_date") or ""), str(item.get("id") or "")))

    days: list[dict[str, Any]] = []
    missing_dates: list[str] = []
    last_daily_unrealized: dict[str, float] = {}
    realized_to_date: dict[str, float] = {}
    # Establish the starting unrealized P&L at baseline, so the first reported
    # day is a change rather than the accumulated gain since purchase.
    for key, position in positions.items():
        close = position.get("last_close")
        if close is not None:
            ccy = key[1]
            last_daily_unrealized[ccy] = last_daily_unrealized.get(ccy, 0.0) + float(position["quantity"]) * (float(close) - float(position["average_cost"]))

    for day in session_dates:
        if day <= baseline_date:
            continue
        realized: dict[str, float] = {}
        for trade in trades_by_date.get(day, []):
            key = _key(trade)
            position = positions.setdefault(key, {"symbol": trade.get("symbol") or key[2], "code": trade.get("code") or key[2], "market": key[0], "currency": key[1], "quantity": 0.0, "average_cost": 0.0, "last_close": None})
            ccy = key[1]
            qty, price = float(trade.get("qty") or 0), float(trade.get("price") or 0)
            fee = float(trade.get("fee") or 0)
            gross_amount = qty * price
            if str(trade.get("type") or "").lower() == "buy":
                old_qty = float(position["quantity"])
                new_qty = old_qty + qty
                position["average_cost"] = ((old_qty * float(position["average_cost"])) + gross_amount + fee) / new_qty if new_qty else 0.0
                position["quantity"] = new_qty
                cash[ccy] = cash.get(ccy, 0.0) - gross_amount - fee
            else:
                old_qty = float(position["quantity"])
                sold = min(qty, old_qty)
                allocated_fee = fee * sold / qty if qty else 0.0
                realized[ccy] = realized.get(ccy, 0.0) + sold * (price - float(position["average_cost"])) - allocated_fee
                position["quantity"] = old_qty - sold
                if position["quantity"] <= 1e-10:
                    position["quantity"] = 0.0
                    position["average_cost"] = 0.0
                cash[ccy] = cash.get(ccy, 0.0) + gross_amount - fee

        day_unrealized: dict[str, float] = {}
        held_value: dict[str, float] = {}
        complete = True
        position_rows = []
        for key, position in positions.items():
            qty = float(position["quantity"])
            close = closes.get(key, {}).get(day)
            if close is None:
                if qty:
                    complete = False
                close = position.get("last_close")
            else:
                position["last_close"] = close
            if close is None:
                continue
            value = qty * float(close)
            unrealized = qty * (float(close) - float(position["average_cost"]))
            held_value[key[1]] = held_value.get(key[1], 0.0) + value
            day_unrealized[key[1]] = day_unrealized.get(key[1], 0.0) + unrealized
            if qty:
                position_rows.append({"symbol": position["symbol"], "code": position["code"], "market": key[0], "currency": key[1], "quantity": qty, "average_cost": round(float(position["average_cost"]), 8), "close": float(close), "market_value": round(value, 4), "unrealized_pnl": round(unrealized, 4)})

        currencies = set(day_unrealized) | set(last_daily_unrealized) | set(realized)
        pnl = {ccy: realized.get(ccy, 0.0) + day_unrealized.get(ccy, 0.0) - last_daily_unrealized.get(ccy, 0.0) for ccy in currencies}
        for currency, value in realized.items():
            realized_to_date[currency] = realized_to_date.get(currency, 0.0) + value
        state_assets = {ccy: held_value.get(ccy, 0.0) + cash.get(ccy, 0.0) for ccy in set(held_value) | set(cash)}
        if not complete:
            missing_dates.append(day)
        state = {"date": day, "cash_by_currency": {k: round(v, 4) for k, v in sorted(cash.items())}, "holdings_market_value_by_currency": {k: round(v, 4) for k, v in sorted(held_value.items())}, "total_assets_by_currency": {k: round(v, 4) for k, v in sorted(state_assets.items())}, "total_assets_complete": total_assets_complete, "realized_pnl_by_currency": {k: round(v, 4) for k, v in sorted(realized.items())}, "realized_pnl_to_date_by_currency": {k: round(v, 4) for k, v in sorted(realized_to_date.items())}, "unrealized_pnl_by_currency": {k: round(v, 4) for k, v in sorted(day_unrealized.items())}, "holding_pnl_by_currency": {k: round(realized_to_date.get(k, 0.0) + day_unrealized.get(k, 0.0), 4) for k in sorted(set(realized_to_date) | set(day_unrealized))}, "positions": position_rows, "complete": complete}
        days.append({**state, "pnl_by_currency": {k: round(v, 4) for k, v in sorted(pnl.items())}, "daily_state": state})
        last_daily_unrealized = day_unrealized

    return {"baseline_date": baseline_date, "days": days, "incomplete_dates": missing_dates, "warnings": ["Daily P&L includes realized P&L on sells and the daily change in unrealized P&L. Moving weighted-average cost includes explicitly recorded trade fees; absent fees are treated as zero. Taxes and corporate actions are excluded."]}
