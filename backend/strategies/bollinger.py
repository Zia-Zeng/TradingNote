"""Upper-band breakout within five sessions of a narrow-band squeeze."""
from mindgo_api import *


def init(context):
    g.stock = "__SYMBOL__"
    subscribe(g.stock)
    set_execution("next_open")
    set_commission(PerShare(type="stock", cost=0.001, min_trade_cost=0.0))
    set_slippage(PriceSlippage(0.002))


def handle_bar(context, bar_dict):
    prices = history(g.stock, ["close"], 145, "1d", skip_paused=True, fq="pre")
    if prices is None or len(prices) < 80:
        return
    close = prices["close"].astype(float)
    if close.isna().any() or (close <= 0).any():
        return
    middle = close.rolling(20).mean()
    deviation = close.rolling(20).std(ddof=0)
    bandwidth = 4 * deviation / middle
    squeezed = False
    for index in range(max(60, len(close) - 6), len(close) - 1):
        prior = bandwidth.iloc[max(0, index - 120):index].dropna()
        if len(prior) >= 40 and bandwidth.iloc[index] <= prior.quantile(0.1):
            squeezed = True
            break
    upper = middle.iloc[-2] + 2 * deviation.iloc[-2]
    lower = middle.iloc[-2] - 2 * deviation.iloc[-2]
    buy = squeezed and close.iloc[-2] <= upper and close.iloc[-1] > upper
    sell = close.iloc[-2] >= lower and close.iloc[-1] < lower
    held = g.stock in context.portfolio.positions.keys()
    if buy and not held:
        order_target_percent(g.stock, 0.99)
    elif sell and held:
        order_target_percent(g.stock, 0)
