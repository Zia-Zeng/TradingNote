import json
from datetime import date as Date

from ... import behavior_insights, storage, today
from . import notes


def _as_of(value):
    return notes._iso_date(value, "as_of") if value is not None else Date.today()


async def get_portfolio(as_of: str | None = None) -> dict:
    day = _as_of(as_of)
    result = await today.get_portfolio_overview(day)
    return {**result, "summary": f"截至 {result.get('as_of') or day.isoformat()} 的现有持仓概览；金额按原币种保留，估值完整性及限制以原结果标志和 warnings 为准。"}


def _cached_states(day):
    states, demo_ids = {}, set()
    with storage.database() as connection:
        tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "trades" in tables:
            for row in connection.execute("SELECT id, payload FROM trades"):
                if behavior_insights._is_demo_trade(json.loads(row["payload"])):
                    demo_ids.add(str(row["id"]))
        if "today_portfolio_daily_states" in tables:
            rows = connection.execute(
                "SELECT account, state_date, payload FROM today_portfolio_daily_states WHERE state_date <= ? ORDER BY state_date DESC, account",
                (day.isoformat(),),
            )
            for row in rows:
                if row["account"] in states:
                    continue
                try:
                    payload = json.loads(row["payload"])
                except (TypeError, ValueError):
                    continue
                if not isinstance(payload, dict):
                    continue
                state = payload.get("daily_state", payload)
                if not isinstance(state, dict) or state.get("complete") is not True or not isinstance(state.get("positions"), list):
                    continue
                if state.get("date", row["state_date"]) != row["state_date"]:
                    continue
                if any(behavior_insights._number(position.get("quantity")) is None
                       or (behavior_insights._number(position.get("quantity")) > 0
                           and behavior_insights._number(position.get("market_value")) is None)
                       for position in state["positions"]):
                    continue
                states[row["account"]] = {**state, "date": row["state_date"]}
    return states, demo_ids


def get_behavior_facts(as_of=None) -> dict:
    day = _as_of(as_of)
    snapshots = today.get_holding_snapshot(day.isoformat()).get("snapshots", [])
    states, demo_ids = _cached_states(day)
    trades = [trade for trade in storage.list_trades()
              if str(trade.get("id")) not in demo_ids and not behavior_insights._is_demo_trade(trade)]
    identities = notes._identities(trades)
    normalized = []
    for trade in trades:
        market, kind, value = identities[str(trade["id"])].split(":", 2)
        normalized.append({**trade, "market": market, "code": value if kind == "code" else "",
                           "currency": str(trade.get("currency") or {"CN": "CNY", "HK": "HKD", "US": "USD"}.get(market, "")).upper()})
    limitations = ["仅计算已记录事实，沿用现有六个月规则；排除演示成交，不调用 LLM、不补行情、不进行汇率换算。"]
    accounts = set(states) | {snapshot.get("account") for snapshot in snapshots}
    portfolio_state = None
    if len(accounts) == 1 and states:
        account = next(iter(accounts))
        candidate = states.get(account)
        baseline_date = max((snapshot.get("as_of") or "" for snapshot in snapshots), default="")
        if candidate and candidate["date"] >= baseline_date:
            portfolio_state = candidate
            if candidate["date"] != day.isoformat():
                limitations.append(f"最近完整缓存估值日为 {candidate['date']}，并非所请求日期的实时估值。")
    elif len(accounts) > 1:
        limitations.append("多账户缓存未安全聚合，portfolio_state 不标完整；仅使用各账户已录入快照，成本逐行按数量及原币种计算。")
    if portfolio_state is None:
        limitations.append("没有可安全使用的完整缓存状态；使用快照，缺失市值或成本保持未知，快照不能视为 as_of 当日完整估值。")
    facts = behavior_insights.build_facts(day, snapshots, normalized, portfolio_state)
    return {**facts, "portfolio_state_date": portfolio_state["date"] if portfolio_state else None,
            "portfolio_state_complete": portfolio_state is not None, "limitations": limitations,
            "summary": f"截至 {day.isoformat()} 的只读行为事实，含 {facts['trade_count']} 笔近六个月成交；估值来源为{'最近完整日缓存' if portfolio_state else '已录入快照（未补估值）'}，币种不混加。"}


def get_daily_context(date: str) -> dict:
    day = notes._iso_date(date).isoformat()
    result = today.get_agent_daily_context(day)
    daily_notes = [note for note in notes.note_records() if note["date"] == day]
    return {**result, "daily_summary": result.get("summary"), "notes": daily_notes, "note_count": len(daily_notes),
            "summary": f"{day} 的现有日上下文，含 {len(result.get('today_trades', []))} 笔当日成交及 {len(daily_notes)} 条原文笔记；原业务摘要保留在 daily_summary，覆盖范围及原函数截取边界以返回记录为准。"}
