import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app import main, market_data, news_data


class TrackingContextTests(unittest.TestCase):
    def test_tracking_accepts_current_market_codes_and_earliest_trade(self):
        trade = main.TrackingTradeContext(
            id="trade-1", symbol="Example", code="600066.SH", market="CN",
            direction="Buy", timeline=[
                {"type": "Trade", "date": "2026-10-20", "action": "Sell"},
                {"type": "Trade", "date": "2026-09-30", "action": "Buy"},
            ],
        )
        self.assertEqual(main._tracking_market_identifier(trade), ("CN", "600066.SH"))
        self.assertEqual(main._tracking_history_start(trade).isoformat(), "2026-09-09")
        self.assertEqual(main._tracking_market_identifier(trade.model_copy(update={"code": "02259", "market": "HK"})), ("HK", "02259"))
        self.assertEqual(main._tracking_market_identifier(trade.model_copy(update={"code": "AAPL", "market": "US"})), ("US", "AAPL"))

    def test_tavily_mcp_rfc_date_reaches_tracking_facts(self):
        async def search(*args, **kwargs):
            return {"available": True, "results": [{
                "title": "Example company quarterly update", "url": "https://example.com/news",
                "source": "example.com", "snippet": "Example company reported results.",
                "published_date": "Thu, 08 Oct 2026 01:00:00 GMT",
            }]}

        with patch.object(news_data, "search_market_news", new=search), patch.dict("os.environ", {"TAVILY_API_KEY": ""}):
            found = asyncio.run(news_data.fetch_market_news("Example company", "600066", "CN", "2026-10-01", "2026-10-22"))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["date"], "2026-10-08")

    def test_prompt_endpoint_reads_the_file_and_version_changes_with_content(self):
        with tempfile.TemporaryDirectory() as directory:
            prompt_path = Path(directory) / "single_AI_tracking.txt"
            prompt_path.write_text("First prompt", encoding="utf-8")
            with patch.object(main, "SINGLE_TRACKING_PROMPT_PATH", prompt_path):
                first = main.tracking_prompt()
                prompt_path.write_text("Second prompt", encoding="utf-8")
                second = main.tracking_prompt()
        self.assertEqual(first["system_prompt"], "First prompt")
        self.assertEqual(second["system_prompt"], "Second prompt")
        self.assertNotEqual(first["version"], second["version"])

    def test_false_missing_evidence_claim_is_detected(self):
        analysis = main.TrackingAnalysis(
            overall_summary="Relevant news and market data were unavailable.",
            pnl_analysis="No daily bars were supplied.",
            process_evaluation="Execution was recorded.",
            lessons_learned="Record a plan.",
        )
        self.assertTrue(main._tracking_claims_missing_supplied_evidence(
            analysis, {"bars": [{"date": "2026-10-21", "close": 10.0}]}, [{"title": "Relevant news"}],
        ))

    def test_tracking_keeps_a_complete_overlong_pnl_result_after_retry(self):
        pnl = (
            "Entered Aug 10 at 87.45 near the 86.87 close; added Sep 23 at 88.15 "
            "after a bounce; Oct 22's 95.34 mark followed a rally from the Oct 2 "
            "low of 82.10, leaving the open position above both entries."
        )
        content = json.dumps({
            "overall_summary": "The position remains open.",
            "pnl_analysis": pnl,
            "process_evaluation": "The second entry followed a bounce.",
            "lessons_learned": "Record the exit rule before the next entry.",
        })
        completion = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content=content),
        )])
        create = AsyncMock(side_effect=[completion, completion])
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
            close=AsyncMock(),
        )
        request = main.TrackingAnalysisRequest(trade_context=main.TrackingTradeContext(
            id="trade-1", symbol="Example", code="AAPL", market="US", direction="Buy",
        ))
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "test-key"}), \
                patch.object(main, "cached_daily_history", new=AsyncMock(return_value={"bars": []})), \
                patch.object(main, "fetch_market_news", new=AsyncMock(return_value=[])), \
                patch.object(main, "AsyncOpenAI", return_value=client):
            result = asyncio.run(main.analyze_tracking(request))

        self.assertEqual(create.await_count, 2)
        self.assertEqual(result.analysis.pnl_analysis, pnl)
        self.assertEqual(result.tracking["pnlResult"], pnl)

    def test_a_share_default_tries_wind_before_baostock(self):
        calls = []

        async def wind(*args):
            calls.append("Wind")
            raise RuntimeError("Wind unavailable")

        def baostock(*args):
            calls.append("BaoStock")
            return [{"date": "2026-10-21", "close": 10.0}]

        async def inline(function, *args):
            return function(*args)

        with patch.dict("os.environ", {"MARKET_DATA_PROVIDER_ORDER": ""}), \
                patch.object(market_data, "_HISTORY_CACHE", {}), \
                patch.object(market_data, "_HISTORY_LOCKS", {}), \
                patch.object(market_data, "_wind_history", new=wind), \
                patch.object(market_data, "_baostock_history", new=baostock), \
                patch.object(market_data, "run_in_threadpool", new=inline):
            result = asyncio.run(market_data.fetch_a_share_history("600066", "2026-10-21", "2026-10-21"))
        self.assertEqual(calls, ["Wind", "BaoStock"])
        self.assertEqual(result["source"], "BaoStock")


if __name__ == "__main__":
    unittest.main()
