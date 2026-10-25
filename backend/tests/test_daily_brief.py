import unittest
from datetime import datetime, timezone

from app.daily_brief import build_daily_brief


def _missing_index(market: str, name: str, trade_date: str, status: str) -> dict:
    return {"market": market, "name": name, "date": trade_date, "status": status, "change_pct": None}


def _brief_without_moves(trade_date: str, benchmarks: list[dict], now: datetime, **extra) -> dict:
    return build_daily_brief({
        "trade_date": trade_date, "portfolio_status": "unavailable", "portfolio_result": None,
        "market_benchmarks": benchmarks, **extra,
    }, now=now)


class DailyBriefTests(unittest.TestCase):
    def test_three_indices_and_verified_sector_rankings_are_separate_facts_for_narrator(self):
        brief = build_daily_brief({
            "trade_date": "2026-10-20", "portfolio_status": "unavailable", "portfolio_result": None,
            "market_benchmarks": [
                {"name": "Shanghai Composite", "date": "2026-10-20", "status": "complete", "change_pct": 0.12},
                {"name": "Shenzhen Component", "date": "2026-10-20", "status": "complete", "change_pct": -0.14},
                {"name": "ChiNext", "date": "2026-10-20", "status": "complete", "change_pct": -0.26},
            ],
            "market_sector_performance": [
                {"name": "Industrials", "date": "2026-10-20", "status": "complete", "change_pct": 1.2},
                {"name": "Information Technology", "date": "2026-10-20", "status": "complete", "change_pct": 0.9},
                {"name": "Energy", "date": "2026-10-20", "status": "complete", "change_pct": -0.7},
                {"name": "Materials", "date": "2026-10-20", "status": "complete", "change_pct": -0.4},
            ],
        })
        self.assertIn("Shanghai Composite +0.12%", brief["market"]["text"])
        self.assertIn("ChiNext -0.26%", brief["market"]["text"])
        self.assertEqual([item["name"] for item in brief["market"]["leaders"]], ["Industrials", "Information Technology"])
        self.assertEqual([item["name"] for item in brief["market"]["laggards"]], ["Energy", "Materials"])

    def test_imported_industry_context_is_kept_for_ai_but_hidden_from_market_fact_line(self):
        brief = build_daily_brief({
            "trade_date": "2026-10-20", "portfolio_status": "unavailable", "portfolio_result": None,
            "market_benchmarks": [{"name": "Shanghai Composite", "date": "2026-10-20", "status": "complete", "change_pct": 0.12}],
            "industry_performance": [{"name": "Information Technology", "date": "2026-10-20", "status": "complete", "change_pct": 1.75, "related_holdings": ["京东方A"]}],
        })
        self.assertEqual(brief["market"]["text"], "Shanghai Composite +0.12%.")
        self.assertEqual(brief["market"]["sectors"][0]["related_holdings"], ["京东方A"])

    def test_imported_positions_are_calculated_without_whole_account_snapshot(self):
        brief = build_daily_brief({
            "trade_date": "2026-06-22", "portfolio_status": "complete",
            "market_benchmarks": [{"name": "CSI 300", "date": "2026-06-22", "status": "complete", "change_pct": 2.39}],
            "industry_performance": [],
            "portfolio_result": {
                "pnl_by_currency": {"CNY": 158.3199},
                "attribution": [{"symbol": "东方睿力", "code": "000725.SZ", "currency": "CNY", "pnl": 158.3199}],
                "complete": True,
            },
        })
        self.assertEqual(brief["market"]["text"], "CSI 300 +2.39%.")
        self.assertEqual(brief["portfolio"]["status"], "estimated")
        self.assertEqual(brief["portfolio"]["scope"], "recorded_securities")
        self.assertIsNone(brief["portfolio"]["daily_return_pct"])
        self.assertEqual(brief["winners"][0]["name"], "东方睿力")
        self.assertNotIn("账户实际", brief["market"]["text"])

    def test_missing_or_wrong_date_market_data_is_hidden(self):
        brief = build_daily_brief({
            "trade_date": "2026-06-22", "portfolio_status": "unavailable", "portfolio_result": None,
            "market_benchmarks": [{"name": "CSI 300", "date": "2026-06-19", "status": "complete", "change_pct": 2.39}],
            "industry_performance": [{"name": "Materials", "date": "2026-06-22", "status": "unavailable", "change_pct": None, "related_holdings": ["A"]}],
        })
        self.assertEqual(brief["market"]["text"], "Market data is currently unavailable.")
        self.assertEqual(brief["portfolio"]["status"], "unavailable")
        self.assertEqual(brief["winners"], [])

    def test_contribution_mismatch_hides_ranking(self):
        brief = build_daily_brief({
            "trade_date": "2026-06-22", "portfolio_status": "complete",
            "market_benchmarks": [], "industry_performance": [],
            "portfolio_result": {"pnl_by_currency": {"CNY": 100}, "attribution": [{"symbol": "A", "currency": "CNY", "pnl": 20}]},
        })
        self.assertEqual(brief["winners"], [])
        self.assertTrue(any("do not reconcile" in warning for warning in brief["caveats"]))

    def test_conflicted_snapshot_suppresses_amounts(self):
        brief = build_daily_brief({
            "trade_date": "2026-06-22", "portfolio_status": "complete",
            "market_benchmarks": [], "industry_performance": [],
            "portfolio_result": {"pnl_by_currency": {"CNY": 100}, "snapshot_mismatch": True},
        })
        self.assertEqual(brief["portfolio"]["amounts"], [])

    def test_weekend_is_reported_as_market_closed_not_unavailable(self):
        gold = {"market": "COMMODITY", "name": "Gold futures", "code": "GC=F", "date": "2026-10-24", "status": "unavailable", "close": None, "change_pct": None}
        brief = _brief_without_moves(
            "2026-10-24", [_missing_index("CN", "CSI 300", "2026-10-24", "no_session")],
            datetime(2026, 10, 24, 13, 57, tzinfo=timezone.utc), market_commodities=[gold],
        )
        self.assertEqual(brief["market"]["status"], "closed")
        self.assertEqual(brief["market"]["text"], "The A-share market was closed on Saturday, 2026-10-24 (weekend).")
        self.assertEqual(brief["portfolio"]["status"], "market_closed")
        self.assertEqual(brief["portfolio"]["text"], "No daily P&L because the A-share market was closed on this date.")
        self.assertEqual(brief["caveats"], [])

    def test_weekend_closure_does_not_depend_on_data_fetch(self):
        brief = _brief_without_moves("2026-10-25", [
            _missing_index("CN", "CSI 300", "2026-10-25", "unavailable"),
            _missing_index("HK", "Hang Seng Index", "2026-10-25", "unavailable"),
            _missing_index("US", "S&P 500", "2026-10-25", "no_session"),
        ], datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc))
        self.assertEqual(brief["market"]["text"], "The A-share, Hong Kong, and U.S. markets were closed on Sunday, 2026-10-25 (weekend).")
        self.assertEqual(brief["portfolio"]["text"], "No daily P&L because the A-share, Hong Kong, and U.S. markets were closed on this date.")

    def test_past_weekday_without_a_session_is_a_market_holiday(self):
        gold = {"market": "COMMODITY", "name": "Gold futures", "code": "GC=F", "date": "2026-10-01", "status": "complete", "close": 2650.5, "change_pct": 0.4}
        brief = _brief_without_moves(
            "2026-10-01", [_missing_index("CN", "CSI 300", "2026-10-01", "no_session")],
            datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc), market_commodities=[gold],
        )
        self.assertEqual(brief["market"]["text"], "The A-share market was closed on Thursday, 2026-10-01 (market holiday).")
        self.assertEqual(len(brief["market"]["commodities"]), 1)
        self.assertEqual(brief["portfolio"]["status"], "market_closed")

    def test_missing_close_on_the_review_day_is_pending_not_closed(self):
        brief = _brief_without_moves(
            "2026-10-23", [_missing_index("CN", "CSI 300", "2026-10-23", "no_session")],
            datetime(2026, 10, 23, 1, 39, tzinfo=timezone.utc),
        )
        self.assertEqual(brief["market"]["status"], "pending")
        self.assertEqual(brief["market"]["text"], "Closing index data for Friday, 2026-10-23 was not yet available when this review was generated.")
        self.assertEqual(brief["portfolio"]["status"], "unavailable")

    def test_us_session_still_trading_after_beijing_midnight_is_pending(self):
        brief = _brief_without_moves(
            "2026-10-23", [_missing_index("US", "S&P 500", "2026-10-23", "no_session")],
            datetime(2026, 10, 23, 18, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(brief["market"]["status"], "pending")

    def test_fetch_failure_on_a_trading_day_stays_unavailable(self):
        brief = _brief_without_moves(
            "2026-10-22", [_missing_index("CN", "CSI 300", "2026-10-22", "unavailable")],
            datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(brief["market"]["status"], "unavailable")
        self.assertEqual(brief["market"]["text"], "Market data is currently unavailable.")
        self.assertIn("Verified index data is unavailable for this date.", brief["caveats"])
        self.assertEqual(brief["portfolio"]["status"], "unavailable")

    def test_crypto_never_closes_so_partial_closure_is_explained(self):
        brief = _brief_without_moves("2026-10-24", [
            _missing_index("CN", "CSI 300", "2026-10-24", "no_session"),
            _missing_index("CRYPTO", "Bitcoin", "2026-10-24", "unavailable"),
        ], datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc))
        self.assertEqual(
            brief["market"]["text"],
            "The A-share market was closed on Saturday, 2026-10-24 (weekend). Index data for other markets was not available when this review was generated.",
        )
        self.assertEqual(brief["portfolio"]["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
