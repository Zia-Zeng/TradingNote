import asyncio
import os
from typing import Any

from openai import AsyncOpenAI

from .types import ModelTurn

PROBE_TOOL = {"type": "function", "function": {
    "name": "capability_probe", "description": "Confirm function calling is supported.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}}


class ModelClient:
    def __init__(self):
        self.client: AsyncOpenAI | None = None
        self.supported: bool | None = None
        self.probe_lock = asyncio.Lock()

    def _client(self) -> AsyncOpenAI:
        key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not key or key == "replace_with_your_deepseek_api_key":
            raise ValueError("DeepSeek API key is missing.")
        if self.client is None:
            self.client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com", timeout=40, max_retries=0)
        return self.client

    async def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None, *,
                   tool_choice: str = "auto", max_tokens: int = 3000, timeout: float | None = None) -> ModelTurn:
        options: dict[str, Any] = {
            "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            options["tools"] = tools
            options["tool_choice"] = tool_choice
        if timeout is not None:
            options["timeout"] = max(1.0, timeout)
        completion = await self._client().chat.completions.create(**options)
        choice = completion.choices[0]
        message = choice.message
        usage = completion.usage
        return ModelTurn(
            content=message.content or "",
            tool_calls=[{"id": call.id, "type": "function", "function": {"name": call.function.name, "arguments": call.function.arguments or "{}"}}
                        for call in (message.tool_calls or [])],
            usage={name: int(getattr(usage, name, 0) or 0) for name in ("prompt_tokens", "completion_tokens", "prompt_cache_hit_tokens")},
            reasoning=getattr(message, "reasoning_content", None) or "",
            finish_reason=choice.finish_reason,
        )

    async def probe(self) -> bool:
        async with self.probe_lock:
            if self.supported is None:
                result = await self.chat(
                    [{"role": "user", "content": "Call the capability_probe tool now. Do not answer in text."}],
                    [PROBE_TOOL], max_tokens=600, timeout=20,
                )
                self.supported = any(call["function"]["name"] == "capability_probe" for call in result.tool_calls)
            return self.supported

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()
            self.client = None
        self.supported = None
