"""Run separately from the Agent API; deploy this process on any trusted host."""

from __future__ import annotations

import os
from datetime import date
from math import isfinite

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from .engine import STRATEGIES, run_backtest


class DailyBar(BaseModel):
    date: date
    open: float = Field(gt=0)
    close: float = Field(gt=0)
    high: float | None = None
    low: float | None = None
    volume: float | None = Field(default=None, ge=0)

    @field_validator("open", "close", "high", "low", "volume")
    @classmethod
    def finite_number(cls, value: float | None) -> float | None:
        if value is not None and not isfinite(value):
            raise ValueError("Prices and volume must be finite.")
        return value


class BacktestPayload(BaseModel):
    strategy: str
    ticker: str = Field(min_length=1, max_length=16)
    start_date: date
    end_date: date
    bars: list[DailyBar] = Field(min_length=2, max_length=1600)


app = FastAPI(title="US Backtest Worker", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/backtest")
def backtest(payload: BacktestPayload, authorization: str | None = Header(default=None)) -> dict:
    token = os.getenv("US_BACKTEST_WORKER_TOKEN", "").strip()
    if token and authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Unauthorized.")
    if payload.strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail="Unknown backtest strategy.")
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=400, detail="Invalid backtest period.")
    try:
        return run_backtest(
            payload.strategy, payload.ticker, payload.start_date.isoformat(), payload.end_date.isoformat(),
            [bar.model_dump(mode="json") for bar in payload.bars],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
