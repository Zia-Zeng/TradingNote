import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import instrument_resolver, storage, today
from app.main import TradeRecord, add_trade
from app.today import ImportedTrade, TradeImportRequest

ZIJIN = {"code": "02259", "name": "紫金黄金国际", "market": "HK", "currency": "HKD", "asset_class": "Stock"}


def _offline_providers():
    def fail(_query):
        raise RuntimeError("network unavailable")
    return {
        "eastmoney": fail,
        "akshare": fail,
        "yahoo": fail,
    }


class InstrumentResolverTests(unittest.TestCase):
    def setUp(self):
        data_dir = Path(storage.DATABASE_PATH).parent
        self._temp = tempfile.TemporaryDirectory(dir=data_dir)
        self.addCleanup(self._temp.cleanup)
        self._patch = patch.object(storage, "DATABASE_PATH", Path(self._temp.name) / "resolver.sqlite3")
        self._patch.start()
        self.addCleanup(self._patch.stop)
        storage.initialize_storage()

    def test_exact_name_match_is_resolved_and_cached(self):
        with (
            patch.object(instrument_resolver, "_eastmoney_search", return_value=[ZIJIN]),
            patch.object(instrument_resolver, "_akshare_list", side_effect=RuntimeError("offline")),
            patch.object(instrument_resolver, "_yahoo_search", side_effect=RuntimeError("offline")),
        ):
            resolved = instrument_resolver.resolve_instrument("紫金黄金国际", "HK", "HKD")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["code"], "02259")
        self.assertEqual(resolved["market"], "HK")
        self.assertFalse(resolved["cached"])

        # The persisted alias answers later lookups without any provider.
        offline = _offline_providers()
        with (
            patch.object(instrument_resolver, "_eastmoney_search", side_effect=offline["eastmoney"]),
            patch.object(instrument_resolver, "_akshare_list", side_effect=offline["akshare"]),
            patch.object(instrument_resolver, "_yahoo_search", side_effect=offline["yahoo"]),
        ):
            cached = instrument_resolver.resolve_instrument("紫金黄金国际")
        self.assertEqual(cached["code"], "02259")
        self.assertTrue(cached["cached"])

    def test_inexact_matches_are_rejected(self):
        near_match = {**ZIJIN, "name": "紫金黄金"}
        with (
            patch.object(instrument_resolver, "_eastmoney_search", return_value=[near_match]),
            patch.object(instrument_resolver, "_akshare_list", return_value=[]),
            patch.object(instrument_resolver, "_yahoo_search", return_value=[]),
        ):
            resolved = instrument_resolver.resolve_instrument("紫金黄金国际", "HK", "HKD")
        self.assertIsNone(resolved)
        self.assertIsNone(storage.get_instrument_alias("紫金黄金国际"))

    def test_apply_keeps_existing_code_and_fills_missing_one(self):
        coded = {"symbol": "紫金黄金国际", "code": "02259", "market": "HK", "currency": "HKD"}
        with patch.object(instrument_resolver, "resolve_instrument") as resolve:
            instrument_resolver.apply_resolved_instrument(coded)
        resolve.assert_not_called()

        with patch.object(instrument_resolver, "resolve_instrument", return_value={"code": "02259", "market": "HK", "currency": "HKD", "asset_class": "Stock"}):
            filled = instrument_resolver.apply_resolved_instrument({"symbol": "紫金黄金国际", "market": "HK", "currency": "HKD"})
        self.assertEqual(filled["code"], "02259")

    def test_import_trades_resolves_name_only_rows(self):
        today._ensure_today_storage()
        request = TradeImportRequest(trades=[ImportedTrade(
            time="2026-10-08 14:31", type="Buy", symbol="紫金黄金国际",
            market="HK", currency="HKD", price=138.5, qty=100,
        )])
        with patch.object(instrument_resolver, "_eastmoney_search", return_value=[ZIJIN]):
            result = today.import_trades(request)
        self.assertEqual(result["trades"][0]["code"], "02259")
        self.assertEqual(storage.list_trades()[0]["code"], "02259")

    def test_add_trade_resolves_name_only_records(self):
        payload = TradeRecord(time="2026-10-08 14:31", type="Buy", symbol="紫金黄金国际", market="HK", currency="HKD", price=138.5, qty=100)
        with patch.object(instrument_resolver, "_eastmoney_search", return_value=[ZIJIN]):
            saved = add_trade(payload)
        self.assertEqual(saved["code"], "02259")
        self.assertEqual(saved["market"], "HK")

    def test_unresolved_names_are_saved_without_code(self):
        today._ensure_today_storage()
        request = TradeImportRequest(trades=[ImportedTrade(
            time="2026-10-08 14:31", type="Buy", symbol="未知资产", market="CN", currency="CNY", price=10, qty=1,
        )])
        offline = _offline_providers()
        with (
            patch.object(instrument_resolver, "_eastmoney_search", side_effect=offline["eastmoney"]),
            patch.object(instrument_resolver, "_akshare_list", side_effect=offline["akshare"]),
            patch.object(instrument_resolver, "_yahoo_search", side_effect=offline["yahoo"]),
        ):
            result = today.import_trades(request)
        self.assertIsNone(result["trades"][0].get("code"))
        self.assertEqual(len(result["trades"]), 1)


if __name__ == "__main__":
    unittest.main()
