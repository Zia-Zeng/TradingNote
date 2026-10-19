import asyncio
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app import storage, today


class PortfolioApiPersistenceTests(unittest.TestCase):
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
                    self.assertEqual(second["days"][0]["pnl_by_currency"]["CNY"], 300)
                    self.assertFalse(second["cache_hit"])
                    self.assertEqual(len(history_calls), calls_after_first_calculation * 2)
                    with today.database() as connection:
                        second_fingerprint = connection.execute("SELECT input_fingerprint FROM today_portfolio_daily_states WHERE state_date = '2026-10-14'").fetchone()[0]
                        self.assertNotEqual(first_fingerprint, second_fingerprint)
                        saved_state = json.loads(connection.execute("SELECT payload FROM today_portfolio_daily_states WHERE state_date = '2026-10-14'").fetchone()[0])
                        self.assertEqual(saved_state["daily_state"]["positions"][1]["quantity"], 110)


if __name__ == "__main__":
    unittest.main()
