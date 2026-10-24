import asyncio
import logging
from time import monotonic
from typing import Any, Awaitable, Callable
from uuid import uuid4

from fastapi import HTTPException
from openai import APIConnectionError, APIStatusError, OpenAIError

from . import context, evidence, guard, state
from .model_client import ModelClient
from .runtime import ToolRuntime
from .tools import registry
from .types import ContextTooLarge, Limits, ModelTurn

logger = logging.getLogger(__name__)
LIMITS = Limits()
MODEL = ModelClient()
PROBE_SECONDS = 20
FALLBACK_MIN_SECONDS = 15
FORCE_ANSWER_SECONDS = 12
REPAIR_MIN_SECONDS = 10
MODEL_MIN_SECONDS = 3
MODEL_TIMEOUT_SECONDS = 40


class ModelUnavailable(Exception):
    pass


def _response(conversation_id: str, reply: str, run_id: str, status: str, engine: str = "v2") -> dict:
    return {"conversation_id": conversation_id, "reply": reply, "created_at": state.now_iso(),
            "run_id": run_id, "engine": engine, "agent_status": status}


def template(payload: Any, reply: str) -> dict:
    run_id, conversation_id, replay = state.start(payload, payload.conversation_id or str(uuid4()), LIMITS.timeout_s, tier="tier1")
    if replay:
        return replay
    response = _response(conversation_id, reply, run_id, "completed")
    state.finish(run_id, response, status="completed", payload=payload, conversation_id=conversation_id, focus_data=None,
                 steps=0, tools=0, usage={}, latency_ms=0, flags=[])
    return response


def _retryable(exc: Exception) -> bool:
    if isinstance(exc, APIStatusError):
        return exc.status_code == 429 or exc.status_code >= 500
    return isinstance(exc, (APIConnectionError, TimeoutError))


async def _model(messages: list[dict], tools: list[dict], *, tool_choice: str, deadline: float,
                 trace: state.Trace, usage: dict[str, int]) -> ModelTurn:
    for _ in range(2):
        remaining = deadline - monotonic()
        if remaining < MODEL_MIN_SECONDS:
            break
        started = monotonic()
        try:
            turn = await MODEL.chat(messages, tools, tool_choice=tool_choice, timeout=min(MODEL_TIMEOUT_SECONDS, remaining - 1))
        except (OpenAIError, TimeoutError, ValueError) as exc:
            trace.add("model", ok=False, error=type(exc).__name__[:40], latency_ms=int((monotonic() - started) * 1000))
            if not _retryable(exc):
                break
            continue
        for key, value in turn.usage.items():
            usage[key] = usage.get(key, 0) + value
        ok = bool(turn.content.strip()) if tool_choice == "none" else bool(turn.tool_calls or turn.content.strip())
        trace.add("model", args={"tool_calls": [call["function"]["name"] for call in turn.tool_calls],
                                 "finish_reason": turn.finish_reason, "usage": turn.usage},
                  ok=ok, error=None if ok else "EMPTY_REPLY", latency_ms=int((monotonic() - started) * 1000))
        if ok:
            return turn
    raise ModelUnavailable()


def _evidence_reply(book: evidence.EvidenceBook) -> str:
    lines = ["模型暂时不可用，以下是本轮已取得的证据摘要（未经分析）："]
    lines += [f"{evidence.TOOL_LABELS.get(item['tool'], item['tool'])} [{ref}]：{item['summary']}" for ref, item in book.envelopes.items()]
    user_notes = [(ref, note) for ref, note in book.notes.items() if note.get("author") == "user"][:5]
    if user_notes:
        lines.append("你记录的笔记：")
        lines += [f"[{ref}] {note.get('date') or '日期未知'}：{' '.join(str(note.get('text') or '').split())[:200]}" for ref, note in user_notes]
    return "\n\n".join(lines)


