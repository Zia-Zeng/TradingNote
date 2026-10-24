import os
import re
from dataclasses import asdict
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException

from . import runner, state

router = APIRouter(tags=["Agent"])
DAILY_REFERENCE = re.compile(r"daily-\d{4}-\d{2}-\d{2}")
GREETING = re.compile(r"^\s*(你好|您好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好)[\s!！。.~～,，]*$", re.I)
STOCK_PICKING = [
    re.compile(r"^\s*(请|帮我|给我)?(推荐|推介)(一下)?(一只|几只|一些|个|只|点)?[^，,。？?！!\s]{0,12}(股票|个股|牛股)[\s。？?！!]*$"),
    re.compile(r"(明天|下周|现在)(应该|该)?(买|买入)(什么|哪只)(股票)?[？?]*$"),
    re.compile(r"^.{0,6}(稳赚|保本|必涨|稳涨)(不赔)?的?(股票|个股|方法|策略)[？?]*$"),
]
GREETING_REPLY = "你好！我是 TradingNote 的交易复盘助手。我可以结合你的交易笔记复盘某笔交易、查看持仓与交易统计，或查询标的的日线行情和新闻。想先看哪一笔？"
COMPLIANCE_REPLY = "TradingNote 不提供具体买卖推荐或收益保证。我可以帮你复盘某笔交易的理由与执行、查看标的的日线行情和新闻，或统计你的交易表现。你想从哪一笔交易开始？"


def engine() -> str:
    return "v2" if os.getenv("AGENT_ENGINE", "legacy").strip().lower() == "v2" else "legacy"


async def dispatch_chat(payload: Any, legacy: Callable[[Any], Awaitable[Any]]) -> Any:
    # Scenario flows (Review Trades, Draft, Insights, Daily reference) keep their tuned legacy prompts.
    if engine() != "v2" or payload.action or DAILY_REFERENCE.fullmatch(payload.reference or ""):
        return await legacy(payload)
    if GREETING.match(payload.message):
        return runner.template(payload, GREETING_REPLY)
    if any(pattern.search(payload.message) for pattern in STOCK_PICKING):
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
