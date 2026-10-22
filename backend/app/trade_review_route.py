"""Deterministic day-level routing and per-trade evidence depth."""

from __future__ import annotations

from typing import Any


def route_trade_review(context: dict[str, Any]) -> dict[str, Any]:
    trades = context.get("today_trades") or []
    timelines = context.get("asset_timelines") or []
    active_trade_notes = context.get("active_trade_notes") or []
    day_notes = context.get("day_note_refs") or []
    asset_notes = context.get("asset_note_refs") or []
    trade_depths: dict[str, str] = {}
    for trade in trades:
        trade_id = str(trade.get("id") or "")
        timeline = next((item for item in timelines if trade_id in item.get("today_trade_ids", [])), {})
        own_note = bool(str(trade.get("note") or "").strip() or trade.get("note_tags"))
        related_note = bool(timeline.get("asset_note_refs") or timeline.get("daily_note_refs"))
        related_trade_note = any(item.get("asset_key") == timeline.get("asset_key") for item in active_trade_notes)
        if own_note or related_note or related_trade_note:
            depth = "notes_based"
        else:
            depth = "facts_only"
        trade_depths[trade_id] = depth

    if trades:
        mode = "execution_review" if any(depth != "facts_only" for depth in trade_depths.values()) else "fact_based_review"
    elif day_notes or asset_notes or active_trade_notes:
        mode = "note_tracking"
    else:
        mode = "empty"
    return {"mode": mode, "trade_depths": trade_depths}
