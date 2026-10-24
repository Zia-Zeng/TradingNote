import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from app import main, storage
from app.main import AssetNoteCreate


class AssetNoteSourceTests(unittest.TestCase):
    def test_review_suggestion_is_one_note_even_when_save_is_retried(self):
        content = "Review Trades · Suggestions\n\n" + "\n\n".join(
            f"Future scenario: {index}\nSignal: signal {index}\nResponse plan: plan {index}"
            for index in range(1, 5)
        )
        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, \
                patch.object(storage, "DATABASE_PATH", Path(directory) / "notes.sqlite3"), \
                patch.object(main, "list_trades", return_value=[{"type": "Buy", "symbol": "京东方A", "code": "000725"}]):
            storage.initialize_storage()
            payload = main.ReviewNoteCreate(asset="京东方A", content=content)
            first = main.add_review_note(payload)
            retry = main.add_review_note(payload)
            notes = storage.list_asset_notes("code:000725")
            self.assertEqual(first["id"], retry["id"])
            self.assertEqual(first["route"], "000725")
            self.assertEqual(len(notes), 1)
            self.assertEqual(notes[0]["content"], content)
            self.assertEqual(notes[0]["content"].count("Future scenario:"), 4)

    def test_ai_review_can_be_one_long_note_while_manual_limit_stays_140(self):
        content = "Future scenario\nSignal\nResponse plan\n\n" * 12
        with self.assertRaises(ValidationError):
            AssetNoteCreate(asset_key="code:002475", content=content)
        ai_note = AssetNoteCreate(asset_key="code:002475", content=content, source="ai_review")

        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, patch.object(storage, "DATABASE_PATH", Path(directory) / "notes.sqlite3"):
            storage.initialize_storage()
            saved = storage.create_asset_note(ai_note.asset_key, ai_note.content, ai_note.source)
            self.assertEqual(saved["source"], "ai_review")
            self.assertEqual(storage.list_asset_notes(ai_note.asset_key)[0]["content"], ai_note.content)
            self.assertIsNone(storage.update_asset_note(saved["id"], ai_note.asset_key, content, "manual"))
            self.assertEqual(storage.update_asset_note(saved["id"], ai_note.asset_key, content + "More", "ai_review")["source"], "ai_review")

    def test_old_review_notes_are_tagged_during_migration(self):
        with tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent) as directory, patch.object(storage, "DATABASE_PATH", Path(directory) / "notes.sqlite3"):
            with closing(sqlite3.connect(storage.DATABASE_PATH)) as connection:
                connection.execute("CREATE TABLE asset_notes (id TEXT PRIMARY KEY, asset_key TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)")
                connection.executemany(
                    "INSERT INTO asset_notes VALUES (?, 'code:002475', ?, '2026-10-21T00:00:00+00:00')",
                    [("ai", "Review Trades · Strong rally\nSignal: rising volume"), ("manual", "My own observation")],
                )
                connection.commit()
            storage.initialize_storage()
            notes = {note["id"]: note for note in storage.list_asset_notes("code:002475")}
            self.assertEqual(notes["ai"]["source"], "ai_review")
            self.assertEqual(notes["manual"]["source"], "manual")


if __name__ == "__main__":
    unittest.main()
