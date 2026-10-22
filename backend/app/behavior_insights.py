"""Account-backed Behavior Insights for the Agent page."""

import calendar
import asyncio
import json
import logging
import os
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError

from .storage import INSIGHTS_MESSAGE_PREFIX, INSIGHTS_PRESET_QUESTION, list_trades, save_turn
from .cached_history import cached_daily_history
from .today import get_holding_snapshot, get_portfolio_pnl


router = APIRouter(prefix="/api/agent/insights", tags=["Agent"])
logger = logging.getLogger(__name__)
PROMPT_PATH = Path(__file__).parent / "prompts" / "behavior_insights_system.txt"
PRESET_QUESTION = INSIGHTS_PRESET_QUESTION


class StyleProfile(BaseModel):
    transaction_pace: str = Field(min_length=1)
    holding_period: str = Field(min_length=1)
    asset_selection: str = Field(min_length=1)
    positioning_method: str = Field(min_length=1)
    trading_type: str = Field(min_length=1)
    main_issues: str = Field(min_length=1)


STYLE_PROFILE_OPTION_LABELS = {
    "transaction_pace": "Trading pace",
    "holding_period": "Holding period",
    "asset_selection": "Asset Selection",
    "positioning_method": "positioning_method",
    "trading_type": "trading_type",
    "main_issues": "Main Issues",
}


def _style_profile_options(prompt: str) -> dict[str, tuple[str, ...]]:
    options = {}
    for field, label in STYLE_PROFILE_OPTION_LABELS.items():
        matches = [line[len(label) + 1:].strip() for line in prompt.splitlines() if line.startswith(f"{label}:")]
        if len(matches) != 1:
            raise ValueError(f"Prompt must contain exactly one '{label}:' option line.")
        choices = tuple(choice.strip() for choice in matches[0].split("|"))
        if not choices or any(not choice for choice in choices) or len(set(choices)) != len(choices):
            raise ValueError(f"Prompt has invalid options for '{label}'.")
        options[field] = choices
    return options


def _validate_style_profile(profile: StyleProfile, options: dict[str, tuple[str, ...]]) -> None:
    invalid = [field for field, choices in options.items() if getattr(profile, field) not in choices]
    if invalid:
        raise ValueError(f"Style Profile has values outside the prompt options: {', '.join(invalid)}")


class TradingCharacteristic(BaseModel):
    title: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    significance: str = Field(min_length=1)


class ModelInsights(BaseModel):
    summary: str = Field(min_length=1)
    style_label: str = Field(min_length=1)
    style_profile: StyleProfile
    trading_characteristics: list[TradingCharacteristic] = Field(max_length=4)
    profit_structure: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)


def _six_months_earlier(day: date) -> date:
    month_index = day.year * 12 + day.month - 1 - 6
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _trade_day(trade: dict[str, Any]) -> date | None:
    for field in ("time", "date", "trade_date"):
        raw = str(trade.get(field) or "")[:10].replace("/", "-")
        try:
            return date.fromisoformat(raw)
        except ValueError:
            continue
    return None


def _number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (ValueError, TypeError):
        return None


def _instrument_key(trade: dict[str, Any]) -> str:
    code = str(trade.get("code") or trade.get("symbol") or "").strip().upper()
    if str(trade.get("market") or "CN").upper() == "CN":
        for suffix in (".SH", ".SS", ".SZ", ".BJ"):
            code = code.removesuffix(suffix)
    return code


def _position_key(row: dict[str, Any]) -> tuple[str, str, str]:
    market = str(row.get("market") or "CN").upper()
    if market in {"A-SHARE", "A_SHARE"}:
        market = "CN"
    currency = str(row.get("currency") or {"CN": "CNY", "US": "USD", "HK": "HKD"}.get(market, "CNY")).upper()
    code = str(row.get("code") or row.get("symbol") or "").strip().upper()
    if market == "CN":
        for suffix in (".SH", ".SS", ".SZ", ".BJ"):
            code = code.removesuffix(suffix)
    return market, currency, code


