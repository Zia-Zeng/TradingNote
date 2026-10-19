import unittest
from types import SimpleNamespace

from app.tavily_mcp import _normalize_results, _tool_arguments


class TavilyMcpNormalizationTests(unittest.TestCase):
    def test_arguments_follow_advertised_schema_and_use_date_scope(self):
        tool = SimpleNamespace(inputSchema={"properties": {
            "query": {}, "topic": {}, "max_results": {}, "start_date": {}, "end_date": {},
        }})
        args = _tool_arguments(tool, "  market news  ", "2026-10-18", "2026-10-18", 5)
        self.assertEqual(args, {
            "query": "market news", "topic": "news", "max_results": 5,
            "start_date": "2026-10-18", "end_date": "2026-10-18",
        })

    def test_results_are_deduplicated_and_trimmed_for_model_context(self):
        rows = _normalize_results([{"results": [
            {"title": "Story", "url": "https://example.com/1", "content": "x" * 2000, "published_date": "2026-10-18"},
            {"title": "Duplicate", "url": "https://example.com/1", "content": "duplicate"},
            {"url": "https://example.com/no-title", "content": "ignored"},
        ]}], 5)
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]["snippet"]), 900)
        self.assertEqual(rows[0]["published_date"], "2026-10-18")


if __name__ == "__main__":
    unittest.main()
