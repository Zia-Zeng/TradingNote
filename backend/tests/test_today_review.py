import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from app import market_data, stocks, storage, today


class InstrumentNormalizationTests(unittest.TestCase):
    def test_global_tickers_and_original_currency_are_preserved(self):
        records = stocks._normalize([
            {"ticker": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ"},
            {"code": "00700.HK", "name": "Tencent Holdings", "exchange": "HKEX"},
            {"code": "600519.SH", "name": "Kweichow Moutai"},
            {"code": "7203.T", "name": "Toyota Motor", "exchange": "TYO"},
        ])
        self.assertEqual([(item["code"], item["market"], item["currency"]) for item in records], [
            ("AAPL", "US", "USD"),
            ("00700.HK", "HK", "HKD"),
            ("600519.SH", "CN", "CNY"),
            ("7203.T", "GLOBAL", "JPY"),
        ])

    def test_holding_snapshot_contract_keeps_original_currency(self):
        snapshot = today.HoldingsImportRequest(as_of="2026-10-18", account="US Brokerage", rows=[
            {"symbol": "Apple", "code": "AAPL", "market": "US", "asset_class": "Stock", "currency": "USD", "quantity": 2, "market_price": 10},
        ])
        self.assertEqual(snapshot.rows[0].currency, "USD")
        self.assertEqual(snapshot.rows[0].market, "US")
        valued_snapshot = today.HoldingsImportRequest(as_of="2026-10-18", total_assets=12500, total_assets_currency="USD", rows=[
            {"symbol": "Apple", "code": "AAPL", "market": "US", "currency": "USD", "quantity": 2},
        ])
        self.assertEqual(valued_snapshot.total_assets, 12500)
        self.assertEqual(valued_snapshot.total_assets_currency, "USD")

    def test_holdings_ocr_preview_accepts_positions_and_optional_total_assets(self):
        preview = today.OcrHoldingsPreview.model_validate({
            "rows": [{"symbol": "紫金矿业", "code": "601899", "market": "CN", "currency": "CNY", "quantity": 100}],
            "total_assets": 250000,
            "total_assets_currency": "CNY",
            "warnings": [],
        })
        self.assertEqual(preview.rows[0].quantity, 100)
        self.assertEqual(preview.total_assets, 250000)


class EastmoneySearchTests(unittest.TestCase):
    @patch("app.stocks.urlopen")
    def test_chinese_prefix_search_requests_multiple_suggestions(self, mock_urlopen):
        response = Mock()
        response.read.return_value = json.dumps({
            "QuotationCodeTable": {"Data": [
                {"Code": "600388", "Name": "紫金龙净", "Classify": "AStock"},
                {"Code": "601899", "Name": "紫金矿业", "Classify": "AStock"},
            ]}
        }, ensure_ascii=False).encode("utf-8")
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = response

        items = stocks._eastmoney_search("紫金")

        query = parse_qs(urlparse(mock_urlopen.call_args.args[0].full_url).query)
        self.assertEqual(query["count"], ["20"])
        self.assertIn(("601899", "紫金矿业"), [(item["code"], item["name"]) for item in items])

    @patch("app.market_data.urlopen")
    def test_global_daily_history_uses_exchange_local_dates(self, mock_urlopen):
        response = Mock()
        timestamp = int(datetime(2026, 10, 19, 13, 30, tzinfo=timezone.utc).timestamp())
        response.read.return_value = json.dumps({"chart": {"result": [{
            "meta": {"exchangeTimezoneName": "America/New_York"},
            "timestamp": [timestamp],
            "indicators": {"quote": [{"close": [100.25]}]},
        }], "error": None}}).encode()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = response

        result = market_data._yahoo_history("AAPL", "2026-10-19", "2026-10-19")

        self.assertEqual(result["bars"], [{"date": "2026-10-19", "close": 100.25}])

    @patch("app.market_data._yahoo_history")
    def test_mainland_history_uses_yahoo_when_regional_sources_are_unavailable(self, yahoo_history):
        yahoo_history.return_value = {"bars": [{"date": "2026-10-16", "close": 25.0}]}
        async def immediate(function, *args):
            return function(*args)
        with patch.dict("os.environ", {"MARKET_DATA_PROVIDER_ORDER": ""}), patch("app.market_data.run_in_threadpool", side_effect=immediate):
            result = asyncio.run(market_data.fetch_a_share_history("601899", "2026-10-10", "2026-10-18"))
        yahoo_history.assert_called_once_with("601899.SS", "2026-10-10", "2026-10-18")
        self.assertEqual(result["latest_close"], 25.0)

    @patch("app.market_data._yahoo_history")
    def test_hong_kong_numeric_code_gets_exchange_suffix(self, yahoo_history):
        yahoo_history.return_value = {"bars": [{"date": "2026-10-16", "close": 12.0}]}
        async def immediate(function, *args):
            return function(*args)
        with patch("app.market_data.run_in_threadpool", side_effect=immediate):
            asyncio.run(market_data.fetch_daily_history("02259", "HK", "2026-10-10", "2026-10-18"))
        yahoo_history.assert_called_once_with("02259.HK", "2026-10-10", "2026-10-18")


class TradeImportDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.trade = {
            "time": "2026-10-18T14:31:00", "type": "Buy", "symbol": "紫金矿业",
            "code": "601899", "market": "CN", "currency": "CNY", "price": 20.5,
            "qty": 100, "amount": 2050, "id": "existing-1",
        }

    def request(self, mode="skip", **changes):
        trade = {key: value for key, value in self.trade.items() if key != "id"}
        trade.update(changes)
        return today.TradeImportRequest(trades=[trade], duplicate_mode=mode)

    def test_duplicate_match_uses_trade_identity_and_economics(self):
        duplicates = today._find_import_duplicates([self.trade], [self.trade])
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0]["existing_id"], "existing-1")
        self.assertEqual(today._find_import_duplicates(
            [{**self.trade, "qty": 200}], [self.trade]), [])

    @patch("app.today.create_trade")
    @patch("app.today.list_trades")
    def test_skip_mode_does_not_create_duplicate(self, list_trades, create_trade):
        list_trades.return_value = [self.trade]
        result = today.import_trades(self.request("skip"))
        self.assertEqual(result["skipped_count"], 1)
        self.assertEqual(result["trades"], [])
        create_trade.assert_not_called()

    @patch("app.today.update_trade")
    @patch("app.today.create_trade")
    @patch("app.today.list_trades")
    def test_replace_mode_updates_existing_id(self, list_trades, create_trade, update_trade):
        list_trades.return_value = [self.trade]
        update_trade.side_effect = lambda trade_id, trade: trade
        result = today.import_trades(self.request("replace", price=20.5))
        self.assertEqual(result["replaced_count"], 1)
        self.assertEqual(result["trades"][0]["id"], "existing-1")
        update_trade.assert_called_once()
        create_trade.assert_not_called()

    @patch("app.today.create_trade")
    @patch("app.today.list_trades")
    def test_allow_mode_imports_as_new(self, list_trades, create_trade):
        list_trades.return_value = [self.trade]
        create_trade.side_effect = lambda trade: trade
        result = today.import_trades(self.request("allow"))
        self.assertEqual(len(result["trades"]), 1)
        self.assertNotEqual(result["trades"][0]["id"], "existing-1")
        create_trade.assert_called_once()


