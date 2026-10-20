import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import parse_qs, urlparse

from app import market_data, stocks, storage, today


async def _run_in_threadpool_inline(function, *args, **kwargs):
    return function(*args, **kwargs)


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
    def setUp(self):
        # Tests assert provider selection; a daily-history cache hit must not
        # bypass the patched Yahoo provider and make the result order-dependent.
        with market_data._HISTORY_CACHE_LOCK:
            market_data._HISTORY_CACHE.clear()

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
            "indicators": {"quote": [{"open": [99.5], "high": [101.0], "low": [98.75], "close": [100.25]}]},
        }], "error": None}}).encode()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = response

        result = market_data._yahoo_history("AAPL", "2026-10-19", "2026-10-19")

        self.assertEqual(result["bars"], [{"date": "2026-10-19", "close": 100.25, "open": 99.5, "high": 101.0, "low": 98.75}])

    @patch("app.market_data._yahoo_history")
    def test_mainland_history_uses_yahoo_when_regional_sources_are_unavailable(self, yahoo_history):
        yahoo_history.return_value = {"bars": [{"date": "2026-10-16", "close": 25.0}]}
        with patch.dict("os.environ", {"MARKET_DATA_PROVIDER_ORDER": ""}), patch("app.market_data.run_in_threadpool", new=_run_in_threadpool_inline):
            result = asyncio.run(market_data.fetch_a_share_history("601899", "2026-10-10", "2026-10-18"))
        yahoo_history.assert_called_once_with("601899.SS", "2026-10-10", "2026-10-18")
        self.assertEqual(result["latest_close"], 25.0)

    @patch("app.market_data._yahoo_history")
    def test_hong_kong_numeric_code_gets_exchange_suffix(self, yahoo_history):
        yahoo_history.return_value = {"bars": [{"date": "2026-10-16", "close": 12.0}]}
        with patch("app.market_data.run_in_threadpool", new=_run_in_threadpool_inline):
            asyncio.run(market_data.fetch_daily_history("02259", "HK", "2026-10-10", "2026-10-18"))
        yahoo_history.assert_called_once_with("2259.HK", "2026-10-10", "2026-10-18")


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

    @patch("app.today.create_trade")
    @patch("app.today.list_trades")
    def test_same_import_request_is_idempotent_and_identical_source_is_skipped(self, list_trades, create_trade):
        list_trades.return_value = []
        create_trade.side_effect = lambda trade: trade
        source_hash = "b" * 64
        first_request = self.request("skip")
        first_request.idempotency_key = "trade-import-example-1"
        first_request.source_hashes = [source_hash]
        second_request = self.request("skip")
        second_request.idempotency_key = "trade-import-example-2"
        second_request.source_hashes = [source_hash]

        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as temporary_directory, \
                patch.object(storage, "DATABASE_PATH", Path(temporary_directory) / "trade-import.sqlite3"):
            first = today.import_trades(first_request)
            replay = today.import_trades(first_request)
            skipped = today.import_trades(second_request)
            changed_request = self.request("skip", price=21)
            changed_request.idempotency_key = "trade-import-example-3"
            changed_request.source_hashes = [source_hash]
            with self.assertRaisesRegex(Exception, "imported before"):
                today.import_trades(changed_request)

        self.assertEqual(first["trades"], replay["trades"])
        self.assertTrue(replay["idempotent_replay"])
        self.assertEqual(skipped["skipped_count"], 1)
        create_trade.assert_called_once()


class InitialAccountStateImportTests(unittest.TestCase):
    def test_initial_state_is_valued_at_anchor_date_and_is_idempotent(self):
        request = today.HoldingsImportRequest(
            as_of="2026-10-13", account="Default account", total_assets=100000,
            total_assets_currency="CNY", idempotency_key="holdings-example-20261013",
            source_hashes=["a" * 64], rows=[
                {"symbol": "紫金矿业", "code": "601899", "market": "CN", "currency": "CNY", "quantity": 200, "average_cost": 34.25},
                {"symbol": "紫金黄金国际", "code": "02259", "market": "HK", "currency": "HKD", "quantity": 100, "average_cost": 138.98},
            ],
        )

        async def prices(code, market, start_date, end_date):
            close = 35.0 if market == "CN" else 140.0
            return {"bars": [{"date": "2026-10-13", "close": close}]}

        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as temporary_directory, \
                patch.object(storage, "DATABASE_PATH", Path(temporary_directory) / "initial-state.sqlite3"), \
                patch("app.today.fetch_daily_history", side_effect=prices):
            first = asyncio.run(today.import_holding_snapshot(request))
            replay = asyncio.run(today.import_holding_snapshot(request))
            with storage.database() as connection:
                count = connection.execute("SELECT COUNT(*) FROM today_holding_snapshots").fetchone()[0]

        self.assertEqual(first["as_of"], "2026-10-13")
        self.assertEqual([row["market_value"] for row in first["rows"]], [7000, 14000])
        self.assertIsNone(first["initial_cash"], "Mixed-currency holdings must not be subtracted from CNY total assets without FX.")
        self.assertTrue(replay["idempotent_replay"])
        self.assertEqual(first["id"], replay["id"])
        self.assertEqual(count, 1)


