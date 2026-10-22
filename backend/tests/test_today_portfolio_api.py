import asyncio
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app import storage, today


class PortfolioApiPersistenceTests(unittest.TestCase):
    def test_snapshot_market_value_is_visible_without_provider_closes(self):
        data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=data_dir) as temp_dir:
            with patch.object(storage, "DATABASE_PATH", Path(temp_dir) / "portfolio.sqlite3"):
                storage.initialize_storage()
                today._ensure_today_storage()
                with today.database() as connection:
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, snapshot_scope) VALUES (?, ?, ?, ?, ?, ?)",
                        ("baseline", "2026-10-20", "Default account", json.dumps([{
                            "symbol": "Test asset", "code": "002475", "market": "CN", "currency": "CNY",
                            "quantity": 10, "market_value": 125,
                        }]), "2026-10-20T00:00:00+00:00", "FULL_ACCOUNT"),
                    )
                with patch.object(today, "fetch_daily_history", side_effect=RuntimeError("Provider unavailable")):
                    result = asyncio.run(today.get_portfolio_overview(date(2026, 10, 20)))
                self.assertEqual(result["holdings_market_value_by_currency"], {"CNY": 125.0})
                self.assertEqual(result["positions_count"], 1)

    def test_saved_closes_value_snapshot_plus_later_trades_when_provider_fails(self):
        data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=data_dir) as temp_dir:
            with patch.object(storage, "DATABASE_PATH", Path(temp_dir) / "portfolio.sqlite3"):
                storage.initialize_storage()
                today._ensure_today_storage()
                with today.database() as connection:
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, snapshot_scope) VALUES (?, ?, ?, ?, ?, ?)",
                        ("baseline", "2026-10-20", "Default account", json.dumps([{
                            "symbol": "Test asset", "code": "002475", "market": "CN", "currency": "CNY",
                            "quantity": 10, "average_cost": 10, "market_value": 100,
                        }]), "2026-10-20T00:00:00+00:00", "FULL_ACCOUNT"),
                    )
                storage.create_trade({"id": "earlier", "time": "2026-10-19 10:00", "type": "Buy", "symbol": "Test asset", "code": "002475", "market": "CN", "currency": "CNY", "price": 9, "qty": 100})
                with today.database() as connection:
                    connection.execute("UPDATE trades SET created_at = ? WHERE id = ?", ("2026-10-19T00:00:00+00:00", "earlier"))
                storage.create_trade({"id": "later", "time": "2026-10-21 10:00", "type": "Buy", "symbol": "Test asset", "code": "002475", "market": "CN", "currency": "CNY", "price": 11, "qty": 5})
                storage.save_market_history_segment("CN", "002475", "2026-10-06", "2026-10-21", "Saved provider", [
                    {"date": "2026-10-20", "close": 10}, {"date": "2026-10-21", "close": 11},
                ])
                with patch.object(today, "fetch_daily_history", side_effect=RuntimeError("Provider unavailable")):
                    result = asyncio.run(today.get_portfolio_pnl(date(2026, 10, 20), date(2026, 10, 21)))
                self.assertEqual(result["baseline_date"], "2026-10-19")
                self.assertEqual(result["days"][-1]["daily_state"]["positions"][0]["quantity"], 15)
                self.assertEqual(result["days"][-1]["daily_state"]["holdings_market_value_by_currency"], {"CNY": 165.0})

    def test_calendar_starts_day_after_first_trade_before_later_snapshot(self):
        data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=data_dir) as temp_dir:
            with patch.object(storage, "DATABASE_PATH", Path(temp_dir) / "portfolio.sqlite3"):
                storage.initialize_storage()
                today._ensure_today_storage()
                with today.database() as connection:
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, snapshot_scope) VALUES (?, ?, ?, ?, ?, ?)",
                        ("baseline", "2026-10-20", "Default account", json.dumps([{
                            "symbol": "Coca-Cola", "code": "KO.N", "market": "US", "currency": "USD",
                            "quantity": 2, "average_cost": 90, "market_price": 93,
                        }]), "2026-10-20T00:00:00+00:00", "FULL_ACCOUNT"),
                    )
                storage.create_trade({"id": "first", "time": "2026-04-15", "type": "Buy", "symbol": "Coca-Cola", "code": "KO.N", "market": "US", "currency": "USD", "price": 90, "qty": 2})
                with today.database() as connection:
                    connection.execute("UPDATE trades SET created_at = ? WHERE id = ?", ("2026-04-15T00:00:00+00:00", "first"))
                storage.save_market_history_segment("US", "KO.N", "2026-04-01", "2026-10-21", "Saved provider", [
                    {"date": "2026-04-15", "close": 90}, {"date": "2026-04-16", "close": 91},
                    {"date": "2026-10-19", "close": 92}, {"date": "2026-10-20", "close": 93},
                    {"date": "2026-10-21", "close": 94},
                ])
                with patch.object(today, "fetch_daily_history", side_effect=RuntimeError("Provider unavailable")):
                    result = asyncio.run(today.get_portfolio_pnl(date(2026, 4, 15), date(2026, 10, 21)))
                by_date = {day["date"]: day for day in result["days"]}
                self.assertEqual(result["baseline_date"], "2026-04-15")
                self.assertNotIn("2026-04-15", by_date)
                self.assertEqual(by_date["2026-04-16"]["pnl_by_currency"], {"USD": 2.0})
                self.assertEqual(by_date["2026-10-20"]["pnl_by_currency"], {"USD": 2.0})
                self.assertTrue(by_date["2026-10-20"]["complete"])
                self.assertEqual(by_date["2026-10-21"]["pnl_by_currency"], {"USD": 2.0})

    def test_newly_recorded_older_trades_extend_snapshot_once(self):
        data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=data_dir) as temp_dir:
            with patch.object(storage, "DATABASE_PATH", Path(temp_dir) / "portfolio.sqlite3"):
                storage.initialize_storage()
                today._ensure_today_storage()
                with today.database() as connection:
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, snapshot_scope) VALUES (?, ?, ?, ?, ?, ?)",
                        ("baseline", "2026-10-20", "Default account", json.dumps([{
                            "symbol": "CN asset", "code": "002475", "market": "CN", "currency": "CNY",
                            "quantity": 10, "average_cost": 10, "market_price": 10,
                        }]), "2026-10-20T00:00:00+00:00", "FULL_ACCOUNT"),
                    )
                for id, trade_date, side, qty in [
                    ("ko-buy-1", "2026-04-15", "Buy", 2),
                    ("ko-sell", "2026-05-08", "Sell", 3),
                    ("ko-buy-2", "2026-08-10", "Buy", 3),
                    ("ko-buy-3", "2026-08-28", "Buy", 3),
                    ("ko-buy-4", "2026-09-23", "Buy", 2),
                ]:
                    storage.create_trade({"id": id, "time": trade_date, "type": side, "symbol": "Coca-Cola", "code": "KO.N", "market": "US", "currency": "USD", "price": 90, "qty": qty})
                storage.create_trade({"id": "cn-later", "time": "2026-10-21", "type": "Buy", "symbol": "CN asset", "code": "002475", "market": "CN", "currency": "CNY", "price": 11, "qty": 1})
                storage.save_market_history_segment("CN", "002475", "2026-10-06", "2026-10-21", "Saved provider", [
                    {"date": "2026-10-20", "close": 10}, {"date": "2026-10-21", "close": 11},
                ])
                storage.save_market_history_segment("US", "KO.N", "2026-10-06", "2026-10-21", "Saved provider", [
                    {"date": "2026-10-20", "close": 92}, {"date": "2026-10-21", "close": 92.68},
                ])
                with patch.object(today, "fetch_daily_history", side_effect=RuntimeError("Provider unavailable")):
                    overview = asyncio.run(today.get_portfolio_overview(date(2026, 10, 21)))
                    pnl = asyncio.run(today.get_portfolio_pnl(date(2026, 10, 20), date(2026, 10, 21)))
                self.assertEqual(overview["holdings_market_value_by_currency"], {"CNY": 121.0, "USD": 741.44})
                self.assertEqual({row["code"]: row["quantity"] for row in overview["positions"]}, {"002475": 11.0, "KO.N": 8.0})
                self.assertEqual(pnl["days"][-1]["daily_state"]["holdings_market_value_by_currency"], {"CNY": 121.0, "USD": 741.44})
                self.assertTrue(any("backfilled sell exceeds" in warning for warning in overview["warnings"]))

    def test_daily_states_are_materialized_and_rebuilt_after_historical_trade(self):
        data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=data_dir) as temp_dir:
            db_path = Path(temp_dir) / "portfolio.sqlite3"
            with patch.object(storage, "DATABASE_PATH", db_path):
                storage.initialize_storage()
                today._ensure_today_storage()
                rows = [
                    {"symbol": "紫金矿业", "code": "601899", "market": "CN", "currency": "CNY", "quantity": 200, "average_cost": 34.25},
                    {"symbol": "测试标的", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 10},
                ]
                with today.database() as connection:
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, total_assets, total_assets_currency, snapshot_scope, initial_cash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ("older-duplicate", "2026-10-13", "Default account", json.dumps([{"symbol": "坏代码", "code": "", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 10}], ensure_ascii=False), "2026-10-13T00:00:00+00:00", 100000, "CNY", "FULL_ACCOUNT", None),
                    )
                    connection.execute(
                        "INSERT INTO today_holding_snapshots (id, as_of, account, payload, imported_at, total_assets, total_assets_currency, snapshot_scope, initial_cash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ("baseline", "2026-10-13", "Default account", json.dumps(rows, ensure_ascii=False), "2026-10-13T00:01:00+00:00", 100000, "CNY", "FULL_ACCOUNT", 91900),
                    )

                history_calls = []
                async def fake_history(code, market, start, end):
                    history_calls.append((code, market, start, end))
                    histories = {
                        "601899": [{"date": "2026-10-13", "close": 35}, {"date": "2026-10-14", "close": 36}, {"date": "2026-10-15", "close": 37}],
                        "600001": [{"date": "2026-10-13", "close": 11}, {"date": "2026-10-14", "close": 12}, {"date": "2026-10-15", "close": 13}],
                    }
                    return {"bars": histories[code]}

                with patch.object(today, "fetch_daily_history", new=fake_history):
                    first = asyncio.run(today.get_portfolio_pnl(date(2026, 10, 14), date(2026, 10, 15)))
                    self.assertEqual(first["days"][0]["pnl_by_currency"]["CNY"], 300)
                    self.assertFalse(first["cache_hit"])
                    calls_after_first_calculation = len(history_calls)
                    cached = asyncio.run(today.get_portfolio_pnl(date(2026, 10, 14), date(2026, 10, 15)))
                    self.assertTrue(cached["cache_hit"])
                    self.assertEqual(cached["days"], first["days"])
                    self.assertEqual(len(history_calls), calls_after_first_calculation)
                    with today.database() as connection:
                        first_fingerprint = connection.execute("SELECT input_fingerprint FROM today_portfolio_daily_states WHERE state_date = '2026-10-14'").fetchone()[0]
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM today_portfolio_daily_states").fetchone()[0], 2)

                    storage.create_trade({"id": "late-buy", "time": "2026-10-14 10:00", "type": "Buy", "symbol": "测试标的", "code": "600001", "market": "CN", "currency": "CNY", "price": 12, "qty": 10, "amount": 120})
                    with today.database() as connection:
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM today_portfolio_daily_states").fetchone()[0], 0)
                    second = asyncio.run(today.get_portfolio_pnl(date(2026, 10, 14), date(2026, 10, 15)))
                    # The full-account snapshot remains the baseline; only later trades are applied.
                    self.assertEqual(second["days"][0]["pnl_by_currency"]["CNY"], 300)
                    self.assertFalse(second["cache_hit"])
                    self.assertEqual(len(history_calls), calls_after_first_calculation + 2)
                    with today.database() as connection:
                        second_fingerprint = connection.execute("SELECT input_fingerprint FROM today_portfolio_daily_states WHERE state_date = '2026-10-14'").fetchone()[0]
                        self.assertNotEqual(first_fingerprint, second_fingerprint)
                        saved_state = json.loads(connection.execute("SELECT payload FROM today_portfolio_daily_states WHERE state_date = '2026-10-14'").fetchone()[0])
                        positions = {row["code"]: row for row in saved_state["daily_state"]["positions"]}
                        self.assertEqual(positions["600001"]["quantity"], 110)


if __name__ == "__main__":
    unittest.main()
