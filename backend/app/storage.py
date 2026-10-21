from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator
from uuid import uuid4


DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "tradingnote.sqlite3"
REVIEW_PRESET_QUESTION = "Can you review my recent trades and point out any mistakes?"
INSIGHTS_PRESET_QUESTION = "Tag me and analyze my recent trading style"
DRAFT_PRESET_QUESTION = "Help me draft a solid investment plan based on my recent holdings."
INSIGHTS_MESSAGE_PREFIX = "BEHAVIOR_INSIGHTS_JSON:"


def _conversation_title(title: str, first_reply: str | None, first_model_user: str | None) -> str:
    if (first_reply or "").startswith("Here is the detailed review for ") or "\naction: review\n" in (first_model_user or ""):
        return REVIEW_PRESET_QUESTION
    if "\naction: draft\n" in (first_model_user or ""):
        return DRAFT_PRESET_QUESTION
    return title


@contextmanager
def database() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_storage() -> None:
    with database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                model_content TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id
            ON messages(conversation_id, id);

            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS asset_notes (
                id TEXT PRIMARY KEY,
                asset_key TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_asset_notes_asset_created
            ON asset_notes(asset_key, created_at DESC);

            CREATE TABLE IF NOT EXISTS daily_feeds (
                feed_date TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def get_daily_feed(feed_date: str) -> dict[str, Any] | None:
    with database() as connection:
        row = connection.execute(
            "SELECT payload FROM daily_feeds WHERE feed_date = ?",
            (feed_date,),
        ).fetchone()
    return json.loads(row["payload"]) if row else None


def save_daily_feed(feed_date: str, payload: dict[str, Any]) -> dict[str, Any]:
    with database() as connection:
        connection.execute(
            "INSERT INTO daily_feeds (feed_date, payload, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(feed_date) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at",
            (feed_date, json.dumps(payload, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
        )
    return payload


def get_recent_model_messages(conversation_id: str, limit: int) -> list[dict[str, str]]:
    with database() as connection:
        rows = connection.execute(
            """
            SELECT role, content, model_content
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (conversation_id, limit),
        ).fetchall()

    return [
        {
            "role": row["role"],
            "content": row["model_content"] or row["content"],
        }
        for row in reversed(rows)
    ]


def save_turn(
    conversation_id: str,
    user_content: str,
    model_user_content: str,
    assistant_content: str,
    created_at: str,
    title: str | None = None,
    assistant_model_content: str | None = None,
) -> None:
    with database() as connection:
        connection.execute(
            """
            INSERT INTO conversations (id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
            """,
            (conversation_id, (title or user_content)[:100], created_at, created_at),
        )
        connection.executemany(
            """
            INSERT INTO messages (conversation_id, role, content, model_content, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (conversation_id, "user", user_content, model_user_content, created_at),
                (conversation_id, "assistant", assistant_content, assistant_model_content, created_at),
            ],
        )


def list_conversations(limit: int) -> list[dict[str, str | int]]:
    with database() as connection:
        rows = connection.execute(
            """
            SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS message_count,
                   (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'assistant' ORDER BY id LIMIT 1) AS first_reply,
                   (SELECT model_content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY id LIMIT 1) AS first_model_user
            FROM conversations AS c
            LEFT JOIN messages AS m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [
        {
            "conversation_id": row["id"],
            "title": _conversation_title(row["title"], row["first_reply"], row["first_model_user"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "message_count": row["message_count"],
        }
        for row in rows
    ]


def get_conversation(conversation_id: str) -> dict[str, object] | None:
    with database() as connection:
        conversation = connection.execute(
            "SELECT id, title, created_at, updated_at, (SELECT content FROM messages WHERE conversation_id = conversations.id AND role = 'assistant' ORDER BY id LIMIT 1) AS first_reply, (SELECT model_content FROM messages WHERE conversation_id = conversations.id AND role = 'user' ORDER BY id LIMIT 1) AS first_model_user FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            return None

        messages = connection.execute(
            """
            SELECT role, content, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id
            """,
            (conversation_id,),
        ).fetchall()

    return {
        "conversation_id": conversation["id"],
        "title": _conversation_title(conversation["title"], conversation["first_reply"], conversation["first_model_user"]),
        "created_at": conversation["created_at"],
        "updated_at": conversation["updated_at"],
        "messages": [dict(row) for row in messages],
    }


def create_trade(trade: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            "INSERT INTO trades (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (trade["id"], json.dumps(trade, ensure_ascii=False), now, now),
        )
        _invalidate_portfolio_states(connection, str(trade.get("time") or trade.get("trade_date") or "")[:10])
    return trade


def list_trades() -> list[dict[str, Any]]:
    with database() as connection:
        rows = connection.execute(
            "SELECT payload FROM trades ORDER BY updated_at DESC, created_at DESC"
        ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def get_trade(trade_id: str) -> dict[str, Any] | None:
    with database() as connection:
        row = connection.execute("SELECT payload FROM trades WHERE id = ?", (trade_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def update_trade(trade_id: str, trade: dict[str, Any]) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        previous = connection.execute("SELECT payload FROM trades WHERE id = ?", (trade_id,)).fetchone()
        cursor = connection.execute(
            "UPDATE trades SET payload = ?, updated_at = ? WHERE id = ?",
            (json.dumps(trade, ensure_ascii=False), now, trade_id),
        )
        if cursor.rowcount and previous:
            old_trade = json.loads(previous["payload"])
            dates = [str(value or "")[:10] for value in (old_trade.get("time") or old_trade.get("trade_date"), trade.get("time") or trade.get("trade_date"))]
            _invalidate_portfolio_states(connection, min((value for value in dates if value), default=""))
    return trade if cursor.rowcount else None


def delete_trade(trade_id: str) -> bool:
    with database() as connection:
        previous = connection.execute("SELECT payload FROM trades WHERE id = ?", (trade_id,)).fetchone()
        cursor = connection.execute("DELETE FROM trades WHERE id = ?", (trade_id,))
        if cursor.rowcount and previous:
            trade = json.loads(previous["payload"])
            _invalidate_portfolio_states(connection, str(trade.get("time") or trade.get("trade_date") or "")[:10])
    return cursor.rowcount > 0


def list_asset_notes(asset_key: str) -> list[dict[str, str]]:
    with database() as connection:
        rows = connection.execute(
            "SELECT id, asset_key, content, created_at FROM asset_notes WHERE asset_key = ? ORDER BY created_at DESC, rowid DESC",
            (asset_key,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_asset_note(asset_key: str, content: str) -> dict[str, str]:
    note = {
        "id": str(uuid4()),
        "asset_key": asset_key,
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with database() as connection:
        connection.execute(
            "INSERT INTO asset_notes (id, asset_key, content, created_at) VALUES (?, ?, ?, ?)",
            (note["id"], note["asset_key"], note["content"], note["created_at"]),
        )
    return note


def update_asset_note(note_id: str, asset_key: str, content: str) -> dict[str, str] | None:
    with database() as connection:
        cursor = connection.execute(
            "UPDATE asset_notes SET content = ? WHERE id = ? AND asset_key = ?",
            (content, note_id, asset_key),
        )
        if not cursor.rowcount:
            return None
        row = connection.execute(
            "SELECT id, asset_key, content, created_at FROM asset_notes WHERE id = ?",
            (note_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_asset_note(note_id: str, asset_key: str) -> bool:
    with database() as connection:
        cursor = connection.execute(
            "DELETE FROM asset_notes WHERE id = ? AND asset_key = ?",
            (note_id, asset_key),
        )
    return cursor.rowcount > 0


def _invalidate_portfolio_states(connection: sqlite3.Connection, from_date: str) -> None:
    if not from_date:
        return
    exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'today_portfolio_daily_states'").fetchone()
    if exists:
        connection.execute("DELETE FROM today_portfolio_daily_states WHERE state_date >= ?", (from_date,))
