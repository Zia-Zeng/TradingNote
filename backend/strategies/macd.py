"""Price/MACD pivot divergence confirmed by a signal-line cross."""
from mindgo_api import *


def init(context):
    g.stock = "__SYMBOL__"
    subscribe(g.stock)
    set_execution("next_open")
    set_commission(PerShare(type="stock", cost=0.001, min_trade_cost=0.0))
    set_slippage(PriceSlippage(0.002))


def _pivot(values, index, low):
    if index < 2 or index + 2 >= len(values):
        return False
    neighbors = values[index - 2:index] + values[index + 1:index + 3]
    return all(values[index] < value for value in neighbors) if low else all(values[index] > value for value in neighbors)


def handle_bar(context, bar_dict):
    prices = history(g.stock, ["close"], 140, "1d", skip_paused=True, fq="pre")
    if prices is None or len(prices) < 80:
        return
    close = prices["close"].astype(float)
    if close.isna().any() or (close <= 0).any():
        return
    line = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = line.ewm(span=9, adjust=False).mean()
    values, macd = close.tolist(), line.tolist()
    lows = [i for i in range(2, len(values) - 2) if _pivot(values, i, True)]
    highs = [i for i in range(2, len(values) - 2) if _pivot(values, i, False)]
    bullish = any(
        len(values) - 1 - second <= 10 and second - first <= 40 and values[second] < values[first] and macd[second] > macd[first]
        for first, second in zip(lows, lows[1:])
    )
    bearish = any(
        len(values) - 1 - second <= 10 and second - first <= 40 and values[second] > values[first] and macd[second] < macd[first]
        for first, second in zip(highs, highs[1:])
    )
    buy = bullish and line.iloc[-2] <= signal.iloc[-2] and line.iloc[-1] > signal.iloc[-1]
    sell = bearish and line.iloc[-2] >= signal.iloc[-2] and line.iloc[-1] < signal.iloc[-1]
    held = g.stock in context.portfolio.positions.keys()
    if buy and not held:
        order_target_percent(g.stock, 0.99)
    elif sell and held:
        order_target_percent(g.stock, 0)
