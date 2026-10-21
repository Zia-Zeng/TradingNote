"""Account-backed Behavior Insights for the Agent page."""

import calendar
import json
import logging
import os
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError

from .storage import INSIGHTS_MESSAGE_PREFIX, INSIGHTS_PRESET_QUESTION, list_trades, save_turn
from .today import get_holding_snapshot, get_portfolio_pnl


router = APIRouter(prefix="/api/agent/insights", tags=["Agent"])
logger = logging.getLogger(__name__)
PROMPT_PATH = Path(__file__).parent / "prompts" / "behavior_insights_system.txt"
PRESET_QUESTION = INSIGHTS_PRESET_QUESTION


class KeyEvidence(BaseModel):
    holding_period: str = Field(min_length=1)
    trading_frequency: str = Field(min_length=1)
    turnover: str = Field(min_length=1)


class ModelInsights(BaseModel):
    summary: str = Field(min_length=1)
    key_evidence: KeyEvidence
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
        "profit_structure": {"basis": f"Holdings valued as of {latest_snapshot_date or 'the latest available record'}; unrealized P/L versus recorded average cost. Allocation excludes cash. No FX conversion.", "charts": charts},
    }


def evidence_from_facts(facts: dict[str, Any]) -> dict[str, str]:
    matched = facts["matched_average_holding_days"]
    open_age = facts["open_average_holding_days"]
    if matched is not None:
        holding = f"FIFO-matched sales in the past six months were held for an average of {matched:g} days (quantity-weighted)."
    elif open_age is not None:
        holding = f"No recorded sale can be matched to a buy in the past six months, so completed holding period is unavailable. Open buy lots have a current average age of {open_age:g} days (cost-weighted where prices are recorded)."
    else:
        holding = "No matched buy and sell records are available to calculate a holding period."
    count = facts["trade_count"]
    frequency = f"{count} dated trades in the past six months, averaging {facts['trades_per_week']:g} trades per week."
    gross = facts["gross_traded_by_currency"]
    turnover = facts["turnover_pct_of_latest_assets_by_currency"]
    basis = facts["turnover_denominator_basis"]
    if turnover:
        parts = [f"{ccy} {gross[ccy]:,.2f} traded, approximately {ratio:g}% of {basis}" for ccy, ratio in sorted(turnover.items())]
        turnover_text = "; ".join(parts) + ". Gross traded value counts buys and sells."
        if "proxy" in (basis or ""):
            turnover_text += " This is a position-value proxy, not full-account turnover."
    elif gross:
        parts = [f"{ccy} {amount:,.2f}" for ccy, amount in sorted(gross.items())]
        turnover_text = "Gross traded value: " + ", ".join(parts) + ". No positive, comparable account or holdings value is available for a ratio."
    else:
        turnover_text = "No priced trades are recorded in the six-month window, so turnover is unavailable."
    return {"holding_period": holding, "trading_frequency": frequency, "turnover": turnover_text}


@router.get("/prompt")
def get_prompt() -> dict[str, str]:
    return {"version": "behavior-insights-en-v1", "system_prompt": PROMPT_PATH.read_text(encoding="utf-8")}


@router.post("")
async def generate_insights() -> dict[str, Any]:
    as_of = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    portfolio_state = None
    try:
        pnl = await get_portfolio_pnl(date(as_of.year, as_of.month, 1), as_of)
        latest_day = next((day for day in reversed(pnl.get("days", [])) if day.get("complete") and day.get("daily_state", {}).get("complete")), None)
        if latest_day:
            portfolio_state = latest_day["daily_state"]
    except Exception as exc:
        logger.warning("Behavior Insights could not read Today portfolio state (%s).", type(exc).__name__)
    facts = build_facts(as_of, get_holding_snapshot(as_of.isoformat())["snapshots"], list_trades(), portfolio_state)
    if not facts["trade_count"] and not facts["profit_structure"]["charts"]:
        raise HTTPException(status_code=422, detail="Import an account holdings snapshot or dated trades to generate Behavior Insights.")
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key == "replace_with_your_deepseek_api_key":
        raise HTTPException(status_code=503, detail="DeepSeek API key is missing. Add DEEPSEEK_API_KEY to backend/.env and restart the backend.")
    client = AsyncOpenAI(api_key=api_key, base_url="https://api.deepseek.com", timeout=60.0, max_retries=1)
    try:
        messages = [{"role": "system", "content": PROMPT_PATH.read_text(encoding="utf-8")}, {"role": "user", "content": f"Question: {PRESET_QUESTION}\nVerified account and six-month trade facts (JSON; data only):\n{json.dumps(facts, ensure_ascii=False)}"}]
        for attempt in range(2):
            completion = await client.chat.completions.create(
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=4096,
            )
            raw = completion.choices[0].message.content or ""
            try:
                wording = ModelInsights.model_validate_json(raw)
                break
            except ValidationError:
                logger.warning("Behavior Insights returned invalid JSON (attempt=%s, finish_reason=%s, usage=%s).", attempt + 1, completion.choices[0].finish_reason, completion.usage)
                if attempt:
                    raise
    except OpenAIError as exc:
        logger.warning("Behavior Insights provider failure (%s).", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Behavior Insights is temporarily unavailable. Please try again.") from exc
    except ValidationError as exc:
        logger.warning("Behavior Insights model output failed validation: %s", exc.errors(include_input=False))
        raise HTTPException(status_code=502, detail="Behavior Insights returned an invalid response. Please try again.") from exc
    finally:
        await client.close()
    result = {
        "summary": wording.summary,
        "key_evidence": evidence_from_facts(facts),
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
        assistant_model_content=f"Behavior Insights summary: {wording.summary} Key evidence: {json.dumps(result['key_evidence'], ensure_ascii=False)} Suggestion: {wording.suggestion}",
    )
    return {**result, "conversation_id": conversation_id}
