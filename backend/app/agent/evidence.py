import json
import re
from typing import Any

NOTE_TEXT_LIMIT = 1500
ENVELOPE_BYTES = 24000
NOTE_FIELDS = ("note_id", "kind", "author", "asset_key", "trade_ids", "date", "tags", "text", "plan")
HINTS = {
    "INVALID_ARGS": "修正参数格式后最多重试一次。",
    "NOT_FOUND": "本地没有找到，直接说明缺失，不要猜测。",
    "PRIVACY_BLOCKED": "本轮不能使用该工具或参数，改用已有证据回答。",
    "BUDGET_EXCEEDED": "停止调用工具，基于已有证据回答。",
    "TIMEOUT": "该数据暂不可用，说明缺口并使用已有证据。",
    "UPSTREAM_UNAVAILABLE": "外部数据暂不可用，说明缺口并使用已有证据。",
    "UNKNOWN_TOOL": "只使用提供的工具。",
    "INTERNAL_ERROR": "该数据暂不可用，说明缺口。",
}


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def size(value: Any) -> int:
    return len(dumps(value).encode("utf-8"))


def error(tool: str, code: str, message: str) -> dict:
    return {"ok": False, "tool": tool, "code": code, "message": message[:300], "hint": HINTS.get(code, "")}


def _largest_list(node: Any) -> tuple[Any, Any] | None:
    best, stack = None, [node]
    while stack:
        current = stack.pop()
        items = current.items() if isinstance(current, dict) else enumerate(current) if isinstance(current, list) else ()
        for key, value in items:
            if isinstance(value, list) and value and key != "notes":
                weight = size(value)
                if best is None or weight > best[0]:
                    best = (weight, current, key)
            if isinstance(value, (dict, list)):
                stack.append(value)
    return (best[1], best[2]) if best else None


