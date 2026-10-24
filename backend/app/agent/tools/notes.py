import json
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from ... import storage
from ..types import ToolFailure


_MARKETS = {
    "A-SHARE": "CN", "A_SHARE": "CN", "CN.SH": "CN", "CN.SS": "CN",
    "CN.SZ": "CN", "CN.BJ": "CN", "SH": "CN", "SS": "CN", "SZ": "CN", "BJ": "CN",
    "HKEX": "HK", "NYSE": "US", "NASDAQ": "US",
}
_CN_SUFFIXES = (".SH", ".SS", ".SZ", ".BJ")
_TRADE_FIELDS = ("id", "symbol", "code", "market", "currency", "time", "trade_date",
                 "type", "qty", "price", "amount", "fee")


def _text_arg(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ToolFailure("INVALID_ARGS", f"{name} must be a nonempty string.")
    return value.strip()


def _market(value):
    value = str(value or "CN").strip().upper()
    return _MARKETS.get(value, value)


def _value(value, market):
    value = str(value or "").strip().upper()
    if market == "CN":
        for suffix in _CN_SUFFIXES:
            value = value.removesuffix(suffix)
    elif market == "HK":
        value = value.removesuffix(".HK")
        if value.isascii() and value.isdigit() and len(value) <= 5:
            value = value.zfill(5)
    return value


def _selector(asset, market=None):
    asset = _text_arg(asset, "asset")
    hint = None
    if market is not None:
        hint = _market(_text_arg(market, "market"))
    prefix, separator, rest = asset.partition(":")
    if separator and _market(prefix) in {"CN", "HK", "US"}:
        explicit = _market(prefix)
        if hint and hint != explicit:
            raise ToolFailure("INVALID_ARGS", "Conflicting market selectors.")
        hint, asset = explicit, rest
    kind = None
    prefix, separator, rest = asset.partition(":")
    if separator and prefix.lower() in {"code", "symbol"}:
        kind, asset = prefix.lower(), rest
    asset = _text_arg(asset, "asset")
    suffix_market = "CN" if asset.upper().endswith(_CN_SUFFIXES) else "HK" if asset.upper().endswith(".HK") else None
    if suffix_market:
        if hint and hint != suffix_market:
            raise ToolFailure("INVALID_ARGS", "Code suffix conflicts with market.")
        hint = suffix_market
    return hint, kind, asset


def _code(trade):
    code = _value(trade.get("code"), _market(trade.get("market")))
    return "" if code == "000000" else code


def _identity(trade):
    market = _market(trade.get("market"))
    code = _code(trade)
    kind = "code" if code else "symbol"
    return f"{market}:{kind}:{code or _value(trade.get('symbol'), market)}"


def _identities(trades):
    known = {}
    for trade in trades:
        if _code(trade):
            label = (_market(trade.get("market")), _value(trade.get("symbol"), _market(trade.get("market"))))
            if label[1]:
                known.setdefault(label, set()).add(_identity(trade))
    result = {}
    for trade in trades:
        key = _identity(trade)
        label = (_market(trade.get("market")), _value(trade.get("symbol"), _market(trade.get("market"))))
        candidates = known.get(label, set())
        if not _code(trade) and len(candidates) == 1:
            key = next(iter(candidates))
        result[str(trade["id"])] = key
    return result


def _matches(trade, selector):
    hint, kind, asset = selector
    market = _market(trade.get("market"))
    if hint and hint != market:
        return False
    query = _value(asset, market)
    code = _code(trade)
    symbol = _value(trade.get("symbol"), market)
    if kind == "symbol":
        return query == symbol
    if kind == "code":
        return bool(code) and query == code
    return bool(query) and (query == symbol or bool(code) and query == code)


def _matching(trades, selector):
    identities = _identities(trades)
    keys = {identities[str(trade["id"])] for trade in trades if _matches(trade, selector)}
    return [trade for trade in trades if identities[str(trade["id"])] in keys]


def matching_trades(asset: str, market: str | None = None) -> list[dict]:
    return _matching(storage.list_trades(), _selector(asset, market))


def _iso_date(value, name="date"):
    value = _text_arg(value, name)
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ToolFailure("INVALID_ARGS", f"{name} must be an ISO date (YYYY-MM-DD).") from exc


def _trade_date(trade):
    for field in ("time", "date", "trade_date"):
        value = str(trade.get(field) or "")[:10].replace("/", "-")
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            continue
    return None


def _sort_key(trade):
    time = str(trade.get("time") or "")
    clock = time[11:] if len(time) > 10 and time[10] in {"T", " "} else time
    return _trade_date(trade) or "", clock, str(trade.get("id") or "")


def _trade_fields(trade):
    result = {field: trade.get(field) for field in _TRADE_FIELDS}
    result["trade_date"] = _trade_date(trade)
    return result


def _date_range(date_from, date_to):
    start = _iso_date(date_from, "date_from").isoformat() if date_from is not None else None
    end = _iso_date(date_to, "date_to").isoformat() if date_to is not None else None
    if start and end and start > end:
        raise ToolFailure("INVALID_ARGS", "date_from must not be after date_to.")
    return start, end


def _in_range(day, start, end):
    return (not start and not end) or bool(day and (not start or day >= start) and (not end or day <= end))


def _limit(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ToolFailure("INVALID_ARGS", f"limit must be an integer from 1 to {maximum}.")
    return value


def _asset_links(key, trades, identities):
    selector = _selector(key)
    candidates = {identities[str(trade["id"])] for trade in trades if _matches(trade, selector)}
    if len(candidates) != 1:
        return key, []
    identity = next(iter(candidates))
    return identity, sorted(str(trade["id"]) for trade in trades if identities[str(trade["id"])] == identity)


def _mentions(text, trades, identities):
    labels = {}
    for trade in trades:
        market = _market(trade.get("market"))
        values = {str(trade.get("symbol") or "").strip()}
        if _code(trade):
            values.update({_code(trade), str(trade.get("code") or "").strip()})
        for value in values - {""}:
            labels.setdefault(value.upper(), set()).add(identities[str(trade["id"])])
    found, occupied = set(), []
    for label in sorted(labels, key=lambda item: (-len(item), item)):
        pattern = re.escape(label)
        if label[0].isascii() and (label[0].isalnum() or label[0] == "_"):
            pattern = r"(?<![A-Za-z0-9_])" + pattern
        if label[-1].isascii() and (label[-1].isalnum() or label[-1] == "_"):
            pattern += r"(?![A-Za-z0-9_])"
        for match in re.finditer(pattern, text, re.IGNORECASE):
            if any(match.start() < end and match.end() > start for start, end in occupied):
                continue
            occupied.append(match.span())
            if len(labels[label]) == 1:
                found.update(labels[label])
    return found


def note_records() -> list[dict]:
    trades = storage.list_trades()
    identities = _identities(trades)
    with storage.database() as connection:
        tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        raw = {str(row["id"]): json.loads(row["payload"]) for row in connection.execute("SELECT id, payload FROM trades")}
        assets = [dict(row) for row in connection.execute("SELECT * FROM asset_notes")] if "asset_notes" in tables else []
        daily = [dict(row) for row in connection.execute("SELECT id, trade_date, text FROM today_notes")] if "today_notes" in tables else []
    records = []
    for trade in trades:
        trade_id = str(trade["id"])
        payload = raw.get(trade_id, {})
        raw_plan = payload.get("plan")
        plan = {key: raw_plan[key] for key in ("tp", "sl", "desc") if key in raw_plan and raw_plan[key] not in (None, "")} if isinstance(raw_plan, dict) else {}
        text = str(trade.get("note") or "")
        if not text.strip() and not plan:
            continue
        records.append({"note_id": f"trade:{trade_id}", "kind": "trade_note", "author": "user",
                        "asset_key": identities[trade_id], "trade_ids": [trade_id], "date": _trade_date(trade),
                        "tags": trade.get("note_tags") or [], "text": text, "plan": plan})
    for note in assets:
        key, trade_ids = _asset_links(str(note["asset_key"]), trades, identities)
        records.append({"note_id": f"asset:{note['id']}", "kind": "asset_note",
                        "author": "ai_review" if note.get("source") == "ai_review" else "user",
                        "asset_key": key, "trade_ids": trade_ids, "date": str(note.get("created_at") or "")[:10] or None,
                        "tags": [], "text": note["content"], "plan": {}})
    for note in daily:
        mentioned = _mentions(note["text"], trades, identities)
        trade_ids = sorted(str(trade["id"]) for trade in trades
                           if _trade_date(trade) == note["trade_date"] and identities[str(trade["id"])] in mentioned)
        records.append({"note_id": f"daily:{note['id']}", "kind": "daily_note", "author": "user",
                        "asset_key": next(iter(mentioned)) if len(mentioned) == 1 else None,
                        "trade_ids": trade_ids, "date": note["trade_date"], "tags": [], "text": note["text"], "plan": {}})
    return sorted(records, key=lambda note: (note["date"] or "", note["note_id"]), reverse=True)


def _note_matches(note, selector, keys):
    if note.get("asset_key") in keys:
        return True
    key = note.get("asset_key")
    if not key:
        return False
    hint, kind, asset = selector
    key_market, key_kind, key_value = _selector(key)
    if hint and hint != key_market:
        return False
    if kind and kind != key_kind:
        return False
    return _value(asset, hint or key_market) == _value(key_value, hint or key_market)


def account_card() -> dict:
    trades = storage.list_trades()
    records = note_records()
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=29)).isoformat()
    dates = [_trade_date(trade) for trade in trades]
    noted = {trade_id for note in records if note["kind"] == "trade_note" for trade_id in note["trade_ids"]}
    missing = [str(trade["id"]) for trade in sorted(trades, key=_sort_key, reverse=True) if str(trade["id"]) not in noted]
    return {"trade_count": len(trades), "markets": sorted({_market(trade.get("market")) for trade in trades}),
            "currencies": sorted({str(trade["currency"]).upper() for trade in trades if trade.get("currency")}),
            "recent30_trade_count": sum(bool(day and start <= day <= end) for day in dates),
            "recent30_note_count": sum(bool(note["date"] and start <= note["date"] <= end) for note in records),
            "latest_trade_date": max((day for day in dates if day), default=None),
            "missing_note_trade_count": len(missing), "missing_note_trade_ids": missing[:10]}


