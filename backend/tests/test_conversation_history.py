import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import storage


class ConversationHistoryTests(unittest.TestCase):
    def test_titles_follow_the_first_visible_prompt_and_saved_insights_restore(self):
        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, patch.object(storage, "DATABASE_PATH", Path(directory) / "history.sqlite3"):
            storage.initialize_storage()
            storage.save_turn("review", "600066", "600066", "Here is the detailed review for Example.", "2026-10-21T01:00:00+00:00")
            storage.save_turn("old-review", "601899", "601899\n\nPage context:\naction: review\nasset: 601899", "## Conclusion\nA review.", "2026-10-21T01:30:00+00:00")
            storage.save_turn("insights", storage.INSIGHTS_PRESET_QUESTION, storage.INSIGHTS_PRESET_QUESTION,
                              storage.INSIGHTS_MESSAGE_PREFIX + '{"summary":"Observed style"}', "2026-10-21T02:00:00+00:00",
                              title=storage.INSIGHTS_PRESET_QUESTION, assistant_model_content="Behavior Insights summary: Observed style")
            storage.save_turn("plain", "What happened today?", "What happened today?", "A summary.", "2026-10-21T03:00:00+00:00")
            storage.save_turn("draft", "ZIJIN MINING", "ZIJIN MINING\n\nPage context:\naction: draft\nasset: ZIJIN MINING", "A plan.", "2026-10-21T04:00:00+00:00")

            titles = {item["conversation_id"]: item["title"] for item in storage.list_conversations(10)}
            self.assertEqual(titles["review"], storage.REVIEW_PRESET_QUESTION)
            self.assertEqual(titles["old-review"], storage.REVIEW_PRESET_QUESTION)
            self.assertEqual(titles["insights"], storage.INSIGHTS_PRESET_QUESTION)
            self.assertEqual(titles["plain"], "What happened today?")
            self.assertEqual(titles["draft"], storage.DRAFT_PRESET_QUESTION)
            self.assertEqual(storage.get_conversation("review")["title"], storage.REVIEW_PRESET_QUESTION)
            self.assertTrue(storage.get_conversation("insights")["messages"][1]["content"].startswith(storage.INSIGHTS_MESSAGE_PREFIX))
            self.assertEqual(storage.get_recent_model_messages("insights", 2)[1]["content"], "Behavior Insights summary: Observed style")


if __name__ == "__main__":
    unittest.main()
