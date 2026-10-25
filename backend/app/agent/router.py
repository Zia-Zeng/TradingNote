import os
import re
from dataclasses import asdict
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException

from . import runner, state

router = APIRouter(tags=["Agent"])
DAILY_REFERENCE = re.compile(r"daily-\d{4}-\d{2}-\d{2}")
GREETING = re.compile(r"^\s*(你好|您好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好|(?:hi|hello|hey) there|good (?:morning|afternoon|evening))"
                      r"[\s!！。.~～,，]*$", re.I)
STOCK_PICKING = [
    re.compile(r"^\s*(请|帮我|给我)?(推荐|推介)(一下)?(一只|几只|一些|个|只|点)?[^，,。？?！!\s]{0,12}(股票|个股|牛股)[\s。？?！!]*$"),
    re.compile(r"(明天|下周|现在)(应该|该)?(买|买入)(什么|哪只)(股票)?[？?]*$"),
    re.compile(r"^.{0,6}(稳赚|保本|必涨|稳涨)(不赔)?的?(股票|个股|方法|策略)[？?]*$"),
    re.compile(r"^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:recommend|suggest|pick)\s+(?:me\s+)?"
               r"(?:a|an|one|some|a few|any|the best|your best|your top|top|good)?\s*(?:\w+\s+){0,2}(?:stocks?|shares?|tickers?)\b.{0,60}$", re.I),
    re.compile(r"\b(?:what|which)\s+(?:stocks?|shares?|tickers?)\s+should\s+I\s+(?:buy|sell|invest in|get|pick)\b", re.I),
    re.compile(r"^[^.?!]{0,20}\b(?:guaranteed|risk[- ]free|sure[- ]win|can'?t[- ]lose)\s+(?:stocks?|returns?|profits?|picks?|strateg(?:y|ies)|methods?)\b"
               r"[^.?!]{0,30}[.?!]*\s*$", re.I),
]
PREDICTION = [
    re.compile(r"^\s*(?:will|is|are)\s+(?!my\b|I\b)[^?.!]{1,40}?\s+(?:go(?:ing)?\s+to\s+)?(?:go up|go down|rise|fall|drop|rally|crash|rebound|bounce back)\b"
               r"[^?.!]{0,30}[?.!]*\s*$", re.I),
    re.compile(r"^\s*(?:(?:can|could|would) you\s+|please\s+)?(?:predict|forecast)\b", re.I),
    re.compile(r"^\s*(?:what|where)\s+will\b[^?.!]{0,60}\b(?:tomorrow|next (?:week|month|quarter|year))\b", re.I),
    re.compile(r"^\s*\S{0,12}(明天|后天|下周|下个月|明年)(会|能|还会|还能|要)?(涨|跌|大涨|大跌|反弹|涨停|跌停)(吗|么|嘛|多少)?[？?]*$"),
]
CONFIDENTIAL = re.compile(
    r"\b(?:system|developer|hidden)\s+(?:prompts?|instructions?|messages?)\b|\byour\s+(?:system\s+)?(?:prompt|instructions)\b"
    r"|\b(?:api|secret|access|bearer)[ _-]?(?:keys?|tokens?)\b|\b(?:your|the)\s+(?:\w+\s+)?credentials\b"
    r"|chain[- ]of[- ]thought|\b(?:internal|hidden|raw)\s+reasoning\b|系统提示|提示词|开发者(?:指令|消息|提示)|密钥|思维链|内部推理", re.I)
GREETING_REPLY = ("Hi! I'm TradingNote's trade-review assistant. I can review a trade against the notes you recorded, "
                  "summarize your trading stats and habits, or look up dated daily prices and news for a ticker. "
                  "Which trade would you like to start with?")
COMPLIANCE_REPLY = ("TradingNote doesn't give buy/sell recommendations, price predictions or return guarantees. "
                    "I can review the reasons and execution behind a trade you made, show dated daily prices and news for a ticker, "
                    "or summarize how your trading has performed. Which trade would you like to start with?")
CONFIDENTIAL_REPLY = ("I can't share hidden system or developer instructions, credentials or my internal reasoning. "
                      "In short, I'm TradingNote's trade-review assistant: I answer from your recorded notes and trades plus dated public "
                      "market data, cite every source, and don't give buy/sell recommendations. What would you like to review?")


def engine() -> str:
    return "v2" if os.getenv("AGENT_ENGINE", "legacy").strip().lower() == "v2" else "legacy"


async def dispatch_chat(payload: Any, legacy: Callable[[Any], Awaitable[Any]]) -> Any:
    # Scenario flows (Review Trades, Draft, Insights, Daily reference) keep their tuned legacy prompts.
    if engine() != "v2" or payload.action or DAILY_REFERENCE.fullmatch(payload.reference or ""):
        return await legacy(payload)
    if GREETING.match(payload.message):
        return runner.template(payload, GREETING_REPLY)
    if CONFIDENTIAL.search(payload.message):
        return runner.template(payload, CONFIDENTIAL_REPLY)
    if any(pattern.search(payload.message) for pattern in (*STOCK_PICKING, *PREDICTION)):
        return runner.template(payload, COMPLIANCE_REPLY)
    return await runner.run(payload, legacy)


@router.get("/api/agent/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run = state.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return run


@router.get("/api/agent/engine")
def get_engine() -> dict:
    return {"engine": engine(), "tool_calling": runner.MODEL.supported, "limits": asdict(runner.LIMITS)}


def initialize() -> None:
    state.initialize()


async def shutdown() -> None:
    await runner.MODEL.close()
