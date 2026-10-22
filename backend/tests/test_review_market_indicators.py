import unittest

from app.main import REVIEW_MARKET_INDICATORS, _normalize_review_market_background


class ReviewMarketIndicatorTests(unittest.TestCase):
    def test_only_the_seven_prompt_indicators_survive(self):
        reply = """## Market Background
| Indicator | Value |
| --- | --- |
| Source / as of | Wind / today |
| Range start closing price (2026-04-27) | ¥5.86 |
| Lowest closing price | ¥5.10 |
| Highest close | ¥9.10 |
| Ending close | ¥7.02 |
| Price change over supplied period | +19.80% |
| First entry day change | +6.28% |
| Second entry day change | -2.00% |
| Price change on final exit date | Not applicable; no exit recorded |

The price rose, then pulled back.

## Your Trading Action
A recorded buy.
"""
        normalized = _normalize_review_market_background(reply)
        market_section = normalized.split("## Your Trading Action")[0]
        rows = [line.split("|")[1:3] for line in market_section.splitlines()
                if line.startswith("|")][2:]

        self.assertEqual([row[0].strip() for row in rows], list(REVIEW_MARKET_INDICATORS))
        self.assertEqual([row[1].strip() for row in rows],
                         ["¥5.86", "¥5.10", "¥9.10", "¥7.02", "+19.80%", "+6.28%", "-"])
        self.assertNotIn("Source / as of", normalized)
        self.assertNotIn("Second entry day change", normalized)
        self.assertIn("The price rose, then pulled back.", normalized)
        self.assertIn("## Your Trading Action", normalized)

    def test_missing_indicators_use_dashes(self):
        normalized = _normalize_review_market_background(
            "## Market Background\n| Indicator | Value |\n| --- | --- |\n| Period Return | -3.2% |\n"
        )
        self.assertIn("| Starting Close | - |", normalized)
        self.assertIn("| Period Return | -3.2% |", normalized)
        self.assertIn("| Exit Day Change | - |", normalized)


if __name__ == "__main__":
    unittest.main()
