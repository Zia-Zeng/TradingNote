import unittest

from app.portfolio_engine import roll_portfolio


class PortfolioRollForwardTests(unittest.TestCase):
    def setUp(self):
        self.baseline = {
            "as_of": "2026-10-13",
            "total_assets": 1000,
            "total_assets_currency": "CNY",
            "rows": [{"symbol": "Example", "code": "600001", "market": "CN", "currency": "CNY", "quantity": 10, "average_cost": 10}],
        }
        self.key = ("CN", "CNY", "600001")
        self.prices = {self.key: [
            {"date": "2026-10-13", "close": 12},
            {"date": "2026-10-14", "close": 15},
            {"date": "2026-10-15", "close": 15},
        ]}

    def test_buy_updates_weighted_cost_and_daily_unrealized_pnl(self):
        result = roll_portfolio(self.baseline, [{"id": "b1", "time": "2026-10-14 10:00", "type": "Buy", "code": "600001", "market": "CN", "currency": "CNY", "qty": 10, "price": 14}], self.prices, "2026-10-15")
        day = result["days"][0]
        self.assertEqual(day["pnl_by_currency"]["CNY"], 40)
        position = day["positions"][0]
        self.assertEqual(position["quantity"], 20)
        self.assertEqual(position["average_cost"], 12)
        self.assertEqual(day["daily_state"]["cash_by_currency"]["CNY"], 740)
        self.assertEqual(day["daily_state"]["total_assets_by_currency"]["CNY"], 1040)

    def test_sell_realizes_profit_against_average_cost(self):
        result = roll_portfolio(self.baseline, [
            {"id": "b1", "time": "2026-10-14 10:00", "type": "Buy", "code": "600001", "market": "CN", "currency": "CNY", "qty": 10, "price": 14},
            {"id": "s1", "time": "2026-10-15 10:00", "type": "Sell", "code": "600001", "market": "CN", "currency": "CNY", "qty": 5, "price": 16},
        ], self.prices, "2026-10-15")
        day = result["days"][1]
        self.assertEqual(day["daily_state"]["realized_pnl_by_currency"]["CNY"], 20)
        self.assertEqual(day["pnl_by_currency"]["CNY"], 5)
        self.assertEqual(day["positions"][0]["quantity"], 15)
        self.assertEqual(day["positions"][0]["average_cost"], 12)
        self.assertEqual(day["daily_state"]["cash_by_currency"]["CNY"], 820)
        self.assertEqual(day["daily_state"]["total_assets_by_currency"]["CNY"], 1045)

    def test_historical_trade_rebuild_changes_affected_states(self):
        without_trade = roll_portfolio(self.baseline, [], self.prices, "2026-10-15")
        with_trade = roll_portfolio(self.baseline, [{"id": "b1", "time": "2026-10-14 10:00", "type": "Buy", "code": "600001", "market": "CN", "currency": "CNY", "qty": 10, "price": 14}], self.prices, "2026-10-15")
        self.assertNotEqual(without_trade["days"][0]["daily_state"], with_trade["days"][0]["daily_state"])
        self.assertNotEqual(without_trade["days"][1]["daily_state"], with_trade["days"][1]["daily_state"])

    def test_user_initial_state_sample_keeps_market_currencies_separate(self):
        baseline = {
            "as_of": "2026-10-13",
            "total_assets": 100000,
            "total_assets_currency": "CNY",
            "rows": [
                {"symbol": "紫金矿业", "code": "601899", "market": "CN", "currency": "CNY", "quantity": 200, "average_cost": 34.25},
                {"symbol": "紫金黄金国际", "code": "02259", "market": "HK", "currency": "HKD", "quantity": 100, "average_cost": 138.98},
            ],
        }
        result = roll_portfolio(baseline, [], {
            ("CN", "CNY", "601899"): [{"date": "2026-10-13", "close": 35}, {"date": "2026-10-14", "close": 35.5}],
            ("HK", "HKD", "02259"): [{"date": "2026-10-13", "close": 140}, {"date": "2026-10-14", "close": 141}],
        }, "2026-10-14")
        state = result["days"][0]
        self.assertEqual(state["pnl_by_currency"], {"CNY": 100, "HKD": 100})
        self.assertFalse(state["daily_state"]["total_assets_complete"])

    def test_trade_with_clock_time_and_separate_date_is_included(self):
        result = roll_portfolio(self.baseline, [
            {"id": "b1", "date": "2026-10-14", "time": "10:45", "type": "Buy", "code": "600001", "market": "CN", "currency": "CNY", "qty": 10, "price": 14},
        ], self.prices, "2026-10-15")
        self.assertEqual(result["days"][0]["daily_state"]["positions"][0]["quantity"], 20)


if __name__ == "__main__":
    unittest.main()