def _cycles(trades):
    groups = {}
    for trade in trades:
        group = (str(trade.get("account") or ""), str(trade.get("currency") or ""))
        groups.setdefault(group, []).append(trade)
    cycles = []
    for group in groups.values():
        current, balance, uncertain = [], Decimal(0), False
        for trade in sorted(group, key=_sort_key):
            current.append(trade)
            side = str(trade.get("type") or "").lower()
            try:
                qty = Decimal(str(trade.get("qty")))
                valid = qty.is_finite() and qty > 0 and side in {"buy", "sell"} and bool(_trade_date(trade))
            except (InvalidOperation, ValueError):
                valid = False
            if not valid:
                uncertain = True
                continue
            if side == "sell" and qty > balance:
                uncertain = True
            balance += qty if side == "buy" else -qty
            if balance == 0 and not uncertain:
                cycles.append(current)
                current, balance = [], Decimal(0)
        if current:
            cycles.append(current)
    return sorted(cycles, key=lambda cycle: _sort_key(cycle[-1]))


def get_trade_dossier(trade_id: str | None = None, asset: str | None = None) -> dict:
    if trade_id is None and asset is None:
        raise ToolFailure("INVALID_ARGS", "Provide trade_id or asset.")
    trades = storage.list_trades()
    identities = _identities(trades)
    selector = _selector(asset) if asset is not None else None
    focus_trade = None
    if trade_id is not None:
        trade_id = _text_arg(trade_id, "trade_id")
        focus_trade = next((trade for trade in trades if str(trade["id"]) == trade_id), None)
        if focus_trade is None:
            raise ToolFailure("NOT_FOUND", f"Trade {trade_id} was not found.")
        key = identities[trade_id]
        if selector and key not in {identities[str(trade["id"])] for trade in _matching(trades, selector)}:
            raise ToolFailure("INVALID_ARGS", "trade_id and asset identify different instruments.")
        selected = [trade for trade in trades if identities[str(trade["id"])] == key]
        selector = _selector(key)
    else:
        selected = _matching(trades, selector)
        keys = {identities[str(trade["id"])] for trade in selected}
        if len(keys) > 1:
            raise ToolFailure("INVALID_ARGS", "Asset is ambiguous; specify a market-qualified asset or trade_id.")
        key = next(iter(keys)) if keys else None
    records = note_records()
    keys = {key} if key else set()
    asset_notes = [note for note in records if note["kind"] == "asset_note" and _note_matches(note, selector, keys)]
    if not selected and not asset_notes:
        raise ToolFailure("NOT_FOUND", "No local trades or asset notes match the asset.")
    cycles = _cycles(selected)
    retained = cycles[-3:]
    if focus_trade:
        focus_cycle = next(cycle for cycle in cycles if any(str(trade["id"]) == trade_id for trade in cycle))
        if not any(cycle is focus_cycle for cycle in retained):
            retained.append(focus_cycle)
    kept = sorted((trade for cycle in retained for trade in cycle), key=_sort_key)
    kept_ids = {str(trade["id"]) for trade in kept}
    days = {_trade_date(trade) for trade in kept} - {None}
    related = [note for note in records if note in asset_notes
               or note["kind"] == "trade_note" and bool(kept_ids.intersection(note["trade_ids"]))
               or note["kind"] == "daily_note" and (bool(kept_ids.intersection(note["trade_ids"]))
                                                    or note["date"] in days and not note["trade_ids"])]
    focus_asset = key or asset_notes[0]["asset_key"]
    return {"focus": {"asset": focus_asset, "trade_id": trade_id, "market": _selector(focus_asset)[0]},
            "trades": [_trade_fields(trade) for trade in kept], "notes": related,
            "trade_count": len(kept), "total_trade_count": len(selected), "truncated": len(kept) < len(selected),
            "summary": f"返回 {len(kept)}/{len(selected)} 笔成交及 {len(related)} 条完整笔记；保留最近三个记录持仓周期及指定成交所在周期。周期仅依据已记录数量，缺失或超卖时不认定平仓；daily_note 为当日日记，不代表成交动机。"}