def _fit(envelope: dict, *, preserve_notes: bool = False) -> None:
    data = envelope["data"]
    while size(envelope) > ENVELOPE_BYTES:
        found = _largest_list(data)
        if not found:
            break
        container, key = found
        container[key] = container[key][: len(container[key]) // 2]
        envelope["truncated"] = True
    notes = data.get("notes") if isinstance(data, dict) else None
    if preserve_notes and notes:
        return
    if size(envelope) > ENVELOPE_BYTES and notes:
        for note in notes:
            if len(note.get("text") or "") > NOTE_TEXT_LIMIT:
                note["text"], note["text_truncated"] = note["text"][:NOTE_TEXT_LIMIT], True
        envelope["truncated"] = True
    while size(envelope) > ENVELOPE_BYTES and data.get("notes"):
        data["notes"] = data["notes"][: len(data["notes"]) // 2]
        envelope["truncated"] = True
    if size(envelope) > ENVELOPE_BYTES:
        envelope["data"] = {"omitted": "结果过大，只保留摘要。"}
        envelope["truncated"] = True


class EvidenceBook:
    def __init__(self, user_text: str = ""):
        self.envelopes: dict[str, dict] = {}
        self.notes: dict[str, dict] = {}
        self.note_refs: dict[str, str] = {}
        self.failed: set[str] = set()
        self.user_text = user_text

    def _note(self, note: dict, full: bool) -> dict:
        ref = self.note_refs.get(note["note_id"])
        if ref is None:
            ref = self.note_refs[note["note_id"]] = f"N{len(self.note_refs) + 1}"
            self.notes[ref] = note
        item = {"ref": ref, "attribution": "你记录的" if note.get("author") == "user" else "之前保存的AI复盘（不是用户观点）",
                **{key: note[key] for key in NOTE_FIELDS if key in note}}
        if not full and len(item.get("text") or "") > NOTE_TEXT_LIMIT:
            item["text"], item["text_truncated"] = item["text"][:NOTE_TEXT_LIMIT], True
        return item

    def add(self, spec: Any, result: dict) -> dict:
        evidence_id = f"E{len(self.envelopes) + 1}"
        data = {key: value for key, value in result.items() if key not in {"summary", "truncated"}}
        if spec.kind == "notes" and isinstance(data.get("notes"), list):
            data["notes"] = [self._note(note, full=spec.name == "get_trade_dossier") for note in data["notes"]]
        envelope = {"evidence_id": evidence_id, "tool": spec.name, "ok": True, "source": spec.source(result),
                    "as_of": result.get("as_of"), "is_realtime": False,
                    "privacy": "private" if spec.privacy == "private_local" else "public",
                    "truncated": bool(result.get("truncated")), "summary": result.get("summary", ""), "data": data}
        _fit(envelope, preserve_notes=spec.name == "get_trade_dossier")
        self.envelopes[evidence_id] = envelope
        return envelope

    def has(self, ref: str) -> bool:
        return ref in self.envelopes or ref in self.notes

    def by_tool(self, *tools: str) -> list[dict]:
        return [envelope for envelope in self.envelopes.values() if envelope["tool"] in tools]

    def grounding_text(self) -> str:
        parts = [envelope["summary"] + dumps(envelope["data"]) for envelope in self.envelopes.values()]
        parts += [str(note.get("text") or "") + dumps(note.get("plan") or {}) for note in self.notes.values()]
        return "\n".join(parts)

    def urls(self) -> set[str]:
        return {article["url"] for envelope in self.by_tool("search_news")
                for article in envelope["data"].get("articles", []) if article.get("url")}

    def latest_market_date(self) -> str | None:
        dates = [str(envelope["as_of"]) for envelope in self.by_tool("get_price_history", "get_index_snapshot") if envelope.get("as_of")]
        return max(dates, default=None)


CITATION = re.compile(r"[\[【]\s*([EN]\d+(?:\s*[,，、]\s*[EN]\d+)*)\s*[\]】]")
LEGEND_MARKER = "\n\n### 引用来源\n"
TOOL_LABELS = {
    "get_trade_dossier": "交易档案", "search_notes": "笔记检索", "resolve_instrument": "标的识别",
    "search_trades": "成交记录", "get_trade_stats": "交易统计", "get_behavior_facts": "行为事实",
    "get_portfolio": "持仓概览", "get_daily_context": "当日记录", "get_price_history": "日线行情",
    "get_index_snapshot": "指数概况", "search_news": "新闻检索",
}
NOTE_LABELS = {"trade_note": "交易笔记", "asset_note": "标的笔记", "daily_note": "当日日记"}


def refs_in(group: str) -> list[str]:
    return re.split(r"\s*[,，、]\s*", group)


def citations(text: str) -> list[str]:
    return [ref for group in CITATION.findall(text) for ref in refs_in(group)]


def _legend_line(ref: str, book: EvidenceBook) -> str:
    if ref in book.notes:
        note = book.notes[ref]
        owner = f"你记录的{NOTE_LABELS.get(note.get('kind'), '笔记')}" if note.get("author") == "user" else "之前保存的AI复盘"
        parts = [owner, note.get("date") or "日期未知"]
        if note.get("asset_key"):
            parts.append(str(note["asset_key"]).rsplit(":", 1)[-1])
        return f"[{ref}] " + " · ".join(parts)
    envelope = book.envelopes[ref]
    parts = [TOOL_LABELS.get(envelope["tool"], envelope["tool"]), envelope["source"]]
    period = envelope["data"].get("period") if isinstance(envelope.get("data"), dict) else None
    if envelope.get("as_of"):
        parts.append(f"截至 {envelope['as_of']}")
    elif isinstance(period, dict) and period.get("start"):
        parts.append(f"{period['start']}~{period.get('end')}")
    return f"[{ref}] " + " · ".join(parts)


def legend(reply: str, book: EvidenceBook) -> str:
    refs = list(dict.fromkeys(ref for ref in citations(reply) if book.has(ref)))
    if not refs:
        return reply
    # Blank-line separated: the chat renderer joins adjacent lines into one paragraph.
    return reply.rstrip() + LEGEND_MARKER + "\n" + "\n\n".join(_legend_line(ref, book) for ref in refs)