def _is_demo_trade(trade: dict[str, Any]) -> bool:
    motive = trade.get("motive") or {}
    return str(trade.get("id") or "").startswith("demo-") or (
        isinstance(motive, dict) and "not a real transaction" in str(motive.get("desc") or "").lower()
    )


def _missing_ledger_positions(as_of: date, trades: list[dict[str, Any]], existing: set[tuple[str, str, str]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[tuple[date, dict[str, Any]]]] = defaultdict(list)
    for trade in trades:
        day = _trade_day(trade)
        if day and day <= as_of and trade.get("type") in {"Buy", "Sell"}:
            grouped[_position_key(trade)].append((day, trade))
    missing = []
    for key, records in grouped.items():
        if key in existing or not key[2]:
            continue
        records.sort(key=lambda item: (item[0], str(item[1].get("time") or "")))
        quantity = sum((_number(trade.get("qty")) or 0) * (1 if trade["type"] == "Buy" else -1) for _, trade in records)
        if quantity <= 1e-9:
            continue
        remaining, cost_basis = quantity, 0.0
        for _, trade in reversed(records):
            if trade["type"] != "Buy":
                continue
            used = min(remaining, _number(trade.get("qty")) or 0)
            price = _number(trade.get("price"))
            if price is None:
                cost_basis = None
            elif cost_basis is not None:
                cost_basis += used * price
            remaining -= used
            if remaining <= 1e-9:
                break
        last = records[-1][1]
        missing.append({"symbol": last.get("symbol") or key[2], "code": last.get("code") or key[2],
                        "market": key[0], "currency": key[1], "quantity": quantity,
                        "average_cost": cost_basis / quantity if cost_basis is not None and remaining <= 1e-9 else None})
    return missing


async def _complete_holdings(as_of: date, snapshots: list[dict[str, Any]], trades: list[dict[str, Any]], portfolio_state: dict[str, Any] | None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    rows = list(portfolio_state.get("positions") or []) if portfolio_state and portfolio_state.get("complete") else [row for snapshot in snapshots for row in snapshot["rows"]]
    missing = _missing_ledger_positions(as_of, trades, {_position_key(row) for row in rows})
    if not missing:
        return snapshots, portfolio_state

    valuation_date = date.fromisoformat(str(portfolio_state.get("date"))) if portfolio_state and portfolio_state.get("complete") else as_of
    async def value(row: dict[str, Any]) -> dict[str, Any]:
        try:
            history = await cached_daily_history(str(row["code"]), str(row["market"]), valuation_date - timedelta(days=14), valuation_date)
            if history.get("latest_close") is not None:
                return {**row, "market_value": row["quantity"] * float(history["latest_close"])}
        except Exception as exc:
            logger.warning("Behavior Insights could not value %s:%s (%s).", row["market"], row["code"], type(exc).__name__)
        return row

    supplemented = await asyncio.gather(*(value(row) for row in missing))
    combined_rows = [*rows, *supplemented]
    holdings_value: dict[str, float] = defaultdict(float)
    for row in combined_rows:
        quantity = _number(row.get("quantity")) or 0
        market_value = _number(row.get("market_value"))
        close = _number(row.get("close") or row.get("market_price"))
        if market_value is None and close is not None:
            market_value = quantity * close
        if market_value is not None and quantity > 0:
            holdings_value[_position_key(row)[1]] += market_value
    state = dict(portfolio_state or {})
    state.update({"date": valuation_date.isoformat(), "complete": True, "positions": combined_rows,
                  "total_assets_complete": False, "total_assets_by_currency": {},
                  "holdings_market_value_by_currency": dict(holdings_value)})
    # The uploaded snapshot omitted open ledger holdings, so its account-total
    # denominator cannot describe the combined positions.
    snapshots = [{**snapshot, "total_assets": None} for snapshot in snapshots]
    return snapshots, state


def closed_trade_evidence(as_of: date, trades: list[dict[str, Any]]) -> dict[str, Any]:
    start = _six_months_earlier(as_of)
    records = sorted(
        ((day, trade) for trade in trades if (day := _trade_day(trade)) and day <= as_of and trade.get("type") in {"Buy", "Sell"}),
        key=lambda item: (item[0], str(item[1].get("time") or "")),
    )
    cycles: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(lambda: {
        "lots": deque(), "pnl": 0.0, "holding_days": 0.0, "sold_qty": 0.0,
        "priced": True, "trade_count": 0,
    })
    exits = []
    for day, trade in records:
        quantity = _number(trade.get("qty")) or 0
        if quantity <= 0:
            continue
        key = _position_key(trade)
        cycle = cycles[key]
        price = _number(trade.get("price"))
        fee = _number(trade.get("fee")) or 0
        if trade["type"] == "Buy":
            cycle["lots"].append((day, quantity, price + fee / quantity if price is not None else None))
            cycle["priced"] = cycle["priced"] and price is not None
            cycle["trade_count"] += 1
            continue
        if not cycle["lots"]:
            continue
        cycle["trade_count"] += 1
        cycle["priced"] = cycle["priced"] and price is not None
        remaining = quantity
        while remaining > 1e-9 and cycle["lots"]:
            bought, available, cost = cycle["lots"][0]
            matched = min(remaining, available)
            if price is not None and cost is not None:
                cycle["pnl"] += matched * (price - cost) - fee * matched / quantity
            cycle["holding_days"] += matched * (day - bought).days
            cycle["sold_qty"] += matched
            remaining -= matched
            if matched >= available - 1e-9:
                cycle["lots"].popleft()
            else:
                cycle["lots"][0] = (bought, available - matched, cost)
        if not cycle["lots"]:
            if day >= start:
                exits.append({"currency": key[1], "verified": remaining <= 1e-9 and cycle["priced"],
                              "pnl": cycle["pnl"], "holding_days": cycle["holding_days"], "sold_qty": cycle["sold_qty"],
                              "trade_count": cycle["trade_count"]})
            cycles[key] = {"lots": deque(), "pnl": 0.0, "holding_days": 0.0,
                           "sold_qty": 0.0, "priced": True, "trade_count": 0}

    verified = [exit for exit in exits if exit["verified"]]
    involved = sum(exit["trade_count"] for exit in exits)
    matched_qty = sum(exit["sold_qty"] for exit in verified)
    avg_days = sum(exit["holding_days"] for exit in verified) / matched_qty if matched_qty else None
    pnl_by_currency: dict[str, float] = defaultdict(float)
    for exit in verified:
        pnl_by_currency[exit["currency"]] += exit["pnl"]
    return {
        "closed_trades": len(exits),
        "trades_involved": involved,
        "average_holding_days": round(avg_days, 2) if avg_days is not None else None,
        "win_rate_pct": round(100 * sum(exit["pnl"] > 0 for exit in verified) / len(verified), 2) if verified else None,
        "total_closed_pnl_by_currency": {currency: round(amount, 2) for currency, amount in sorted(pnl_by_currency.items())}
        if exits and len(verified) == len(exits) else None,
    }


def build_facts(as_of: date, snapshots: list[dict[str, Any]], trades: list[dict[str, Any]], portfolio_state: dict[str, Any] | None = None) -> dict[str, Any]:
    start = _six_months_earlier(as_of)
    recent = []
    all_dated = []
    for trade in trades:
        day = _trade_day(trade)
        if day and day <= as_of and trade.get("type") in {"Buy", "Sell"}:
            all_dated.append((day, trade))
            if day >= start:
                recent.append((day, trade))
    all_dated.sort(key=lambda item: (item[0], str(item[1].get("time") or "")))
    recent.sort(key=lambda item: (item[0], str(item[1].get("time") or "")))

    lots: dict[tuple[str, str], deque[tuple[date, float, float | None]]] = defaultdict(deque)
    holding_day_total = 0.0
    matched_quantity = 0.0
    for day, trade in all_dated:
        symbol = _instrument_key(trade)
        currency = str(trade.get("currency") or "CNY").upper()
        qty = _number(trade.get("qty")) or 0
        if not symbol or qty <= 0:
            continue
        queue = lots[(symbol, currency)]
        if trade["type"] == "Buy":
            queue.append((day, qty, _number(trade.get("price"))))
        else:
            remaining = qty
            while remaining > 0 and queue:
                bought, available, buy_price = queue[0]
                matched = min(remaining, available)
                if day >= start:
                    holding_day_total += (day - bought).days * matched
                    matched_quantity += matched
                remaining -= matched
                if matched == available:
                    queue.popleft()
                else:
                    queue[0] = (bought, available - matched, buy_price)

    open_age_weighted_total = 0.0
    open_age_weight = 0.0
    open_lot_count = 0
    for queue in lots.values():
        for bought, available, buy_price in queue:
            if available <= 0:
                continue
            weight = available * buy_price if buy_price is not None and buy_price > 0 else available
            open_age_weighted_total += (as_of - bought).days * weight
            open_age_weight += weight
            open_lot_count += 1

    gross_by_currency: dict[str, float] = defaultdict(float)
    for _, trade in recent:
        price, qty = _number(trade.get("price")), _number(trade.get("qty"))
        if price is not None and qty is not None:
            gross_by_currency[str(trade.get("currency") or "CNY").upper()] += price * qty

    account_assets: dict[str, float] = defaultdict(float)
    positions: dict[tuple[str, str], dict[str, Any]] = {}
    latest_snapshot_date = None
    for snapshot in snapshots:
        snapshot_date = snapshot.get("as_of")
        if snapshot_date and (latest_snapshot_date is None or snapshot_date > latest_snapshot_date):
            latest_snapshot_date = snapshot_date
        total = _number(snapshot.get("total_assets"))
        currency = str(snapshot.get("total_assets_currency") or "").upper()
        if total is not None and total > 0 and currency:
            account_assets[currency] += total
        for row in snapshot.get("rows", []):
            qty = _number(row.get("quantity")) or 0
            if qty <= 0:
                continue
            ccy = str(row.get("currency") or currency or "CNY").upper()
            symbol = str(row.get("symbol") or row.get("code") or "Unknown").strip()
            code = str(row.get("code") or "").strip()
            value = _number(row.get("market_value"))
            price = _number(row.get("market_price"))
            cost = _number(row.get("average_cost"))
            if value is None and price is not None:
                value = qty * price
            key = (code or symbol, ccy)
            item = positions.setdefault(key, {"symbol": symbol, "code": code or None, "currency": ccy, "market_value": 0.0, "cost_basis": 0.0, "value_complete": True, "cost_complete": True})
            item["market_value"] += value or 0
            item["cost_basis"] += qty * (cost or 0)
            item["value_complete"] = item["value_complete"] and value is not None
            item["cost_complete"] = item["cost_complete"] and cost is not None

    turnover_basis = f"full-account assets as of {latest_snapshot_date}" if account_assets and latest_snapshot_date else None
    if portfolio_state and portfolio_state.get("complete"):
        state_date = str(portfolio_state.get("date") or "")
        if state_date:
            latest_snapshot_date = state_date
        if portfolio_state.get("total_assets_complete"):
            state_assets = {str(ccy).upper(): amount for ccy, value in portfolio_state.get("total_assets_by_currency", {}).items() if (amount := _number(value)) is not None and amount > 0}
            if state_assets:
                account_assets = state_assets
                turnover_basis = f"Today Portfolio Overview full-account assets as of {state_date}"
        state_positions = {}
        for row in portfolio_state.get("positions", []):
            qty = _number(row.get("quantity")) or 0
            if qty <= 0:
                continue
            ccy = str(row.get("currency") or "CNY").upper()
            code = str(row.get("code") or "").strip()
            symbol = str(row.get("symbol") or code or "Unknown").strip()
            value = _number(row.get("market_value"))
            cost = _number(row.get("average_cost"))
            key = (code or symbol, ccy)
            item = state_positions.setdefault(key, {"symbol": symbol, "code": code or None, "currency": ccy, "market_value": 0.0, "cost_basis": 0.0, "value_complete": True, "cost_complete": True})
            item["market_value"] += value or 0
            item["cost_basis"] += qty * (cost or 0)
            item["value_complete"] = item["value_complete"] and value is not None
            item["cost_complete"] = item["cost_complete"] and cost is not None
        if state_positions:
            positions = state_positions

    if not account_assets:
        if portfolio_state and portfolio_state.get("complete"):
            account_assets = {str(ccy).upper(): amount for ccy, value in portfolio_state.get("holdings_market_value_by_currency", {}).items() if (amount := _number(value)) is not None and amount > 0}
            if account_assets:
                turnover_basis = f"Today Portfolio Overview holdings market value as of {state_date} (cash excluded; proxy)"
        if not account_assets:
            account_assets = {ccy: sum(item["market_value"] for item in positions.values() if item["currency"] == ccy and item["value_complete"] and item["market_value"] > 0) for ccy in {item["currency"] for item in positions.values()}}
            account_assets = {ccy: value for ccy, value in account_assets.items() if value > 0}
            if account_assets:
                turnover_basis = f"recorded holdings market value as of {latest_snapshot_date} (cash excluded; proxy)" if latest_snapshot_date else "recorded holdings market value (cash excluded; proxy)"

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in positions.values():
        grouped[item["currency"]].append(item)
    charts = []
    for currency, items in sorted(grouped.items()):
        total_value = sum(item["market_value"] for item in items if item["value_complete"])
        allocation = []
        returns = []
        for item in sorted(items, key=lambda entry: entry["market_value"], reverse=True):
            value = round(item["market_value"], 2) if item["value_complete"] else None
            pnl = round(item["market_value"] - item["cost_basis"], 2) if item["value_complete"] and item["cost_complete"] else None
            basis = item["cost_basis"]
            allocation.append({"symbol": item["symbol"], "code": item["code"], "market_value": value, "share_pct": round(100 * value / total_value, 2) if value is not None and total_value > 0 else None})
            returns.append({"symbol": item["symbol"], "code": item["code"], "pnl": pnl, "return_pct": round(100 * pnl / basis, 2) if pnl is not None and basis > 0 else None})
        charts.append({"currency": currency, "allocation": allocation, "returns": returns})

    turnover = {currency: round(gross / account_assets[currency] * 100, 2) for currency, gross in gross_by_currency.items() if account_assets.get(currency, 0) > 0}
    return {
        "period_start": start.isoformat(), "period_end": as_of.isoformat(),
        "holdings_as_of": latest_snapshot_date,
        "account_assets_by_currency": dict(account_assets),
        "trade_count": len(recent),
        "trades_per_week": round(len(recent) / max((as_of - start).days / 7, 1), 2),
        "matched_average_holding_days": round(holding_day_total / matched_quantity, 1) if matched_quantity else None,
        "matched_sold_quantity": round(matched_quantity, 4),
        "open_average_holding_days": round(open_age_weighted_total / open_age_weight, 1) if open_age_weight else None,
        "open_lot_count": open_lot_count,
        "gross_traded_by_currency": {key: round(value, 2) for key, value in gross_by_currency.items()},
        "turnover_pct_of_latest_assets_by_currency": turnover,
        "turnover_denominator_basis": turnover_basis,
        "instruments": sorted({str(t.get("symbol") or t.get("code")) for _, t in recent} | {item["symbol"] for item in positions.values()}),
        "recent_trades": [{
            "date": day.isoformat(), "symbol": trade.get("symbol"), "code": trade.get("code"),
            "action": trade.get("type"), "price": trade.get("price"), "quantity": trade.get("qty"),
            "currency": trade.get("currency"),
        } for day, trade in recent[-100:]],
        "recent_trades_truncated": len(recent) > 100,
        "closed_trade_evidence": closed_trade_evidence(as_of, trades),
        "profit_structure": {"basis": f"Holdings valued as of {latest_snapshot_date or 'the latest available record'}; unrealized P/L versus recorded average cost. Allocation excludes cash. No FX conversion.", "charts": charts},
    }


@router.get("/prompt")
def get_prompt() -> dict[str, str]:
    return {"version": "behavior-insights-evidence-v4", "system_prompt": PROMPT_PATH.read_text(encoding="utf-8")}


@router.post("")
async def generate_insights() -> dict[str, Any]:
    as_of = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    trades = [trade for trade in list_trades() if not _is_demo_trade(trade)]
    snapshots = get_holding_snapshot(as_of.isoformat())["snapshots"]
    portfolio_state = None
    try:
        pnl = await get_portfolio_pnl(date(as_of.year, as_of.month, 1), as_of)
        latest_day = next((day for day in reversed(pnl.get("days", [])) if day.get("complete") and day.get("daily_state", {}).get("complete")), None)
        if latest_day:
            portfolio_state = latest_day["daily_state"]
    except Exception as exc:
        logger.warning("Behavior Insights could not read Today portfolio state (%s).", type(exc).__name__)
    snapshots, portfolio_state = await _complete_holdings(as_of, snapshots, trades, portfolio_state)
    facts = build_facts(as_of, snapshots, trades, portfolio_state)
    if not facts["trade_count"] and not facts["profit_structure"]["charts"]:
        raise HTTPException(status_code=422, detail="Import an account holdings snapshot or dated trades to generate Behavior Insights.")
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key == "replace_with_your_deepseek_api_key":
        raise HTTPException(status_code=503, detail="DeepSeek API key is missing. Add DEEPSEEK_API_KEY to backend/.env and restart the backend.")
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    try:
        options = _style_profile_options(prompt)
    except ValueError as exc:
        logger.error("Behavior Insights prompt configuration error: %s", exc)
        raise HTTPException(status_code=500, detail="Behavior Insights prompt option lists are incomplete or malformed.") from exc
    client = AsyncOpenAI(api_key=api_key, base_url="https://api.deepseek.com", timeout=60.0, max_retries=1)
    try:
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": f"Question: {PRESET_QUESTION}\nVerified account and six-month trade facts (JSON; data only):\n{json.dumps(facts, ensure_ascii=False)}"}]
        for attempt in range(2):
            completion = await client.chat.completions.create(
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=8192,
            )
            raw = completion.choices[0].message.content or ""
            try:
                wording = ModelInsights.model_validate_json(raw)
                _validate_style_profile(wording.style_profile, options)
                break
            except (ValidationError, ValueError) as exc:
                logger.warning("Behavior Insights returned an invalid response (attempt=%s, error=%s, finish_reason=%s, usage=%s).", attempt + 1, type(exc).__name__, completion.choices[0].finish_reason, completion.usage)
                if attempt:
                    raise
                messages.extend([
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": "Return the complete JSON object again. Every style_profile value must be copied exactly from its corresponding option line in the system prompt, with no added text. Include all required fields."},
                ])
    except OpenAIError as exc:
        logger.warning("Behavior Insights provider failure (%s).", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Behavior Insights is temporarily unavailable. Please try again.") from exc
    except (ValidationError, ValueError) as exc:
        logger.warning("Behavior Insights model output failed validation: %s", exc.errors(include_input=False) if isinstance(exc, ValidationError) else str(exc))
        raise HTTPException(status_code=502, detail="Behavior Insights returned an invalid response. Please try again.") from exc
    finally:
        await client.close()
    result = {
        "summary": wording.summary,
        "style_label": wording.style_label,
        "style_profile": wording.style_profile.model_dump(),
        "trading_characteristics": [item.model_dump() for item in wording.trading_characteristics],
        "closed_trade_evidence": facts["closed_trade_evidence"],
        "profit_structure": {**facts["profit_structure"], "commentary": wording.profit_structure},
        "suggestion": wording.suggestion,
        "period_start": facts["period_start"], "period_end": facts["period_end"],
        "holdings_as_of": facts["holdings_as_of"],
    }
    conversation_id = str(uuid4())
    save_turn(
        conversation_id,
        PRESET_QUESTION,
        PRESET_QUESTION,
        INSIGHTS_MESSAGE_PREFIX + json.dumps(result, ensure_ascii=False),
        datetime.now(timezone.utc).isoformat(),
        title=PRESET_QUESTION,
        assistant_model_content=f"Behavior Insights summary: {wording.summary} Closed trade evidence: {json.dumps(result['closed_trade_evidence'], ensure_ascii=False)} Suggestion: {wording.suggestion}",
    )
    return {**result, "conversation_id": conversation_id}
