"""Close beyond the preceding 20-day range on at least 1.5x average volume."""
from mindgo_api import *


def init(context):
    g.stock = "__SYMBOL__"
    subscribe(g.stock)
    set_execution("next_open")
    set_commission(PerShare(type="stock", cost=0.001, min_trade_cost=0.0))
    set_slippage(PriceSlippage(0.002))


def handle_bar(context, bar_dict):
    prices = history(g.stock, ["high", "low", "close", "volume"], 21, "1d", skip_paused=True, fq="pre")
    if prices is None or len(prices) < 21 or prices.isna().any().any():
        return
    if (prices[["high", "low", "close"]] <= 0).any().any():
        return
    current = prices.iloc[-1]
    prior = prices.iloc[-21:-1]
    average_volume = prior["volume"].mean()
    if average_volume <= 0 or current["volume"] < 1.5 * average_volume:
        return
    buy = current["close"] > prior["high"].max()
    sell = current["close"] < prior["low"].min()
    held = g.stock in context.portfolio.positions.keys()
    if buy and not held:
        order_target_percent(g.stock, 0.99)
    elif sell and held:
        order_target_percent(g.stock, 0)
