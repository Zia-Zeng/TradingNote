import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import storage, summary_market, today
from app.daily_brief import build_daily_brief


class CsiSummaryMarketTests(unittest.IsolatedAsyncioTestCase):
    async def test_major_index_change_uses_exact_date_and_prior_close(self):
        def respond(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": {"klines": [
                "2026-06-19,0,100,0,0,0,0,0", "2026-06-22,0,102,0,0,0,0,0",
            ]}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            result = await summary_market._eastmoney_index_change(client, "399006", "2026-06-22")
            missing = await summary_market._eastmoney_index_change(client, "399006", "2026-06-23")
        self.assertEqual(result["change_pct"], 2.0)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(missing["status"], "no_session")

    async def test_index_quote_requires_the_selected_trade_date(self):
        def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "code": "200",
                "data": [{"tradeDate": "20261020", "changePct": 1.25}],
            })

        with tempfile.TemporaryDirectory() as temporary_directory, \
                patch.object(storage, "DATABASE_PATH", Path(temporary_directory) / "summary.sqlite3"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                result = await summary_market.csi_index_change("000300", "2026-10-21", client)

        self.assertEqual(result["status"], "no_session")
        self.assertIsNone(result["change_pct"])

    async def test_sector_is_attached_only_to_a_verified_constituent(self):
        async def constituents(_client, index_code):
            return {"as_of": "2026-10-20", "codes": ["601899"] if index_code == "932078" else []}

        async def change(_code, trade_date, _client):
            return {"date": trade_date, "change_pct": 0.94, "status": "complete", "source": "China Securities Index", "source_url": "https://www.csindex.com.cn/"}

        with patch.object(summary_market, "_constituents", new=constituents), \
                patch.object(summary_market, "csi_index_change", new=change):
            result = await summary_market.csi_industry_context(["601899.SH", "600000.SH"], "2026-10-21")

        self.assertEqual([(item["name"], item["related_symbols"]) for item in result], [("Materials", ["601899"])])

    def test_partial_portfolio_amount_is_not_reported_as_total(self):
        context = {
            "trade_date": "2026-10-21",
            "portfolio_status": "partial",
            "portfolio_result": {"complete": False, "pnl_by_currency": {"CNY": 500}, "missing_instruments": [{"code": "600000"}]},
            "market_benchmarks": [{"name": "CSI 300", "status": "complete", "change_pct": 0.3}],
            "industry_performance": [],
            "industry_status": "unavailable",
        }

        brief = build_daily_brief(context)

        self.assertIn("沪深300+0.30%", brief["market"]["text"])
        self.assertEqual(brief["portfolio"]["amounts"], [])
        self.assertEqual(brief["winners"], [])

    def test_multi_currency_amounts_do_not_create_cross_currency_ranking(self):
        context = {
            "trade_date": "2026-10-21",
            "portfolio_status": "complete",
            "portfolio_result": {
                "pnl_by_currency": {"CNY": 20, "USD": -5},
                "attribution": [
                    {"symbol": "A", "currency": "CNY", "pnl": 20},
                    {"symbol": "B", "currency": "USD", "pnl": -5},
                ],
            },
            "market_benchmarks": [],
            "industry_performance": [],
        }

        brief = build_daily_brief(context)

        self.assertEqual(brief["portfolio"]["amounts"], [
            {"currency": "CNY", "amount": 20.0}, {"currency": "USD", "amount": -5.0},
        ])
        self.assertEqual(brief["winners"], [])
        self.assertEqual(brief["losers"], [])
        self.assertTrue(any("跨币种" in warning for warning in brief["caveats"]))

    async def test_holdings_select_market_even_without_daily_attribution(self):
        pnl = {"days": [{"date": "2026-10-21", "complete": True, "pnl_by_currency": {}, "attribution": []}]}
        snapshot = {"snapshots": [{"rows": [{"market": "CN", "code": "601899"}]}]}
        with patch.object(today, "list_trades", return_value=[]), \
                patch.object(today, "get_holding_snapshot", return_value=snapshot), \
                patch.object(today, "get_portfolio_pnl", new=AsyncMock(return_value=pnl)), \
                patch.object(today, "a_share_major_indices", new=AsyncMock(return_value=[])), \
                patch.object(today, "csi_sector_performance", new=AsyncMock(return_value=[])), \
                patch.object(today, "csi_index_change", new=AsyncMock(return_value={"date": "2026-10-21", "status": "complete", "change_pct": 0.8})), \
                patch.object(today, "csi_industry_context", new=AsyncMock(return_value=[])) as industry:
            context = await today._daily_summary_context("2026-10-21")

        self.assertEqual(context["market_benchmarks"][0]["market"], "CN")
        industry.assert_awaited_once_with(["601899"], "2026-10-21")

    async def test_csi_300_supplies_mainland_benchmark(self):
        pnl = {"days": []}
        snapshot = {"snapshots": [{"rows": [{"market": "CN", "code": "601899"}]}]}
        with patch.object(today, "list_trades", return_value=[]), \
                patch.object(today, "get_holding_snapshot", return_value=snapshot), \
                patch.object(today, "get_portfolio_pnl", new=AsyncMock(return_value=pnl)), \
                patch.object(today, "a_share_major_indices", new=AsyncMock(return_value=[])), \
                patch.object(today, "csi_sector_performance", new=AsyncMock(return_value=[])), \
                patch.object(today, "csi_index_change", new=AsyncMock(return_value={"date": "2026-10-21", "status": "complete", "change_pct": 2.39})), \
                patch.object(today, "csi_industry_context", new=AsyncMock(return_value=[])):
            context = await today._daily_summary_context("2026-10-21")

        brief = build_daily_brief(context)
        self.assertEqual(brief["market"]["text"], "沪深300+2.39%。")
