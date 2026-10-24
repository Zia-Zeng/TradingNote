from dataclasses import dataclass, field
from typing import Any


class ToolFailure(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class ContextTooLarge(Exception):
    pass


@dataclass
class ModelTurn:
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    reasoning: str = ""
    finish_reason: str | None = None


@dataclass(frozen=True)
class Limits:
    max_steps: int = 5
    max_tools: int = 8
    parallel: int = 3
    timeout_s: float = 60
    input_tokens: int = 24000
