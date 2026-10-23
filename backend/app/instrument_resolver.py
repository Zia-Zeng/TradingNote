"""Resolve instrument names to market tickers so records never lack a code.

OCR and CSV imports sometimes capture only the localized security name (for
example 紫金黄金国际) without its ticker. Price history requires a code, so
every write path resolves names once through the public search providers and
persists the mapping in the ``instrument_aliases`` table for future lookups.
"""

from __future__ import annotations

import logging
from typing import Any

from .storage import get_instrument_alias, save_instrument_alias
from .stocks import _akshare_list, _eastmoney_search, _yahoo_search

logger = logging.getLogger(__name__)


def _search_providers(query: str) -> list[tuple[str, list[dict[str, str]]]]:
    """Query the public providers in the same order as the manual search box."""
    results: list[tuple[str, list[dict[str, str]]]] = []
    try:
        items = _eastmoney_search(query)
        if items:
            results.append(("Eastmoney", items))
    except Exception:
        pass
    if any("\u3400" <= char <= "\u9fff" for char in query):
        try:
            items = [item for item in _akshare_list() if query.casefold() in item["name"].casefold() or query.casefold() in item["code"].casefold()]
            if items:
                results.append(("AkShare", items))
        except Exception:
            pass
    if not any("\u3400" <= char <= "\u9fff" for char in query):
        try:
            items = _yahoo_search(query)
            if items:
                results.append(("Yahoo Finance", items))
        except Exception:
            pass
    return results


def _exact_matches(query: str, items: list[dict[str, str]]) -> list[dict[str, str]]:
    lowered = query.strip().casefold()
    return [item for item in items if str(item.get("name", "")).strip().casefold() == lowered
            or str(item.get("code", "")).strip().casefold() == lowered]


def resolve_instrument(symbol: str, market_hint: str = "", currency_hint: str = "") -> dict[str, Any] | None:
    """Return the persisted or freshly searched identity for a security name.

    Only exact name (or code) matches are accepted so an ambiguous or fuzzy
    result can never silently rewrite the ledger. Returns ``None`` when no
    provider confidently identifies the symbol.
    """
    query = str(symbol or "").strip()
    if not query:
        return None
    cached = get_instrument_alias(query)
    if cached is not None:
        return {**cached, "cached": True}

    for source, items in _search_providers(query):
        matches = _exact_matches(query, items)
        if not matches:
            continue
        hint_market = str(market_hint or "").strip().upper()
        hint_currency = str(currency_hint or "").strip().upper()
        preferred = sorted(
            matches,
            key=lambda item: (
                0 if str(item.get("market", "")).upper() == hint_market else 1,
                0 if str(item.get("currency", "")).upper() == hint_currency else 1,
            ),
        )
        best = preferred[0]
        resolved = {
            "symbol": query,
            "code": str(best.get("code", "")).strip(),
            "name": str(best.get("name", "")).strip(),
            "market": str(best.get("market", "")).strip().upper(),
            "currency": str(best.get("currency", "")).strip().upper(),
            "asset_class": str(best.get("asset_class", "Stock")).strip(),
            "source": source,
        }
        if not resolved["code"]:
            continue
        saved = save_instrument_alias(resolved)
        return {**saved, "cached": False}
    logger.info("Instrument resolver found no exact match for %r; leaving the record as-is.", query)
    return None


def apply_resolved_instrument(record: dict[str, Any]) -> dict[str, Any]:
    """Fill a trade or holdings row with its resolved ticker when the code is missing.

    The record is returned unchanged when a code is already present or the
    name cannot be resolved with confidence. Market and currency follow the
    resolved identity because the search match is exact-name.
    """
    if str(record.get("code") or "").strip():
        return record
    symbol = str(record.get("symbol") or "").strip()
    if not symbol:
        return record
    resolved = resolve_instrument(symbol, str(record.get("market") or ""), str(record.get("currency") or ""))
    if resolved is None:
        return record
    record["code"] = resolved["code"]
    if resolved.get("market"):
        record["market"] = resolved["market"]
    if resolved.get("currency"):
        record["currency"] = resolved["currency"]
    if resolved.get("asset_class"):
        record["asset_class"] = resolved["asset_class"]
    return record
