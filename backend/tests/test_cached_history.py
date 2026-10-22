import asyncio
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app import storage
from app.cached_history import cached_daily_history


class CachedHistoryTests(unittest.TestCase):
    def test_persists_bars_and_fetches_only_missing_dates(self):
        calls = []

        async def fetch(code, market, start, end):
            calls.append((code, market, start, end))
            bars = [
                {"date": day, "close": close}
                for day, close in [("2026-10-20", 10.0), ("2026-10-21", 11.0), ("2026-10-22", 12.0)]
                if start <= day <= end
            ]
            return {"source": "Test provider", "bars": bars}

        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, \
                patch.object(storage, "DATABASE_PATH", Path(directory) / "history.sqlite3"), \
                patch("app.cached_history.fetch_daily_history", new=fetch):
            storage.initialize_storage()
            first = asyncio.run(cached_daily_history("600066.SH", "CN", date(2026, 10, 20), date(2026, 10, 21)))
            repeat = asyncio.run(cached_daily_history("600066", "A-Share", date(2026, 10, 20), date(2026, 10, 21)))
            extended = asyncio.run(cached_daily_history("600066", "CN", date(2026, 10, 20), date(2026, 10, 22)))
            asyncio.run(cached_daily_history("600066", "CN", date(2026, 10, 19), date(2026, 10, 22)))

            self.assertEqual(calls, [
                ("600066", "CN", "2026-10-20", "2026-10-21"),
                ("600066", "CN", "2026-10-22", "2026-10-22"),
                ("600066", "CN", "2026-10-19", "2026-10-19"),
            ])
            self.assertEqual(first["bars"], repeat["bars"])
            self.assertEqual(len(extended["bars"]), 3)
            self.assertEqual(extended["latest_close"], 12.0)

    def test_serves_saved_bars_if_refresh_fails(self):
        calls = []

        async def fetch(code, market, start, end):
            calls.append((start, end))
            if len(calls) > 1:
                raise RuntimeError("Provider is unavailable")
            return {"source": "Test provider", "bars": [{"date": "2026-10-20", "close": 10.0}]}

        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, \
                patch.object(storage, "DATABASE_PATH", Path(directory) / "history.sqlite3"), \
                patch("app.cached_history.fetch_daily_history", new=fetch):
            storage.initialize_storage()
            asyncio.run(cached_daily_history("002475", "CN", date(2026, 10, 20), date(2026, 10, 20)))
            stale = asyncio.run(cached_daily_history("002475", "CN", date(2026, 10, 20), date(2026, 10, 21)))
            self.assertTrue(stale["refresh_failed"])
            self.assertEqual(stale["bars"], [{"date": "2026-10-20", "close": 10.0}])
            self.assertEqual(calls[-1], ("2026-10-21", "2026-10-21"))


if __name__ == "__main__":
    unittest.main()
