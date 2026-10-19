"""Daily, long-only execution for the five Agent strategy presets.

Signals use data available at a session close. Orders fill at the next session's
open. Wealth is normalized to one, so no user-specified starting cash is needed.
"""

from __future__ import annotations

from math import isfinite, sqrt
from statistics import mean


STRATEGIES = {"sma", "rsi", "macd", "bollinger", "volume"}
COMMISSION = 0.001
SLIPPAGE = 0.001
TARGET_WEIGHT = 0.99


def _ema(values: list[float], span: int) -> list[float]:
    alpha = 2 / (span + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def _pivot(values: list[float], index: int, low: bool) -> bool:
    if index < 2 or index + 2 >= len(values):
        return False
    neighbors = values[index - 2:index] + values[index + 1:index + 3]
    return all(values[index] < value for value in neighbors) if low else all(values[index] > value for value in neighbors)


def _signal(strategy: str, bars: list[dict], index: int) -> str | None:
    if strategy == "sma":
        if index < 50:
            return None
        closes = [bar["close"] for bar in bars[index - 50:index + 1]]
        fast_before, fast_now = mean(closes[-21:-1]), mean(closes[-20:])
        slow_before, slow_now = mean(closes[-51:-1]), mean(closes[-50:])
        if fast_before <= slow_before and fast_now > slow_now:
            return "buy"
        if fast_before >= slow_before and fast_now < slow_now:
            return "sell"
    elif strategy == "rsi":
        closes = [bar["close"] for bar in bars[max(0, index - 99):index + 1]]
        if len(closes) < 30:
            return None
        changes = [right - left for left, right in zip(closes, closes[1:])]
        gain = sum(max(value, 0) for value in changes[:14]) / 14
        loss = sum(max(-value, 0) for value in changes[:14]) / 14
        values = []
        for change in changes[14:]:
            gain = (13 * gain + max(change, 0)) / 14
            loss = (13 * loss + max(-change, 0)) / 14
            values.append(100 if loss == 0 else 100 - 100 / (1 + gain / loss))
        if len(values) >= 2:
            if values[-2] < 30 <= values[-1]:
                return "buy"
            if values[-2] > 70 >= values[-1]:
                return "sell"
    elif strategy == "macd":
        closes = [bar["close"] for bar in bars[max(0, index - 139):index + 1]]
        if len(closes) < 80:
            return None
        fast, slow = _ema(closes, 12), _ema(closes, 26)
        line = [left - right for left, right in zip(fast, slow)]
        signal = _ema(line, 9)
        lows = [i for i in range(2, len(closes) - 2) if _pivot(closes, i, True)]
        highs = [i for i in range(2, len(closes) - 2) if _pivot(closes, i, False)]
        bullish = any(
            len(closes) - 1 - second <= 10 and second - first <= 40
            and closes[second] < closes[first] and line[second] > line[first]
            for first, second in zip(lows, lows[1:])
        )
        bearish = any(
            len(closes) - 1 - second <= 10 and second - first <= 40
            and closes[second] > closes[first] and line[second] < line[first]
            for first, second in zip(highs, highs[1:])
        )
        if bullish and line[-2] <= signal[-2] and line[-1] > signal[-1]:
            return "buy"
        if bearish and line[-2] >= signal[-2] and line[-1] < signal[-1]:
            return "sell"
    elif strategy == "bollinger":
        closes = [bar["close"] for bar in bars[max(0, index - 144):index + 1]]
        if len(closes) < 80:
            return None
        middle = [None] * len(closes)
        deviation = [None] * len(closes)
        bandwidth = [None] * len(closes)
        for i in range(19, len(closes)):
            window = closes[i - 19:i + 1]
            middle[i] = mean(window)
            deviation[i] = sqrt(sum((value - middle[i]) ** 2 for value in window) / 20)
            bandwidth[i] = 4 * deviation[i] / middle[i]
        squeezed = False
        for i in range(max(60, len(closes) - 6), len(closes) - 1):
            prior = sorted(value for value in bandwidth[max(0, i - 120):i] if value is not None)
            if len(prior) >= 40:
                rank = (len(prior) - 1) * 0.1
                lower = int(rank)
                upper = min(lower + 1, len(prior) - 1)
                quantile = prior[lower] + (prior[upper] - prior[lower]) * (rank - lower)
                if bandwidth[i] <= quantile:
                    squeezed = True
                    break
        upper_band = middle[-2] + 2 * deviation[-2]
        lower_band = middle[-2] - 2 * deviation[-2]
        if squeezed and closes[-2] <= upper_band and closes[-1] > upper_band:
            return "buy"
        if closes[-2] >= lower_band and closes[-1] < lower_band:
            return "sell"
    elif strategy == "volume":
        if index < 20:
            return None
        window = bars[index - 20:index + 1]
        if any(bar.get("high") is None or bar.get("low") is None or bar.get("volume") is None for bar in window):
            return None
        prior, current = window[:-1], window[-1]
        average_volume = mean(bar["volume"] for bar in prior)
        if average_volume <= 0 or current["volume"] < 1.5 * average_volume:
            return None
        if current["close"] > max(bar["high"] for bar in prior):
            return "buy"
        if current["close"] < min(bar["low"] for bar in prior):
            return "sell"
    return None


def run_backtest(strategy: str, ticker: str, start_date: str, end_date: str, bars: list[dict]) -> dict:
    if strategy not in STRATEGIES:
        raise ValueError("Unknown backtest strategy.")
    ordered = sorted(bars, key=lambda bar: bar["date"])
    dates = [bar["date"] for bar in ordered]
    if len(dates) != len(set(dates)):
        raise ValueError("Daily history contains duplicate dates.")
    if any(not isfinite(float(bar["open"])) or not isfinite(float(bar["close"]))
           or bar["open"] <= 0 or bar["close"] <= 0 for bar in ordered):
        raise ValueError("Daily history contains invalid prices.")
    active = [i for i, bar in enumerate(ordered) if start_date <= bar["date"] <= end_date]
    if len(active) < 2:
        raise ValueError("Not enough trading days in the selected period.")
    if strategy == "volume" and not any(bar.get("volume") is not None for bar in ordered):
        raise ValueError("Volume history is unavailable for this ticker.")

    cash, shares = 1.0, 0.0
    pending = None
    entry_cost = 0.0
    closed = []
    chart = []
    trades = []
    peak, max_drawdown = 1.0, 0.0
    first_active = active[0]
    for index in active:
        bar = ordered[index]
        if pending == "buy" and shares == 0:
            fill = bar["open"] * (1 + SLIPPAGE)
            budget = cash * TARGET_WEIGHT
            bought = budget / (fill * (1 + COMMISSION))
            entry_cost = bought * fill * (1 + COMMISSION)
            cash -= entry_cost
            shares = bought
            trades.append({"date": bar["date"], "time": f'{bar["date"]} 09:30:00', "side": "buy", "price": round(fill, 4), "quantity": round(bought, 8)})
        elif pending == "sell" and shares > 0:
            fill = bar["open"] * (1 - SLIPPAGE)
            proceeds = shares * fill * (1 - COMMISSION)
            closed.append(proceeds > entry_cost)
            cash += proceeds
            trades.append({"date": bar["date"], "time": f'{bar["date"]} 09:30:00', "side": "sell", "price": round(fill, 4), "quantity": round(shares, 8)})
            shares, entry_cost = 0.0, 0.0
        pending = None
        equity = cash + shares * bar["close"]
        # At the first selected close there can be no fill: signals start here.
        if index == first_active:
            equity = 1.0
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak)
        chart.append({"date": bar["date"], "return_pct": round((equity - 1) * 100, 4)})
        action = _signal(strategy, ordered, index)
        if action == "buy" and shares == 0:
            pending = "buy"
        elif action == "sell" and shares > 0:
            pending = "sell"

    return {
        "strategy": strategy, "ticker": ticker,
        "start_date": start_date, "end_date": end_date, "as_of": chart[-1]["date"],
        "stats": {
            "return_pct": round(chart[-1]["return_pct"], 2),
            "max_drawdown_pct": round(max_drawdown * 100, 2),
            "closed_trades": len(closed), "winning_trades": sum(closed),
            "win_rate_pct": round(sum(closed) / len(closed) * 100, 2) if closed else None,
        },
        "chart": chart, "trades": trades,
    }
