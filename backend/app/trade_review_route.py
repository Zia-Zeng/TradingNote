"""Deterministic day-level routing and per-trade evidence depth."""

from __future__ import annotations

from typing import Any


def route_trade_review(context: dict[str, Any]) -> dict[str, Any]:
    trades = context.get("today_trades") or []
    timelines = context.get("asset_timelines") or []
    active_plans = context.get("active_plans") or []
    day_notes = context.get("day_note_refs") or []
    asset_notes = context.get("asset_note_refs") or []
    trade_depths: dict[str, str] = {}
    for trade in trades:
        trade_id = str(trade.get("id") or "")
        timeline = next((item for item in timelines if trade_id in item.get("today_trade_ids", [])), {})
        plan = trade.get("plan") or {}
        motive = trade.get("motive") or {}
        own_plan = any(plan.get(key) not in (None, "", 0, "0") for key in ("tp", "sl", "desc"))
        own_motive = bool(motive.get("desc") or motive.get("tags"))
        own_note = bool(trade.get("note") or trade.get("notes"))
        related_note = bool(timeline.get("asset_note_refs") or timeline.get("daily_note_refs"))
        related_plan = any(item.get("asset_key") == timeline.get("asset_key") for item in active_plans)
        if own_plan or own_motive or own_note or related_note or related_plan:
            depth = "notes_based"
        else:
            depth = "facts_only"
        trade_depths[trade_id] = depth

    if trades:
        mode = "execution_review" if any(depth != "facts_only" for depth in trade_depths.values()) else "fact_based_review"
    elif day_notes or asset_notes or active_plans:
        mode = "plan_tracking"
    else:
        mode = "empty"
    return {"mode": mode, "trade_depths": trade_depths}
