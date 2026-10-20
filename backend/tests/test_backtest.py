import asyncio
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from app import backtest, market_data
from us_backtest_worker.engine import STRATEGIES, run_backtest
from us_backtest_worker.main import BacktestPayload, DailyBar, backtest as worker_backtest


class BacktestIntegrationTests(unittest.TestCase):
    def setUp(self):
        first = date(2026, 1, 1)
        self.bars = [
            {
                "date": (first + timedelta(days=index)).isoformat(),
                "open": 100.0, "high": 101.0, "low": 99.0,
                "close": 100.0, "volume": 1000.0,
            }
            for index in range(100)
        ]

    def test_each_us_preset_produces_a_bounded_daily_chart(self):
        for strategy in STRATEGIES:
            with self.subTest(strategy=strategy):
                result = run_backtest(strategy, "AAPL", self.bars[0]["date"], self.bars[-1]["date"], self.bars)
                self.assertEqual(len(result["chart"]), len(self.bars))
                self.assertEqual(result["stats"]["return_pct"], 0)
                self.assertEqual(result["stats"]["max_drawdown_pct"], 0)
                self.assertEqual(result["trades"], [])

    def test_worker_accepts_normalized_daily_bars(self):
        payload = BacktestPayload(
            strategy="sma", ticker="AAPL", start_date=date(2026, 1, 1),
            end_date=date(2026, 4, 10),
            bars=[DailyBar(**bar) for bar in self.bars],
        )
        with patch.dict("os.environ", {"US_BACKTEST_WORKER_TOKEN": ""}):
            result = worker_backtest(payload, authorization=None)
        self.assertEqual(result["ticker"], "AAPL")
        self.assertEqual(result["as_of"], self.bars[-1]["date"])

    def test_ticker_routing_keeps_us_and_mainland_symbols_distinct(self):
        self.assertEqual(backtest._symbol("aapl"), "AAPL")
        self.assertEqual(backtest._symbol("601899"), "601899.SH")

    def test_us_history_falls_back_to_yahoo_when_wind_fails(self):
        async def missing_wind(*_args):
            raise RuntimeError("Wind unavailable")

        async def inline_threadpool(function, *args):
            return function(*args)

        with patch.object(market_data, "_wind_history", new=missing_wind), \
                patch.object(market_data, "_yahoo_history", return_value={"bars": self.bars}), \
                patch.object(market_data, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(market_data.fetch_us_history("AAPL", "2026-01-01", "2026-04-10", required_fields=("open", "volume")))
        self.assertEqual(result["source"], "Yahoo Finance")
        self.assertEqual(len(result["bars"]), 100)


if __name__ == "__main__":
    unittest.main()
