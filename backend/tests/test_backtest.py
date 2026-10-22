import asyncio
import json
import unittest
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import AsyncMock, patch
from urllib.error import URLError

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

    def test_us_history_uses_yahoo_before_wind(self):
        async def inline_threadpool(function, *args):
            return function(*args)

        with patch.object(market_data, "_wind_history", new=AsyncMock()) as wind, \
                patch.object(market_data, "_yahoo_history", return_value={"bars": self.bars}) as yahoo, \
                patch.object(market_data, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(market_data.fetch_us_history("AAPL", "2026-01-01", "2026-04-10", required_fields=("open", "volume")))
        self.assertEqual(result["source"], "Yahoo Finance")
        self.assertEqual(result["providers_tried"], ["Yahoo Finance"])
        self.assertEqual(len(result["bars"]), 100)
        yahoo.assert_called_once_with("AAPL", "2026-01-01", "2026-04-10")
        wind.assert_not_awaited()

    def test_us_history_falls_back_to_wind_when_yahoo_has_no_bars(self):
        async def inline_threadpool(function, *args):
            return function(*args)

        with patch.object(market_data, "_wind_history", new=AsyncMock(return_value=self.bars)) as wind, \
                patch.object(market_data, "_yahoo_history", return_value={"bars": []}), \
                patch.object(market_data, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(market_data.fetch_us_history("SHOP", "2026-01-01", "2026-04-10", required_fields=("open", "volume")))
        self.assertEqual(result["source"], "Wind Finmarket")
        self.assertEqual(result["providers_tried"], ["Yahoo Finance", "Wind Finmarket"])
        self.assertEqual(result["provider_failures"][0]["provider"], "Yahoo Finance")
        wind.assert_awaited_once_with("SHOP", "2026-01-01", "2026-04-10")

    def test_hk_history_uses_yahoo(self):
        async def inline_threadpool(function, *args):
            return function(*args)

        with patch.object(market_data, "_wind_history", new=AsyncMock()) as wind, \
                patch.object(market_data, "_yahoo_history", return_value={"source": "Yahoo Finance", "bars": self.bars}) as yahoo, \
                patch.object(market_data, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(market_data.fetch_daily_history("02259", "HK", "2026-01-01", "2026-04-10"))
        self.assertEqual(result["source"], "Yahoo Finance")
        yahoo.assert_called_once_with("2259.HK", "2026-01-01", "2026-04-10")
        wind.assert_not_awaited()

    def test_yahoo_history_tries_second_chart_host(self):
        payload = {"chart": {"result": [{
            "timestamp": [int(datetime(2026, 1, 2, tzinfo=timezone.utc).timestamp())],
            "meta": {"exchangeTimezoneName": "UTC"},
            "indicators": {"quote": [{"open": [100], "high": [101], "low": [99], "close": [100], "volume": [1000]}]},
        }], "error": None}}
        with patch.object(market_data, "urlopen", side_effect=[URLError("first host unavailable"), BytesIO(json.dumps(payload).encode())]) as request:
            result = market_data._yahoo_history("SHOP", "2026-01-01", "2026-01-03")
        self.assertEqual(request.call_count, 2)
        self.assertEqual(result["bars"][0]["open"], 100)

    def test_us_backtest_uses_cached_bars_without_a_separate_worker(self):
        async def inline_threadpool(function, *args):
            return function(*args)

        with patch.dict("os.environ", {"US_BACKTEST_WORKER_URL": ""}), \
                patch.object(backtest, "cached_daily_history", new=AsyncMock(return_value={"bars": self.bars})), \
                patch.object(backtest, "fetch_us_history", new=AsyncMock()) as fetch, \
                patch.object(backtest, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(backtest._run_us_backtest("sma", "SHOP", date(2026, 1, 1), date(2026, 4, 10), 6))
        self.assertEqual(result["ticker"], "SHOP")
        self.assertEqual(len(result["chart"]), len(self.bars))
        fetch.assert_not_awaited()

    def test_us_backtest_replaces_incomplete_cached_bars(self):
        async def inline_threadpool(function, *args):
            return function(*args)

        incomplete = [{"date": bar["date"], "close": bar["close"]} for bar in self.bars]
        with patch.dict("os.environ", {"US_BACKTEST_WORKER_URL": ""}), \
                patch.object(backtest, "cached_daily_history", new=AsyncMock(return_value={"bars": incomplete})), \
                patch.object(backtest, "fetch_us_history", new=AsyncMock(return_value={"source": "Yahoo Finance", "bars": self.bars})) as fetch, \
                patch.object(backtest, "save_market_history_segment") as save, \
                patch.object(backtest, "run_in_threadpool", new=inline_threadpool):
            result = asyncio.run(backtest._run_us_backtest("sma", "SHOP", date(2026, 1, 1), date(2026, 4, 10), 6))
        self.assertEqual(len(result["chart"]), len(self.bars))
        fetch.assert_awaited_once()
        save.assert_called_once()


if __name__ == "__main__":
    unittest.main()