async def run(payload: Any, legacy: Callable[[Any], Awaitable[Any]]) -> dict:
    started = monotonic()
    deadline = started + LIMITS.timeout_s
    run_id, conversation_id, replay = state.start(payload, payload.conversation_id or str(uuid4()), LIMITS.timeout_s)
    if replay:
        return replay
    trace = state.Trace(run_id)
    usage: dict[str, int] = {}
    steps = 0
    runtime: ToolRuntime | None = None
    finished = False

    def finish(response: dict | None, status: str, *, flags: list[str] | None = None, error: str | None = None,
               persist: bool = True, focus_data: dict | None = None) -> dict | None:
        nonlocal finished
        state.finish(run_id, response, status=status, payload=payload, conversation_id=conversation_id, focus_data=focus_data,
                     steps=steps, tools=runtime.calls if runtime else 0, usage=usage,
                     latency_ms=int((monotonic() - started) * 1000), flags=flags or [], error=error, persist_turn=persist)
        finished = True
        return response

    async def fallback(reason: str) -> dict:
        trace.add("fallback", ok=False, error=reason)
        try:
            result = await legacy(payload.model_copy(update={"conversation_id": conversation_id}))
        except HTTPException as exc:
            finish(None, "failed", error=f"{reason}; legacy HTTP {exc.status_code}")
            raise
        data = result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else dict(result)
        # Legacy already saved its own turn.
        return finish({**data, "run_id": run_id, "engine": "legacy", "agent_status": "fallback"}, "fallback",
                      flags=[reason], error=reason, persist=False)

    try:
        try:
            supported = await asyncio.wait_for(MODEL.probe(), PROBE_SECONDS)
        except Exception as exc:
            trace.add("probe", ok=False, error=type(exc).__name__[:40])
            supported = False
        if not supported:
            return await fallback("TOOL_CALLING_UNAVAILABLE")

        focus = state.focus(conversation_id)
        scope = context.scope_of(payload)
        book = evidence.EvidenceBook(payload.message)
        runtime = ToolRuntime(scope, deadline, LIMITS, book, trace)
        ctx = await context.build(payload, conversation_id, scope, focus, runtime)
        tools = registry.schemas(scope)
        reply = ""
        try:
            for index in range(LIMITS.max_steps):
                ctx.fit(tools, LIMITS.input_tokens)
                force = index == LIMITS.max_steps - 1 or runtime.exhausted() or deadline - monotonic() < FORCE_ANSWER_SECONDS
                turn = await _model(ctx.messages(), tools, tool_choice="none" if force else "auto",
                                    deadline=deadline, trace=trace, usage=usage)
                steps += 1
                if force or not turn.tool_calls:
                    reply = turn.content.strip()
                    break
                ctx.add_turn(turn)
                results = await asyncio.gather(*(runtime.call(call) for call in turn.tool_calls))
                for call, envelope in zip(turn.tool_calls, results):
                    ctx.add_result(call["id"], envelope)
        except ModelUnavailable:
            if deadline - monotonic() >= FALLBACK_MIN_SECONDS:
                return await fallback("MODEL_UNAVAILABLE")
            if not book.envelopes:
                finish(None, "failed", error="MODEL_UNAVAILABLE")
                raise HTTPException(status_code=502, detail="The Agent model is temporarily unavailable. Please retry.")
            reply = evidence.legend(_evidence_reply(book), book)
            return finish(_response(conversation_id, reply, run_id, "degraded"), "degraded", flags=["MODEL_UNAVAILABLE"],
                          error="MODEL_UNAVAILABLE", focus_data={**focus, **(runtime.focus or {})})
        except ContextTooLarge:
            return await fallback("CONTEXT_TOO_LARGE")

        status, flags = "completed", []
        problems = guard.blocking(guard.check(reply, book))
        if problems:
            flags += list(dict.fromkeys(issue.code for issue in problems))
            repaired = None
            if steps < LIMITS.max_steps and deadline - monotonic() > REPAIR_MIN_SECONDS:
                try:
                    ctx.fit(tools, LIMITS.input_tokens)
                    messages = [*ctx.messages(), {"role": "assistant", "content": reply},
                                {"role": "user", "content": guard.repair_prompt(problems)}]
                    turn = await _model(messages, tools, tool_choice="none", deadline=deadline, trace=trace, usage=usage)
                    steps += 1
                    repaired = turn.content.strip()
                except (ModelUnavailable, ContextTooLarge):
                    repaired = None
            if repaired and not guard.blocking(guard.check(repaired, book)):
                reply = repaired
                flags.append("repaired")
            else:
                reply, status = guard.fix(repaired or reply, book), "degraded"
                flags.append("fixed")
        ungrounded = guard.ungrounded_numbers(reply, book)
        if ungrounded:
            flags.append(f"ungrounded_numbers:{len(ungrounded)}")
        trace.add("guard", args={"flags": flags, "numbers": guard.number_report(reply, book)}, ok=status == "completed")
        reply = evidence.legend(reply, book)
        return finish(_response(conversation_id, reply, run_id, status), status, flags=flags,
                      focus_data={**focus, **(runtime.focus or {})})
    except BaseException as exc:
        if not finished:
            try:
                finish(None, "failed", error=type(exc).__name__[:80])
            except Exception as finish_error:
                logger.warning("Agent run %s could not be marked failed (%s).", run_id, type(finish_error).__name__)
        raise