class DailyTradeReviewContextTests(unittest.TestCase):
    def test_context_counts_records_and_builds_traceable_history(self):
        trades = [
            {
                "id": "old-1", "time": "2026-10-17T10:00:00", "type": "Buy", "symbol": "Test Co", "code": "600001",
                "motive": {"tags": ["Trend"], "desc": "Breakout"},
                "plan": {"tp": 12, "sl": 9, "desc": "Exit below support"},
            },
            {
                "id": "today-1", "time": "2026-10-18T14:00:00", "type": "Sell", "symbol": "Test Co", "code": "600001",
                "motive": {"tags": ["Stop Loss"], "desc": "Support failed"},
                "plan": {"desc": "Follow the prior stop"}, "note": "Closed without delay",
            },
        ]
        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as temporary_directory, \
                patch.object(storage, "DATABASE_PATH", Path(temporary_directory) / "review.sqlite3"), \
                patch("app.today.list_trades", return_value=trades):
            today._ensure_today_storage()
            with storage.database() as connection:
                connection.execute(
                    "INSERT INTO today_notes (id, trade_date, text, created_at) VALUES (?, ?, ?, ?)",
                    ("note-1", "2026-10-18", "Watch whether support recovers.", "2026-10-18T15:00:00Z"),
                )
            context = today._trade_review_context("2026-10-18")

        self.assertEqual(context["record_coverage"], {
            "trade_count": 1, "motive_count": 1, "plan_count": 1, "trade_note_count": 1, "daily_note_count": 1,
        })
        self.assertEqual([item["id"] for item in context["prior_same_asset_trades"]], ["old-1"])
        self.assertIn("trade:old-1", context["_evidence_by_id"])
        self.assertIn("note:note-1", context["_evidence_by_id"])


class SeparateDailyGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_trade_review_saves_only_trade_part_and_filters_unknown_references(self):
        context = {
            "trade_date": "2026-10-18",
            "today_trades": [{"id": "today-1", "symbol": "Test Co"}],
            "prior_same_asset_trades": [], "recent_trades": [], "recent_notes": [],
            "record_coverage": {"trade_count": 1, "motive_count": 0, "plan_count": 0, "trade_note_count": 0, "daily_note_count": 0},
            "evidence_catalog": [{"ref_id": "trade:today-1", "label": "Today", "excerpt": "Saved trade"}],
            "_evidence_by_id": {"trade:today-1": {"ref_id": "trade:today-1", "label": "Today", "excerpt": "Saved trade"}},
        }
        model_json = json.dumps({
            "overview": "One trade; motive, plan, and note were not recorded.",
            "focus_next": ["Record the invalidation condition before the next trade."],
            "trade_reviews": [{
                "trade_id": "today-1", "symbol": "Test Co", "review": "There is insufficient evidence to assess adherence.",
                "evidence_refs": ["trade:today-1", "trade:invented"],
            }],
        })
        with patch("app.today._trade_review_context", return_value=context), \
                patch("app.today._market_news_context", new=AsyncMock(return_value={"results": [], "warning": None})), \
                patch("app.today._deepseek_json", new=AsyncMock(return_value=model_json)), \
                patch("app.today._save_daily_review_part") as save:
            result = await today.generate_trade_reviews("2026-10-18")

        save.assert_called_once()
        self.assertEqual(save.call_args.args[1], "trades")
        self.assertEqual(result["trade_reviews"][0]["evidence_refs"], ["trade:today-1"])
        self.assertEqual(result["trade_review_market_news"], [])

    async def test_summary_saves_only_summary_part(self):
        context = {"trade_date": "2026-10-18", "portfolio_result": {"pnl_by_currency": {"CNY": 12}}, "today_trades": [], "today_notes": []}
        with patch("app.today._daily_summary_context", new=AsyncMock(return_value=context)), \
                patch("app.today._deepseek_json", new=AsyncMock(return_value='{"summary":"Portfolio gained CNY 12."}')), \
                patch("app.today._save_daily_review_part") as save:
            result = await today.generate_daily_summary("2026-10-18")

        save.assert_called_once()
        self.assertEqual(save.call_args.args[1], "summary")
        self.assertEqual(result["summary"], "Portfolio gained CNY 12.")


