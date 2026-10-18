"""Daily literary market essays generated from one recent financial headline."""

from __future__ import annotations

import json
import logging
import os
from random import sample
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError

from .news_data import fetch_feed_news
from .storage import get_daily_feed, save_daily_feed


logger = logging.getLogger(__name__)

BOOKS = [
    "Thinking, Fast and Slow",
    "Fooled by Randomness",
    "Principles",
    "The Long View",
    "The Lean Startup",
    "The Almanack of Naval Ravikant",
    "Competing Against Luck",
    "Hit Refresh",
    "Mastering the Market Cycle",
    "The Little Book of Index Investing",
    "Antifragile",
    "Trading for a Living",
    "Poor Economics",
    "The Most Important Thing",
    "The Signal and the Noise",
    "The Simplest Way to Invest",
    "Rework",
    "Making Time Your Friend",
    "A Higher View",
    "The Hard Thing About Hard Things",
]
COVER_DIR = Path(__file__).resolve().parents[1] / "cover"
COVER_FILES = [path.name for path in COVER_DIR.iterdir() if path.is_file()]


class FeedArticle(BaseModel):
    book: str
    title: str
    tags: list[str] = Field(min_length=1, max_length=3)
    summary: str = Field(min_length=30, max_length=250)
    body: str = Field(min_length=200)
    cover: str | None = None


class DailyFeed(BaseModel):
    date: str
    news: dict[str, str]
    articles: list[FeedArticle] = Field(min_length=5, max_length=5)


class FeedPrompt(BaseModel):
    prompt: str
    source: str


FEED_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "feed_system.txt"


def get_feed_prompt() -> str:
    """Read the prompt on demand so edits take effect without restarting the API."""
    return FEED_PROMPT_PATH.read_text(encoding="utf-8").strip()


def _validate_feed(payload: Any, feed_date: str, news: dict[str, str]) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("articles"), list):
        raise ValueError("Feed response must contain an articles array.")
    payload["date"] = feed_date
    payload["news"] = news
    result = DailyFeed.model_validate(payload)
    used_books: set[str] = set()
    for article in result.articles:
        if article.book not in BOOKS or article.book in used_books:
            raise ValueError("Feed articles must use five different books from the configured list.")
        if not article.title.startswith(article.book):
            raise ValueError("Each Feed title must begin with its book title.")
        word_count = len(article.body.split())
        if not 250 <= word_count <= 350:
            raise ValueError("Each Feed article must be approximately 300 English words.")
        summary_words = len(article.summary.split())
        if not 20 <= summary_words <= 30:
            raise ValueError("Each Feed summary must contain 20–30 English words.")
        used_books.add(article.book)
    return result.model_dump()


async def generate_daily_feed(feed_day: date) -> dict[str, Any]:
    """Search for today's market conversation, write five essays, and cache them."""
    day_key = feed_day.isoformat()
    cached = get_daily_feed(day_key)
    if cached:
        try:
            DailyFeed.model_validate(cached)
            if all(article.get("cover") for article in cached.get("articles", [])):
                return cached
        except ValidationError:
            pass
        logger.info("Regenerating cached Feed edition with the current article fields or covers.")

    news_items = await fetch_feed_news(feed_day - timedelta(days=1), feed_day)
    if not news_items:
        raise RuntimeError("No recent financial-market headlines are available to create today's Feed.")
    hotspot = news_items[0]

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key == "replace_with_your_deepseek_api_key":
        raise RuntimeError("DeepSeek API key is missing. Set DEEPSEEK_API_KEY in backend/.env.")

    client = AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com",
        timeout=90.0,
        max_retries=1,
    )
    system_prompt = get_feed_prompt()
    user_payload = {
        "books": BOOKS,
        "market_hotspot": hotspot,
        "other_recent_headlines_for_context": news_items[1:4],
        "feed_date": day_key,
    }
    try:
        completion = await client.chat.completions.create(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
            stream=False,
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("DeepSeek returned an empty Feed response.")
        validated = _validate_feed(json.loads(content), day_key, hotspot)
    except (OpenAIError, json.JSONDecodeError, ValidationError, ValueError) as exc:
        logger.warning("Daily Feed generation failed (%s).", type(exc).__name__)
        raise RuntimeError("Unable to generate valid Feed articles. Please retry later.") from exc
    finally:
        await client.close()

    for article, cover in zip(validated["articles"], sample(COVER_FILES, k=5)):
        article["cover"] = cover
    validated["generated_at"] = datetime.now(timezone.utc).isoformat()
    return save_daily_feed(day_key, validated)
