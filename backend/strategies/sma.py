"""SMA20/50 crossover. SYMBOL is filled by the backend before upload."""
from mindgo_api import *


def init(context):
    g.stock = "__SYMBOL__"
    subscribe(g.stock)
    set_execution("next_open")
    set_commission(PerShare(type="stock", cost=0.001, min_trade_cost=0.0))
    set_slippage(PriceSlippage(0.002))


def handle_bar(context, bar_dict):
    prices = history(g.stock, ["close"], 51, "1d", skip_paused=True, fq="pre")
    if prices is None or len(prices) < 51:
        return
    close = prices["close"].astype(float)
    if close.isna().any() or (close <= 0).any():
        return
    fast = close.rolling(20).mean()
    slow = close.rolling(50).mean()
    buy = fast.iloc[-2] <= slow.iloc[-2] and fast.iloc[-1] > slow.iloc[-1]
    sell = fast.iloc[-2] >= slow.iloc[-2] and fast.iloc[-1] < slow.iloc[-1]
    held = g.stock in context.portfolio.positions.keys()
    if buy and not held:
        order_target_percent(g.stock, 0.99)
    elif sell and held:
        order_target_percent(g.stock, 0)
