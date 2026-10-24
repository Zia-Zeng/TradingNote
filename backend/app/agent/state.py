import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..storage import database

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def initialize() -> None:
    with database() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS agent_conversation_state (
                conversation_id TEXT PRIMARY KEY, focus_json TEXT NOT NULL,
                turn_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_runs (
                run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, client_msg_id TEXT UNIQUE,
                request_hash TEXT NOT NULL, tier TEXT NOT NULL, status TEXT NOT NULL,
                steps INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0,
                prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
                latency_ms INTEGER NOT NULL DEFAULT 0, guard_flags TEXT NOT NULL DEFAULT '[]',
                error TEXT, response_json TEXT, created_at TEXT NOT NULL, finished_at TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_active_conversation
                ON agent_runs(conversation_id) WHERE status = 'running';
            CREATE TABLE IF NOT EXISTS agent_steps (
                run_id TEXT NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL,
                tool_name TEXT, args_redacted TEXT, ok INTEGER NOT NULL,
                error_code TEXT, evidence_id TEXT, result_bytes INTEGER NOT NULL DEFAULT 0,
                latency_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id, idx)
            );
        """)


def start(payload: Any, conversation_id: str, timeout_s: float, tier: str = "agent") -> tuple[str, str, dict[str, Any] | None]:
    """Claim a run slot; returns (run_id, conversation_id, replayed_response)."""
    request_hash = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    timestamp = now_iso()
    with database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=timeout_s + 5)).isoformat()
        connection.execute("UPDATE agent_runs SET status='failed', error='INTERRUPTED', finished_at=? WHERE status='running' AND created_at<?", (timestamp, cutoff))
        if payload.client_msg_id:
            existing = connection.execute("SELECT run_id, conversation_id, request_hash, status, response_json FROM agent_runs WHERE client_msg_id=?", (payload.client_msg_id,)).fetchone()
            if existing:
                if existing["request_hash"] != request_hash:
                    raise HTTPException(status_code=409, detail="This client_msg_id was already used for another message.")
                if existing["response_json"]:
                    return existing["run_id"], existing["conversation_id"], json.loads(existing["response_json"])
                if existing["status"] == "running":
                    raise HTTPException(status_code=409, detail="This message is still being answered.")
                # A failed attempt releases its id so the client can retry the same message.
                connection.execute("UPDATE agent_runs SET client_msg_id=NULL WHERE run_id=?", (existing["run_id"],))
        run_id = str(uuid4())
        try:
            connection.execute("INSERT INTO agent_runs(run_id, conversation_id, client_msg_id, request_hash, tier, status, created_at) VALUES(?,?,?,?,?,'running',?)", (run_id, conversation_id, payload.client_msg_id, request_hash, tier, timestamp))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="A response is already running in this conversation.") from exc
    return run_id, conversation_id, None


def focus(conversation_id: str) -> dict[str, Any]:
    with database() as connection:
        row = connection.execute("SELECT focus_json FROM agent_conversation_state WHERE conversation_id=?", (conversation_id,)).fetchone()
    return json.loads(row[0]) if row else {}


def history(conversation_id: str, limit: int) -> list[dict[str, str]]:
    # Raw content only: legacy turns store whole context blobs in model_content.
    with database() as connection:
        rows = connection.execute("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?", (conversation_id, limit)).fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def step(run_id: str, idx: int, kind: str, *, tool_name: str | None = None, args: dict | None = None, ok: bool = True, error: str | None = None, evidence_id: str | None = None, result_bytes: int = 0, latency_ms: int = 0) -> None:
    with database() as connection:
        connection.execute("INSERT INTO agent_steps VALUES(?,?,?,?,?,?,?,?,?,?)", (run_id, idx, kind, tool_name, json.dumps(args, ensure_ascii=False, default=str) if args is not None else None, int(ok), error, evidence_id, result_bytes, latency_ms))


class Trace:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.idx = 0

    def add(self, kind: str, **fields: Any) -> None:
        self.idx += 1
        try:
            step(self.run_id, self.idx, kind, **fields)
        except sqlite3.Error as exc:
            logger.warning("Agent trace write failed (%s).", type(exc).__name__)


def finish(run_id: str, response: dict[str, Any] | None, *, status: str, payload: Any, conversation_id: str, focus_data: dict[str, Any] | None, steps: int, tools: int, usage: dict[str, int], latency_ms: int, flags: list[str], error: str | None = None, persist_turn: bool = True) -> None:
    timestamp = now_iso()
    with database() as connection:
        if response and persist_turn:
            connection.execute("INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at", (conversation_id, payload.message[:100], timestamp, timestamp))
            connection.executemany("INSERT INTO messages(conversation_id,role,content,model_content,created_at) VALUES(?,?,?,?,?)", [(conversation_id, "user", payload.message, payload.message, response["created_at"]), (conversation_id, "assistant", response["reply"], response["reply"][:4000], response["created_at"])])
        if response and focus_data is not None:
            connection.execute("INSERT INTO agent_conversation_state VALUES(?,?,1,?) ON CONFLICT(conversation_id) DO UPDATE SET focus_json=excluded.focus_json,turn_count=turn_count+1,updated_at=excluded.updated_at", (conversation_id, json.dumps(focus_data, ensure_ascii=False), timestamp))
        connection.execute("UPDATE agent_runs SET status=?,steps=?,tool_calls=?,prompt_tokens=?,completion_tokens=?,latency_ms=?,guard_flags=?,error=?,response_json=?,finished_at=? WHERE run_id=?", (status, steps, tools, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), latency_ms, json.dumps(flags), error, json.dumps(response, ensure_ascii=False) if response else None, timestamp, run_id))


def get_run(run_id: str) -> dict[str, Any] | None:
    with database() as connection:
        row = connection.execute("SELECT run_id,conversation_id,tier,status,steps,tool_calls,prompt_tokens,completion_tokens,latency_ms,guard_flags,error,created_at,finished_at FROM agent_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            return None
        steps = connection.execute("SELECT idx,kind,tool_name,args_redacted,ok,error_code,evidence_id,result_bytes,latency_ms FROM agent_steps WHERE run_id=? ORDER BY idx", (run_id,)).fetchall()
    result = dict(row)
    result["guard_flags"] = json.loads(result["guard_flags"])
    result["trace"] = [{**dict(item), "args_redacted": json.loads(item["args_redacted"]) if item["args_redacted"] else None} for item in steps]
    return result
