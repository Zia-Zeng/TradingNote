import unittest

from app.daily_brief import build_daily_brief


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


if __name__ == "__main__":
    unittest.main()
