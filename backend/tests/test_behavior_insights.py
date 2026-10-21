import unittest
from datetime import date

from app.behavior_insights import build_facts, evidence_from_facts


class BehaviorInsightsFactsTests(unittest.TestCase):
    def test_six_month_metrics_and_signed_chart_values(self):
        snapshots = [{
            "as_of": "2026-10-19", "total_assets": 1000, "total_assets_currency": "CNY",
            "rows": [
                {"symbol": "Alpha", "code": "AAA", "currency": "CNY", "quantity": 5, "average_cost": 10, "market_price": 12},
                {"symbol": "Beta", "code": "BBB", "currency": "CNY", "quantity": 10, "average_cost": 10, "market_price": 8},
            ],
        }]
        trades = [
            {"time": "2026-10-01", "type": "Buy", "symbol": "Alpha", "code": "AAA", "currency": "CNY", "qty": 10, "price": 10},
            {"time": "2026-10-05", "type": "Sell", "symbol": "Alpha", "code": "AAA", "currency": "CNY", "qty": 5, "price": 12},
            {"time": "2026-03-01", "type": "Buy", "symbol": "Beta", "code": "BBB", "currency": "CNY", "qty": 10, "price": 10},
        ]
        facts = build_facts(date(2026, 10, 20), snapshots, trades)
        self.assertEqual(facts["period_start"], "2026-04-20")
        self.assertEqual(facts["trade_count"], 2)
        self.assertEqual(facts["matched_average_holding_days"], 4)
        self.assertEqual(facts["turnover_pct_of_latest_assets_by_currency"]["CNY"], 16)
        chart = facts["profit_structure"]["charts"][0]
        self.assertEqual(sum(item["share_pct"] for item in chart["allocation"]), 100)
        self.assertEqual({item["symbol"]: item["pnl"] for item in chart["returns"]}, {"Alpha": 10, "Beta": -20})
        self.assertEqual({item["symbol"]: item["return_pct"] for item in chart["returns"]}, {"Alpha": 20, "Beta": -20})

    def test_missing_cost_and_distinct_currencies_stay_explicit(self):
        snapshots = [{"as_of": "2026-10-20", "total_assets": None, "total_assets_currency": None, "rows": [
            {"symbol": "A", "currency": "CNY", "quantity": 1, "market_value": 20},
            {"symbol": "B", "currency": "USD", "quantity": 1, "average_cost": 8, "market_value": 10},
        ]}]
        facts = build_facts(date(2026, 10, 20), snapshots, [])
        charts = facts["profit_structure"]["charts"]
        self.assertEqual([chart["currency"] for chart in charts], ["CNY", "USD"])
        self.assertIsNone(charts[0]["returns"][0]["pnl"])
        self.assertEqual(charts[1]["returns"][0]["pnl"], 2)
        self.assertEqual(facts["turnover_pct_of_latest_assets_by_currency"], {})

    def test_open_buy_lots_and_today_portfolio_value_proxy(self):
        trades = [
            {"date": "2026-10-01", "time": "10:45", "type": "Buy", "symbol": "Alpha", "code": "600066.SH", "market": "CN", "currency": "CNY", "qty": 10, "price": 10},
            {"date": "2026-10-10", "time": "14:00", "type": "Buy", "symbol": "Alpha", "code": "600066", "market": "CN", "currency": "CNY", "qty": 10, "price": 20},
        ]
        state = {"date": "2026-10-20", "complete": True, "total_assets_complete": False,
                 "total_assets_by_currency": {"CNY": -1000}, "holdings_market_value_by_currency": {"CNY": 400},
                 "positions": [{"symbol": "Alpha", "code": "600066", "currency": "CNY", "quantity": 20, "average_cost": 15, "market_value": 400}]}
        facts = build_facts(date(2026, 10, 20), [], trades, state)
        self.assertEqual(facts["matched_average_holding_days"], None)
        self.assertEqual(facts["open_average_holding_days"], 13)
        self.assertEqual(facts["turnover_pct_of_latest_assets_by_currency"]["CNY"], 75)
        self.assertIn("proxy", facts["turnover_denominator_basis"])
        self.assertEqual(facts["profit_structure"]["charts"][0]["returns"][0]["pnl"], 100)
        evidence = evidence_from_facts(facts)
        self.assertIn("13 days", evidence["holding_period"])
        self.assertIn("not full-account turnover", evidence["turnover"])

    def test_complete_today_account_assets_take_priority(self):
        snapshots = [{"as_of": "2026-10-19", "total_assets": 1000, "total_assets_currency": "CNY", "rows": []}]
        trades = [{"date": "2026-10-20", "type": "Buy", "symbol": "Alpha", "code": "AAA", "currency": "CNY", "qty": 10, "price": 10}]
        state = {"date": "2026-10-20", "complete": True, "total_assets_complete": True,
                 "total_assets_by_currency": {"CNY": 2000}, "holdings_market_value_by_currency": {"CNY": 100}, "positions": []}
        facts = build_facts(date(2026, 10, 20), snapshots, trades, state)
        self.assertEqual(facts["turnover_pct_of_latest_assets_by_currency"]["CNY"], 5)
        self.assertEqual(facts["turnover_denominator_basis"], "Today Portfolio Overview full-account assets as of 2026-10-20")



if __name__ == "__main__":
    unittest.main()