class PortfolioPnlTests(unittest.TestCase):
    def setUp(self):
        self.key = ("CN", "CNY", "600001")
        self.snapshot = {
            "as_of": "2026-10-01", "account": "Default account", "imported_at": "2026-10-01T10:00:00Z",
            "rows": [{"symbol": "Test Co", "code": "600001.SH", "market": "CN", "currency": "CNY", "quantity": 100, "market_price": 10}],
        }
        self.prices = {self.key: [
            {"date": "2026-09-30", "close": 9},
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
        self.assertEqual([(item["date"], item["pnl_by_currency"].get("CNY"), item["complete"]) for item in result["days"]], [
            ("2026-10-01", None, False), ("2026-10-02", 100, True), ("2026-10-03", 210, True), ("2026-10-04", -110, True),
        ])

    def test_unimported_trades_have_no_effect_and_requested_range_is_respected(self):
        result = today._calculate_portfolio_pnl([self.snapshot], [], self.prices, "2026-10-03", "2026-10-04")
        self.assertEqual([(item["date"], item["pnl_by_currency"]["CNY"]) for item in result["days"]], [
            ("2026-10-03", 200), ("2026-10-04", -100),
        ])

    def test_new_snapshot_resets_baseline_and_recalculates_that_day(self):
        next_snapshot = {
            "as_of": "2026-10-03", "account": "Default account", "imported_at": "2026-10-03T18:00:00Z",
            "rows": [{"symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 50, "market_price": 13}],
        }
        result = today._calculate_portfolio_pnl([self.snapshot, next_snapshot], [], self.prices, "2026-10-01", "2026-10-04")
        self.assertEqual([(item["date"], item["pnl_by_currency"].get("CNY"), item["complete"]) for item in result["days"]], [
            ("2026-10-01", None, False), ("2026-10-02", 100, True), ("2026-10-03", 200, False), ("2026-10-04", -50, True),
        ])
        self.assertTrue(result["days"][2]["snapshot_mismatch"])

    def test_snapshot_market_price_creates_anchor_without_claiming_upload_day_pnl(self):
        prices = {self.key: [
            {"date": "2026-09-30", "close": 9},
            {"date": "2026-10-01", "close": 10},
        ]}

        result = today._calculate_portfolio_pnl([self.snapshot], [], prices, "2026-10-01", "2026-10-01")

        self.assertEqual(len(result["days"]), 1)
        self.assertEqual(result["days"][0]["date"], "2026-10-01")
        self.assertFalse(result["days"][0]["complete"])
        self.assertEqual(result["days"][0]["reason"], "snapshot_anchor")

    def test_missing_instrument_does_not_hide_other_positions_and_weekends_are_omitted(self):
        other_key = ("CN", "CNY", "600002")
        snapshots = [{**self.snapshot, "rows": [
            *self.snapshot["rows"],
            {"symbol": "Other Co", "code": "600002", "market": "CN", "currency": "CNY", "quantity": 50},
        ]}]
        prices = {
            self.key: [
                {"date": "2026-10-01", "close": 10},
                {"date": "2026-10-02", "close": 11},
                {"date": "2026-10-05", "close": 12},
            ],
            other_key: [
                {"date": "2026-10-01", "close": 20},
                {"date": "2026-10-05", "close": 22},
            ],
        }

        result = today._calculate_portfolio_pnl(snapshots, [], prices, "2026-10-01", "2026-10-05")

        self.assertEqual([item["date"] for item in result["days"]], ["2026-10-01", "2026-10-02", "2026-10-05"])
        self.assertFalse(result["days"][1]["complete"])
        self.assertEqual(result["days"][1]["pnl_by_currency"], {"CNY": 100})
        self.assertEqual(result["days"][1]["missing_instruments"][0]["code"], "600002")
        self.assertFalse(result["days"][2]["complete"])
        self.assertEqual(result["days"][2]["pnl_by_currency"], {"CNY": 100})

    def test_october_13_baseline_and_following_a_share_sessions_calculate_trade_day_pnl(self):
        key = ("CN", "CNY", "600362")
        snapshot = {"as_of": "2026-10-13", "account": "Default account", "imported_at": "2026-10-13T10:00:00Z", "rows": [
            {"symbol": "江西铜业", "code": "600362", "market": "CN", "currency": "CNY", "quantity": 0},
        ]}
        prices = {key: [
            {"date": "2026-10-13", "close": 41.55},
            {"date": "2026-10-14", "close": 41.10},
            {"date": "2026-10-15", "close": 38.90},
            {"date": "2026-10-16", "close": 39.43},
            {"date": "2026-10-19", "close": 38.99},
        ]}
        trades = [{"time": "2026-10-14", "type": "Buy", "symbol": "江西铜业", "code": "600362", "market": "CN", "currency": "CNY", "price": 22, "qty": 22}]

        result = today._calculate_portfolio_pnl([snapshot], trades, prices, "2026-10-13", "2026-10-19")

        self.assertEqual([item["date"] for item in result["days"]], ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"])
        self.assertEqual([result["days"][i]["pnl_by_currency"].get("CNY") for i in (1, 2, 3)], [420.2, -48.4, 11.66])


class PortfolioOverviewTests(unittest.TestCase):
    def test_reported_total_assets_remain_visible_when_current_valuation_is_incomplete(self):
        snapshot = {"as_of": "2026-10-13", "total_assets": 100000, "total_assets_currency": "CNY", "rows": [
            {"symbol": "Unknown", "code": "600000", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 10},
        ]}

        result = today._calculate_portfolio_overview(snapshot, [], {}, "2026-10-19")

        self.assertEqual(result["total_assets"], {"amount": 100000, "currency": "CNY", "as_of": "2026-10-13", "stale": True})
        self.assertFalse(result["holdings_market_value_complete"])

    def test_latest_trade_price_is_a_degraded_valuation_fallback(self):
        snapshot = {"as_of": "2026-10-13", "total_assets": 100000, "total_assets_currency": "CNY", "rows": [
            {"symbol": "Base", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 9, "market_value": 1000, "market_price": 10},
        ]}
        trades = [{"time": "2026-10-14", "type": "Buy", "symbol": "New", "code": "600362", "market": "CN", "currency": "CNY", "price": 22, "qty": 10}]
        prices = {("CN", "CNY", "600001"): [{"date": "2026-10-13", "close": 10}, {"date": "2026-10-19", "close": 11}]}

        result = today._calculate_portfolio_overview(snapshot, trades, prices, "2026-10-19")

        self.assertEqual(result["holdings_market_value_by_currency"], {"CNY": 1320})
        self.assertEqual(result["total_assets"]["amount"], 100100)
        self.assertTrue(result["total_assets"]["estimated"])
        self.assertTrue(any("latest recorded trade price" in warning for warning in result["warnings"]))

    def test_snapshot_market_value_remains_visible_when_newer_prices_are_unavailable(self):
        snapshot = {"as_of": "2026-10-14", "total_assets": None, "total_assets_currency": None, "rows": [
            {"symbol": "Test Co", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 2, "market_price": 12, "market_value": 24},
        ]}

        result = today._calculate_portfolio_overview(snapshot, [], {}, "2026-10-18")

        self.assertIsNone(result["total_assets"])
        self.assertEqual(result["holdings_market_value_by_currency"], {"CNY": 24})
        self.assertTrue(result["holdings_market_value_complete"])

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

        self.assertEqual(result["total_assets"], {"amount": 5090, "currency": "CNY", "as_of": "2026-10-02", "stale": False, "estimated": False})
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

        self.assertEqual(baseline["total_assets"], {"amount": 5000, "currency": "CNY", "as_of": "2026-10-01", "stale": False})
        self.assertEqual(result["total_assets"], {"amount": 5000, "currency": "CNY", "as_of": "2026-10-01", "stale": True})
        self.assertEqual({item["category"]: item["value_by_currency"] for item in result["categories"]}, {"CN": {"CNY": 1100}, "HK": {"HKD": 101}})
