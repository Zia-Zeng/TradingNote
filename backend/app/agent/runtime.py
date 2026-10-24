import asyncio
import inspect
import json
import logging
from time import monotonic
from typing import Any

from pydantic import ValidationError

from . import evidence
from .state import Trace
from .tools import registry
from .types import Limits, ToolFailure

logger = logging.getLogger(__name__)


class ToolRuntime:
    def __init__(self, scope: str, deadline: float, limits: Limits, book: evidence.EvidenceBook, trace: Trace):
        self.allowed = registry.allowed(scope)
        self.deadline = deadline
        self.limits = limits
        self.book = book
        self.trace = trace
        self.calls = 0
        self.inflight: dict[tuple[str, str], asyncio.Future] = {}
        self.semaphore = asyncio.Semaphore(limits.parallel)
        self.focus: dict | None = None

    def exhausted(self) -> bool:
        return self.calls >= self.limits.max_tools or monotonic() >= self.deadline

    async def call(self, call: dict) -> dict:
        function = call.get("function") or {}
        return await self._execute(str(function.get("name") or ""), function.get("arguments") or "{}", prefetch=False)

    async def prefetch(self, name: str, args: dict) -> dict:
        return await self._execute(name, args, prefetch=True)

    def _reject(self, name: str, code: str, message: str, prefetch: bool) -> dict:
        self.book.failed.add(name[:64])
        self.trace.add("prefetch" if prefetch else "tool", tool_name=name[:64], ok=False, error=code)
        return evidence.error(name[:64], code, message)

    async def _execute(self, name: str, raw: Any, prefetch: bool) -> dict:
        spec = registry.SPECS.get(name)
        if spec is None:
            return self._reject(name, "UNKNOWN_TOOL", f"Unknown tool {name[:64]}.", prefetch)
        if name not in self.allowed:
            return self._reject(name, "PRIVACY_BLOCKED", "This tool is not available for a public market or news question.", prefetch)
        spec = self.allowed[name]
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if not isinstance(parsed, dict):
                raise ValueError
        except ValueError:
            return self._reject(name, "INVALID_ARGS", "Arguments must be a JSON object.", prefetch)
        try:
            values = spec.args.model_validate(parsed).model_dump(exclude_none=True)
        except ValidationError as exc:
            problems = "; ".join(f"{'.'.join(map(str, item['loc'])) or 'arguments'}: {item['msg']}" for item in exc.errors()[:3])
            return self._reject(name, "INVALID_ARGS", problems, prefetch)
        if spec.privacy == "public_external" and not registry.is_public(values):
            return self._reject(name, "PRIVACY_BLOCKED", "External tools accept only public tickers, markets and dates.", prefetch)
        key = (name, evidence.dumps(dict(sorted(values.items()))))
        running = self.inflight.get(key)
        if running is not None:
            envelope = await asyncio.shield(running)
            self.trace.add("prefetch" if prefetch else "tool", tool_name=name, args=registry.redacted(spec, values),
                           ok=envelope["ok"], error="DUPLICATE", evidence_id=envelope.get("evidence_id"))
            if not envelope["ok"]:
                return envelope
            return {"ok": True, "tool": name, "duplicate_of": envelope["evidence_id"],
                    "summary": f"同参数调用本轮已执行，直接使用 [{envelope['evidence_id']}] 的结果。"}
        if not prefetch:
            if self.exhausted():
                return self._reject(name, "BUDGET_EXCEEDED", "Tool-call budget or run time limit reached.", prefetch)
            self.calls += 1
        task = asyncio.ensure_future(self._run(spec, values, prefetch))
        self.inflight[key] = task
        return await task

    async def _run(self, spec: registry.ToolSpec, values: dict, prefetch: bool) -> dict:
        started = monotonic()
        result = None
        async with self.semaphore:
            timeout = min(spec.timeout_s, self.deadline - monotonic())
            try:
                if timeout <= 0:
                    raise ToolFailure("BUDGET_EXCEEDED", "Run time limit reached.")
                if inspect.iscoroutinefunction(spec.handler):
                    result = await asyncio.wait_for(spec.handler(**values), timeout)
                else:
                    result = await asyncio.wait_for(asyncio.to_thread(spec.handler, **values), timeout)
                envelope = self.book.add(spec, result)
            except ToolFailure as exc:
                envelope = evidence.error(spec.name, exc.code, exc.message)
            except TimeoutError:
                envelope = evidence.error(spec.name, "TIMEOUT", f"{spec.name} timed out after {timeout:.0f}s.")
            except Exception as exc:
                logger.warning("Agent tool %s failed (%s).", spec.name, type(exc).__name__)
                code = "UPSTREAM_UNAVAILABLE" if spec.privacy == "public_external" else "INTERNAL_ERROR"
                envelope = evidence.error(spec.name, code, f"{spec.name} failed ({type(exc).__name__}).")
        if envelope["ok"] and spec.focus:
            self.focus = spec.focus(result, values) or self.focus
        elif not envelope["ok"]:
            self.book.failed.add(spec.name)
        self.trace.add("prefetch" if prefetch else "tool", tool_name=spec.name, args=registry.redacted(spec, values),
                       ok=envelope["ok"], error=envelope.get("code"), evidence_id=envelope.get("evidence_id"),
                       result_bytes=evidence.size(envelope), latency_ms=int((monotonic() - started) * 1000))
        return envelope