class PortfolioPnlTests(unittest.TestCase):
    def setUp(self):
        self.key = ("CN", "CNY", "600001")
        self.snapshot = {
            "as_of": "2026-10-01", "account": "Default account", "imported_at": "2026-10-01T10:00:00Z",
            "rows": [{"symbol": "Test Co", "code": "600001.SH", "market": "CN", "currency": "CNY", "quantity": 100, "market_price": 10}],
        }
        self.prices = {self.key: [
            {"date": "2026-10-01", "close": 10},
            {"date": "2026-10-02", "close": 11},
            {"date": "2026-10-03", "close": 13},
            {"date": "2026-10-04", "close": 12},
        ]}

    def test_daily_pnl_marks_snapshot_holdings_and_applies_uploaded_trades(self):
        trades = [{
            "time": "2026-10-03T14:00:00", "type": "Buy", "symbol": "Test Co", "code": "600001",
            "market": "CN", "currency": "CNY", "price": 12, "qty": 10,
        }]
        result = today._calculate_portfolio_pnl([self.snapshot], trades, self.prices, "2026-10-01", "2026-10-04")
        self.assertEqual([(item["date"], item["pnl_by_currency"]["CNY"]) for item in result["days"]], [
            ("2026-10-02", 100), ("2026-10-03", 210), ("2026-10-04", -110),
        ])

    def test_unimported_trades_have_no_effect_and_requested_range_is_respected(self):
        result = today._calculate_portfolio_pnl([self.snapshot], [], self.prices, "2026-10-03", "2026-10-04")
        self.assertEqual([(item["date"], item["pnl_by_currency"]["CNY"]) for item in result["days"]], [
            ("2026-10-03", 200), ("2026-10-04", -100),
        ])

    def test_new_snapshot_resets_baseline_and_suppresses_that_day(self):
        next_snapshot = {
            "as_of": "2026-10-03", "account": "Default account", "imported_at": "2026-10-03T18:00:00Z",
            "rows": [{"symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 50, "market_price": 13}],
        }
        result = today._calculate_portfolio_pnl([self.snapshot, next_snapshot], [], self.prices, "2026-10-01", "2026-10-04")
        self.assertEqual([(item["date"], item["pnl_by_currency"]["CNY"]) for item in result["days"]], [
            ("2026-10-02", 100), ("2026-10-04", -50),
        ])


class PortfolioOverviewTests(unittest.TestCase):
    def test_existing_snapshot_positions_are_backfilled_into_queryable_table(self):
        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as temporary_directory, patch.object(storage, "DATABASE_PATH", Path(temporary_directory) / "portfolio.sqlite3"):
            today._ensure_today_storage()
            with storage.database() as connection:
                connection.execute("INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at) VALUES (?, ?, ?, ?, ?)", (
                    "old-snapshot", "2026-10-01", "Default account",
                    json.dumps([{"symbol": "Test Co", "code": "600001", "market": "CN", "asset_class": "Stock", "currency": "CNY", "quantity": 100}]),
                    "2026-10-01T18:00:00Z",
                ))
            today._ensure_today_storage()
            with storage.database() as connection:
                position = connection.execute("SELECT symbol, market, currency, quantity FROM today_holding_positions WHERE snapshot_id = ?", ("old-snapshot",)).fetchone()
            self.assertEqual(tuple(position), ("Test Co", "CN", "CNY", 100))

    def test_assets_market_value_and_holding_pnl_follow_trades(self):
        snapshot = {"as_of": "2026-10-01", "total_assets": 5000, "total_assets_currency": "CNY", "rows": [
            {"symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 9, "market_value": 1000, "market_price": 10},
        ]}
        trades = [{"time": "2026-10-02T10:00:00", "type": "Buy", "symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "price": 12, "qty": 10}]
        prices = {("CN", "CNY", "600001"): [{"date": "2026-10-01", "close": 10}, {"date": "2026-10-02", "close": 11}]}

        result = today._calculate_portfolio_overview(snapshot, trades, prices, "2026-10-02")

        self.assertEqual(result["total_assets"], {"amount": 5090, "currency": "CNY"})
        self.assertEqual(result["holding_pnl_by_currency"], {"CNY": 190})
        self.assertEqual(result["categories"][0]["value_by_currency"], {"CNY": 1210})

    def test_mixed_currencies_are_not_summed_as_total_assets(self):
        snapshot = {"as_of": "2026-10-01", "total_assets": 5000, "total_assets_currency": "CNY", "rows": [
            {"symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 9, "market_value": 1000, "market_price": 10},
            {"symbol": "HK Co", "code": "00700.HK", "market": "HK", "currency": "HKD", "quantity": 1, "average_cost": 90, "market_value": 100, "market_price": 100},
        ]}
        prices = {("CN", "CNY", "600001"): [{"date": "2026-10-01", "close": 10}, {"date": "2026-10-02", "close": 11}], ("HK", "HKD", "00700.HK"): [{"date": "2026-10-01", "close": 100}, {"date": "2026-10-02", "close": 101}]}

        baseline = today._calculate_portfolio_overview(snapshot, [], prices, "2026-10-01")
        result = today._calculate_portfolio_overview(snapshot, [], prices, "2026-10-02")

        self.assertEqual(baseline["total_assets"], {"amount": 5000, "currency": "CNY"})
        self.assertIsNone(result["total_assets"])
        self.assertEqual({item["category"]: item["value_by_currency"] for item in result["categories"]}, {"CN": {"CNY": 1100}, "HK": {"HKD": 101}})
