import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from app.behavior_insights import PROMPT_PATH, ModelInsights, _complete_holdings, _is_demo_trade, _style_profile_options, _validate_style_profile, build_facts, closed_trade_evidence


class BehaviorInsightsFactsTests(unittest.TestCase):
    def test_closed_trade_metrics_require_complete_priced_exit(self):
        trades = [
            {"date": "2026-10-01", "type": "Buy", "code": "AAA", "market": "US", "currency": "USD", "qty": 10, "price": 10},
            {"date": "2026-10-03", "type": "Sell", "code": "AAA", "market": "US", "currency": "USD", "qty": 4, "price": 12},
            {"date": "2026-10-05", "type": "Sell", "code": "AAA", "market": "US", "currency": "USD", "qty": 6, "price": 8},
        ]
        evidence = closed_trade_evidence(date(2026, 10, 20), trades)
        self.assertEqual(evidence, {
            "closed_trades": 1, "trades_involved": 3, "average_holding_days": 3.2,
            "win_rate_pct": 0.0, "total_closed_pnl_by_currency": {"USD": -4.0},
        })

        incomplete = closed_trade_evidence(date(2026, 10, 20), [trades[0], {**trades[2], "qty": 11}])
        self.assertEqual(incomplete["closed_trades"], 1)
        self.assertIsNone(incomplete["average_holding_days"])
        self.assertIsNone(incomplete["win_rate_pct"])
        self.assertIsNone(incomplete["total_closed_pnl_by_currency"])

    def test_style_report_response_matches_prompt_contract(self):
        report = ModelInsights.model_validate({
            "summary": "The recorded activity shows staged entries, with limited exit evidence.",
            "style_label": "Staged-entry trader",
            "style_profile": {"transaction_pace": "Moderate", "holding_period": "Short",
                              "asset_selection": "Focusing on a few core assets", "positioning_method": "Batch entry, batch exit",
                              "trading_type": "Short-term swing trading", "main_issues": "High single-asset risk exposure"},
            "trading_characteristics": [{"title": "Staged entries", "evidence": "Two recorded purchases of one asset.",
                                         "significance": "The position was built over time."}],
            "profit_structure": "Current holdings span CNY and USD.",
            "suggestion": "Record exit rules before adding to positions.",
        })
        options = _style_profile_options(PROMPT_PATH.read_text(encoding="utf-8"))
        _validate_style_profile(report.style_profile, options)
        self.assertEqual(report.style_profile.holding_period, "Short")
        with self.assertRaises(ValueError):
            _validate_style_profile(report.style_profile.model_copy(update={"holding_period": "Unavailable"}), options)
        revised_prompt = PROMPT_PATH.read_text(encoding="utf-8").replace("Holding period: Short |", "Holding period: Brief |")
        self.assertIn("Brief", _style_profile_options(revised_prompt)["holding_period"])

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

    def test_complete_today_account_assets_take_priority(self):
        snapshots = [{"as_of": "2026-10-19", "total_assets": 1000, "total_assets_currency": "CNY", "rows": []}]
        trades = [{"date": "2026-10-20", "type": "Buy", "symbol": "Alpha", "code": "AAA", "currency": "CNY", "qty": 10, "price": 10}]
        state = {"date": "2026-10-20", "complete": True, "total_assets_complete": True,
                 "total_assets_by_currency": {"CNY": 2000}, "holdings_market_value_by_currency": {"CNY": 100}, "positions": []}
        facts = build_facts(date(2026, 10, 20), snapshots, trades, state)
        self.assertEqual(facts["turnover_pct_of_latest_assets_by_currency"]["CNY"], 5)
        self.assertEqual(facts["turnover_denominator_basis"], "Today Portfolio Overview full-account assets as of 2026-10-20")



class BehaviorInsightsHoldingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_open_ledger_positions_fill_incomplete_snapshot_without_demo_trades(self):
        snapshots = [{"as_of": "2026-10-20", "total_assets": 1000, "total_assets_currency": "CNY", "rows": [
            {"symbol": "立讯精密", "code": "002475", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 67, "market_value": 4800},
        ]}]
        trades = [
            {"date": "2026-05-07", "type": "Buy", "symbol": "立讯精密", "code": "002475", "market": "CN", "currency": "CNY", "qty": 100, "price": 67},
            {"date": "2026-07-03", "type": "Buy", "symbol": "宇通客车", "code": "600066.SH", "market": "CN", "currency": "CNY", "qty": 100, "price": 28},
            {"date": "2026-08-27", "type": "Buy", "symbol": "宇通客车", "code": "600066.SH", "market": "CN", "currency": "CNY", "qty": 99, "price": 30},
            {"date": "2026-04-15", "type": "Buy", "symbol": "可口可乐", "code": "KO.N", "market": "US", "currency": "USD", "qty": 2, "price": 75},
            {"date": "2026-05-08", "type": "Sell", "symbol": "可口可乐", "code": "KO.N", "market": "US", "currency": "USD", "qty": 3, "price": 78},
            {"date": "2026-08-10", "type": "Buy", "symbol": "可口可乐", "code": "KO.N", "market": "US", "currency": "USD", "qty": 3, "price": 87},
            {"date": "2026-08-28", "type": "Buy", "symbol": "可口可乐", "code": "KO.N", "market": "US", "currency": "USD", "qty": 3, "price": 89},
            {"date": "2026-09-23", "type": "Buy", "symbol": "可口可乐", "code": "KO.N", "market": "US", "currency": "USD", "qty": 2, "price": 88},
            {"id": "demo-601899-buy", "date": "2026-10-09", "type": "Buy", "symbol": "ZIJIN MINING", "code": "601899", "market": "CN", "qty": 100, "price": 30},
        ]
        real_trades = [trade for trade in trades if not _is_demo_trade(trade)]
        state = {"date": "2026-10-21", "complete": True, "total_assets_complete": True, "total_assets_by_currency": {"CNY": 1000},
                 "positions": [{"symbol": "立讯精密", "code": "002475", "market": "CN", "currency": "CNY", "quantity": 100, "average_cost": 67, "market_value": 4800}]}

        async def history(code, market, start, end):
            return {"latest_close": {"600066.SH": 27.9, "KO.N": 92.68}[code]}

        with patch("app.behavior_insights.cached_daily_history", new=AsyncMock(side_effect=history)):
            snapshots, state = await _complete_holdings(date(2026, 10, 22), snapshots, real_trades, state)
        facts = build_facts(date(2026, 10, 22), snapshots, real_trades, state)
        holdings = {item["symbol"] for chart in facts["profit_structure"]["charts"] for item in chart["allocation"]}
        self.assertEqual(holdings, {"立讯精密", "宇通客车", "可口可乐"})
        self.assertEqual(facts["trade_count"], 7)
        self.assertEqual(facts["turnover_denominator_basis"], "Today Portfolio Overview holdings market value as of 2026-10-21 (cash excluded; proxy)")
        self.assertEqual(next(item for item in state["positions"] if item["symbol"] == "可口可乐")["quantity"], 7)


if __name__ == "__main__":
    unittest.main()
