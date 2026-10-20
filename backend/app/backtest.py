"""Submit the five fixed A-share presets to SuperMind's remote backtest runner."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import os
import re
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
import httpx
from pydantic import BaseModel, Field

from .market_data import fetch_us_history

router = APIRouter(prefix="/api/backtest", tags=["backtest"])
BACKEND_DIR = Path(__file__).resolve().parents[1]
STRATEGY_DIR = BACKEND_DIR / "strategies"
RESULT_DIR = BACKEND_DIR / ".runtime" / "backtests"
STRATEGIES = {"sma", "rsi", "macd", "bollinger", "volume"}
_REMOTE_LOCK = asyncio.Lock()


class BacktestRequest(BaseModel):
    strategy: str = Field(min_length=2, max_length=20)
    ticker: str = Field(min_length=1, max_length=16)
    months: Literal[6, 12, 36] = 36


def _months_before(day: date, months: int) -> date:
    month_index = day.year * 12 + day.month - 1 - months
    year, month_zero_based = divmod(month_index, 12)
    month = month_zero_based + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def _cached_result(path: Path, start: date) -> dict | None:
    if not path.is_file():
        return None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if (isinstance(cached, dict) and cached.get("start_date") == start.isoformat()
                and isinstance(cached.get("stats"), dict) and isinstance(cached.get("trades"), list)
                and isinstance(cached.get("chart"), list) and cached["chart"]
                and ("unit_nav" in cached["chart"][0] or "return_pct" in cached["chart"][0])):
            return cached
    except (OSError, ValueError):
        pass
    return None


def _symbol(ticker: str) -> str:
    value = ticker.strip().upper()
    if re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", value):
        return value
    if re.fullmatch(r"\d{6}\.(SH|SZ|BJ)", value):
        return value
    if not re.fullmatch(r"\d{6}", value):
        raise ValueError("Enter a six-digit A-share code or a US stock ticker such as AAPL.")
    if value.startswith(("5", "6", "9")):
        return f"{value}.SH"
    if value.startswith(("4", "8")):
        return f"{value}.BJ"
    return f"{value}.SZ"


def _runner() -> Path:
    configured = os.getenv("SUPERMIND_RUNNER_PATH", "").strip()
    if configured:
        return Path(configured)
    suffix = "run.windows.ps1" if os.name == "nt" else "run.linux.sh"
    return Path.home() / ".codex" / "skills" / "supermind-quant-developer" / "bin" / suffix


async def _command(runner: Path, args: list[str], *, env: dict[str, str], timeout: int) -> str:
    prefix = ["pwsh", "-NoProfile", "-File", str(runner)] if runner.suffix.lower() == ".ps1" else ["bash", str(runner)]
    process = await asyncio.create_subprocess_exec(
        *prefix, *args,
        cwd=str(BACKEND_DIR), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise RuntimeError("The backtest timed out.") from exc
    decoded = output.decode("utf-8", errors="replace")
    if process.returncode != 0:
        raise RuntimeError("The backtest service failed. See the server log for details.")
    return decoded


def _csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _report_number(report: str, label: str) -> float:
    match = re.search(rf"^\|\s*{re.escape(label)}\s*\|\s*([-+\d.eE]+)\s*\|", report, re.MULTILINE)
    if not match:
        raise ValueError(f"The backtest report is missing {label}.")
    return float(match.group(1))


def _parse_result(folder: Path, strategy: str, symbol: str, start: date, end: date) -> dict:
    report = (folder / "回测报告.md").read_text(encoding="utf-8-sig")
    equity_rows = _csv_rows(folder / "净值曲线.csv")
    trade_rows = _csv_rows(folder / "交易记录.csv")
    if not equity_rows:
        raise ValueError("The backtest returned no daily results.")
    chart = []
    for row in equity_rows:
        day = row["时间"][:10]
        if day < start.isoformat():
            continue
        nav = float(row["策略单位净值"])
        if nav > 0:
            chart.append({"date": day, "unit_nav": nav})
    if not chart:
        raise ValueError("The backtest returned no valid daily returns.")
    trades = []
    closed = []
    opening_cost = 0.0
    opening_quantity = 0.0
    cycle_profit = 0.0
    for row in trade_rows:
        side = row["买卖方向"].upper()
        if side not in ("BUY", "SELL"):
            continue
        quantity = float(row["成交数量"])
        price = float(row["成交价格"])
        cost = float(row["交易成本"])
        item = {"date": row["交易时间"][:10], "time": row["交易时间"], "side": side.lower(), "price": price, "quantity": quantity}
        trades.append(item)
        if side == "BUY":
            opening_cost += price * quantity + cost
            opening_quantity += quantity
        elif opening_quantity > 0:
            matched = min(quantity, opening_quantity)
            allocated_cost = opening_cost * matched / opening_quantity
            cycle_profit += price * matched - cost * matched / quantity - allocated_cost
            opening_cost -= allocated_cost
            opening_quantity -= matched
            if opening_quantity < 1e-9:
                closed.append(cycle_profit > 0)
                opening_cost = opening_quantity = cycle_profit = 0.0
    return {
        "strategy": strategy,
        "ticker": symbol,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "as_of": chart[-1]["date"],
        "stats": {
            "return_pct": round((chart[-1]["unit_nav"] / chart[0]["unit_nav"] - 1) * 100, 2),
            "max_drawdown_pct": round(_report_number(report, "最大回撤") * 100, 2),
            "closed_trades": len(closed),
            "winning_trades": sum(closed),
            "win_rate_pct": round(sum(closed) / len(closed) * 100, 2) if closed else None,
        },
        "chart": chart,
        "trades": trades,
    }


def _public_result(raw: dict, *, cached: bool, months: int) -> dict:
    stats = raw["stats"]
    wins = stats.get("winning_trades")
    if wins is None:
        wins = round((stats.get("win_rate_pct") or 0) * stats.get("closed_trades", 0) / 100)
    rows = [point for point in raw["chart"] if raw["start_date"] <= point["date"] <= raw["as_of"]]
    if rows and "unit_nav" in rows[0]:
        baseline = rows[0]["unit_nav"]
        chart = [{"date": point["date"], "return_pct": round((point["unit_nav"] / baseline - 1) * 100, 4)} for point in rows]
    else:
        chart = [{"date": point["date"], "return_pct": point["return_pct"]} for point in rows]
    return {
        "strategy": raw["strategy"], "ticker": raw["ticker"],
        "start_date": raw["start_date"], "end_date": raw["end_date"], "as_of": raw["as_of"],
        "months": months, "cached": cached,
        "stats": {
            "return_pct": round(chart[-1]["return_pct"], 2) if chart else stats["return_pct"],
            "max_drawdown_pct": stats["max_drawdown_pct"],
            "closed_trades": stats["closed_trades"],
            "winning_trades": wins,
            "win_rate_pct": stats["win_rate_pct"],
        },
        "trades": [
            {key: trade[key] for key in ("date", "time", "side", "price", "quantity")}
            for trade in raw["trades"]
        ],
        "chart": chart,
        "chart_error": None if chart else "Return history is temporarily unavailable.",
    }


async def _run_us_backtest(strategy: str, symbol: str, start: date, end: date, months: int) -> dict:
    required = ("open", "high", "low", "volume") if strategy == "volume" else ("open",)
    try:
        history = await fetch_us_history(symbol, start - timedelta(days=300), end, required_fields=required)
    except (RuntimeError, ValueError, OSError) as exc:
        raise HTTPException(status_code=502, detail="US daily history is unavailable for this ticker.") from exc
    worker_url = os.getenv("US_BACKTEST_WORKER_URL", "http://127.0.0.1:8001").rstrip("/")
    token = os.getenv("US_BACKTEST_WORKER_TOKEN", "").strip()
    if not worker_url.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
        raise HTTPException(status_code=503, detail="The US backtest worker URL must use HTTPS outside localhost.")
    if worker_url.startswith("https://") and not token:
        raise HTTPException(status_code=503, detail="The US backtest worker token is not configured.")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(f"{worker_url}/backtest", json={
                "strategy": strategy, "ticker": symbol,
                "start_date": start.isoformat(), "end_date": end.isoformat(),
                "bars": history["bars"],
            }, headers=headers)
        if response.status_code == 422:
            raise HTTPException(status_code=422, detail="US history does not contain enough valid bars for this strategy.")
        response.raise_for_status()
        result = response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="The US backtest worker is unavailable.") from exc
    result.update({"months": months, "cached": False, "chart_error": None})
    return result


@router.post("/run")
async def run_backtest(request: BacktestRequest) -> dict:
    strategy = request.strategy.lower()
    if strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail="Unknown backtest strategy.")
    try:
        symbol = _symbol(request.ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    end = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    start = _months_before(end, request.months)
    if symbol[0].isalpha():
        return await _run_us_backtest(strategy, symbol, start, end, request.months)
    if not os.getenv("MGLLM_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="The backtest service is not configured.")
    runner = _runner()
    if not runner.is_file():
        raise HTTPException(status_code=503, detail="The backtest service is unavailable.")

    template = (STRATEGY_DIR / f"{strategy}.py").read_text(encoding="utf-8")
    code_hash = hashlib.sha256(template.encode("utf-8")).hexdigest()[:12]
    cache_path = RESULT_DIR / "cache" / f"{strategy}_{symbol}_{request.months}_{end.isoformat()}_{code_hash}.json"
    cached = _cached_result(cache_path, start)
    if cached is not None:
        return _public_result(cached, cached=True, months=request.months)
    remote_reused = cached is not None
    try:
        if cached is None:
            async with _REMOTE_LOCK:
                cached = _cached_result(cache_path, start)
                remote_reused = cached is not None
                if cached is None:
                    run_id = uuid4().hex[:12]
                    work = RESULT_DIR / run_id
                    work.mkdir(parents=True, exist_ok=False)
                    source = work / f"{strategy}_{run_id}.py"
                    source.write_text(template.replace("__SYMBOL__", symbol), encoding="utf-8")
                    environment = os.environ.copy()
                    environment["JUPYTER_WORKDIR"] = os.getenv("SUPERMIND_JUPYTER_WORKDIR", "mcp/tradingnote-backtests")
                    wrapper = (
                        "from mindgo_api import get_shared_api\n"
                        'api = get_shared_api("mgwrap.run_research_strategy_v1_1")\n'
                        f'api.run_research_strategy("{source.name}", start_date="{start.isoformat()}", '
                        f'end_date="{end.isoformat()}", frequency="DAILY", stock_market="STOCK")\n'
                    )
                    await _command(runner, ["sync-files", "--local-path", str(source)], env=environment, timeout=90)
                    await _command(runner, [
                        "execute-temp", "--task-name", f"backtest_{run_id}", "--code", wrapper,
                        "--local-path", str(work), "--auto-download", "--wait-until-complete",
                    ], env=environment, timeout=600)
                    folders = sorted(work.glob(f"{source.stem}_回测结果_*"), key=lambda path: path.stat().st_mtime, reverse=True)
                    if not folders:
                        raise ValueError("The backtest finished without downloadable results.")
                    cached = _parse_result(folders[0], strategy, symbol, start, end)
                    try:
                        cache_path.parent.mkdir(parents=True, exist_ok=True)
                        cache_path.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
                    except OSError:
                        pass
        result = _public_result(cached, cached=remote_reused, months=request.months)
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
        return result
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