def search_notes(query: str = '', tags: list[str] | None = None, asset: str | None = None,
                 date_from: str | None = None, date_to: str | None = None,
                 author: str = 'user', limit: int = 20) -> dict:
    if not isinstance(query, str):
        raise ToolFailure("INVALID_ARGS", "query must be a string.")
    if author not in {"user", "ai_review", "all"}:
        raise ToolFailure("INVALID_ARGS", "author must be user, ai_review or all.")
    if tags is not None and (not isinstance(tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in tags)):
        raise ToolFailure("INVALID_ARGS", "tags must be a list of nonempty strings.")
    limit = _limit(limit, 30)
    start, end = _date_range(date_from, date_to)
    selector = _selector(asset) if asset is not None else None
    trades = storage.list_trades() if selector else []
    identities = _identities(trades)
    keys = {identities[str(trade["id"])] for trade in _matching(trades, selector)} if selector else set()
    wanted = {tag.strip().casefold() for tag in tags or []}
    records = [note for note in note_records()
               if (author == "all" or note["author"] == author)
               and query.casefold() in note["text"].casefold()
               and wanted.issubset({str(tag).casefold() for tag in note["tags"]})
               and _in_range(note["date"], start, end)
               and (selector is None or _note_matches(note, selector, keys)
                    or note["kind"] == "daily_note" and any(identities.get(trade_id) in keys for trade_id in note["trade_ids"]))]
    records.sort(key=lambda note: (note["date"] or "", note["note_id"]), reverse=True)
    return {"notes": records[:limit], "matched_count": len(records), "truncated": len(records) > limit,
            "summary": f"匹配 {len(records)} 条笔记，返回 {min(len(records), limit)} 条完整原文。" if records else "没有匹配的笔记。"}
