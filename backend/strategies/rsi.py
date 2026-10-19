"""RSI14 recovery through 30 and decline through 70."""
from mindgo_api import *


def init(context):
    g.stock = "__SYMBOL__"
    subscribe(g.stock)
    set_execution("next_open")
    set_commission(PerShare(type="stock", cost=0.001, min_trade_cost=0.0))
    set_slippage(PriceSlippage(0.002))


def handle_bar(context, bar_dict):
    prices = history(g.stock, ["close"], 100, "1d", skip_paused=True, fq="pre")
    if prices is None or len(prices) < 30:
        return
    close = prices["close"].astype(float)
    if close.isna().any() or (close <= 0).any():
        return
    changes = close.diff().dropna().tolist()
    gain = sum(max(value, 0) for value in changes[:14]) / 14
    loss = sum(max(-value, 0) for value in changes[:14]) / 14
    values = []
    for change in changes[14:]:
        gain = (13 * gain + max(change, 0)) / 14
        loss = (13 * loss + max(-change, 0)) / 14
        values.append(100 if loss == 0 else 100 - 100 / (1 + gain / loss))
    if len(values) < 2:
        return
    buy = values[-2] < 30 <= values[-1]
    sell = values[-2] > 70 >= values[-1]
    held = g.stock in context.portfolio.positions.keys()
    if buy and not held:
        order_target_percent(g.stock, 0.99)
    elif sell and held:
        order_target_percent(g.stock, 0)
