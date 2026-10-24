import asyncio
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openai import APIConnectionError

from app import main, storage
from app.agent import evidence, guard, router, runner, state
from app.agent.types import Limits, ModelTurn


NOTE = "回踩20日均线企稳，按计划分批建仓。"
TRADES = [
    {"id": "t-buy", "time": "2026-07-07 10:00", "type": "Buy", "symbol": "京东方A", "code": "000725", "market": "CN",
     "asset_class": "Stock", "currency": "CNY", "price": 4.5, "qty": 1000, "amount": 4500,
     "note": NOTE, "note_tags": ["Pattern-Based Entry"]},
    {"id": "t-sell", "time": "2026-07-14 14:00", "type": "Sell", "symbol": "京东方A", "code": "000725", "market": "CN",
     "asset_class": "Stock", "currency": "CNY", "price": 4.8, "qty": 1000, "amount": 4800, "note": ""},
    {"id": "t-zijin", "time": "2026-07-10 10:00", "type": "Buy", "symbol": "紫金矿业", "code": "601899", "market": "CN",
     "asset_class": "Stock", "currency": "CNY", "price": 18.2, "qty": 100, "amount": 1820, "note": ""},
]
MOTIVE_QUESTION = "我为什么在7月7日买入京东方A？"
MARKET_QUESTION = "京东方A最近走势怎么样？"
INDEX_QUESTION = "今天A股大盘怎么样？"
NOTE_LEGEND = "[N1] 你记录的交易笔记 · 2026-07-07 · 000725"
DOSSIER_LEGEND = "[E1] 交易档案 · TradingNote 本地记录"


def ask(message, **fields):
    return main.AgentChatRequest(message=message, **fields)


def tool_call(name, arguments, call_id="call-1"):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)}}


def answer(content, *calls, reasoning="", prompt_tokens=10, completion_tokens=5):
    return ModelTurn(content=content, tool_calls=list(calls), reasoning=reasoning,
                     usage={"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens},
                     finish_reason="tool_calls" if calls else "stop")


class FakeModel:
    """Scripted stand-in for ModelClient: each chat() consumes the next turn or raises it."""

    def __init__(self, *turns, supported=True):
        self.turns = list(turns)
        self.supported = supported
        self.calls = []

    async def probe(self):
        if isinstance(self.supported, Exception):
            raise self.supported
        return self.supported

    async def chat(self, messages, tools=None, *, tool_choice="auto", max_tokens=3000, timeout=None):
        self.calls.append({"messages": copy.deepcopy(messages), "tool_choice": tool_choice,
                           "tools": [tool["function"]["name"] for tool in tools or []]})
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn

    async def close(self):
        pass


def runs():
    with storage.database() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM agent_runs ORDER BY rowid")]


class AgentDatabaseTestCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(dir=storage.DATABASE_PATH.parent)
        self.addCleanup(directory.cleanup)
        database = patch.object(storage, "DATABASE_PATH", Path(directory.name) / "agent.sqlite3")
        database.start()
        self.addCleanup(database.stop)
        storage.initialize_storage()
        state.initialize()
        for trade in TRADES:
            storage.create_trade(dict(trade))

        async def legacy(payload):
            return main.AgentChatResponse(conversation_id=payload.conversation_id or "legacy-conv", reply="legacy reply",
                                          created_at="2026-10-24T00:00:00+00:00")

        self.legacy = AsyncMock(side_effect=legacy)


class RunnerTests(AgentDatabaseTestCase):
    def run_agent(self, model, payload, **settings):
        with patch.multiple(runner, MODEL=model, **settings):
            return asyncio.run(runner.run(payload, self.legacy))

    def ask_motive(self):
        model = FakeModel(
            answer("", tool_call("search_notes", {"query": "建仓"}, "c1"), reasoning="先查笔记", prompt_tokens=100, completion_tokens=10),
            answer(f"你记录的交易理由是“{NOTE}”[N1] 当天以4.5元买入1000股[E1]。", prompt_tokens=120, completion_tokens=30))
        return model, self.run_agent(model, ask(MOTIVE_QUESTION, conversation_id="conv"))

    def test_motive_question_starts_from_the_note_and_cites_it(self):
        model, response = self.ask_motive()
        content = f"你记录的交易理由是“{NOTE}”[N1] 当天以4.5元买入1000股[E1]。"
        self.assertEqual(response["reply"], content + evidence.LEGEND_MARKER + "\n" + NOTE_LEGEND + "\n\n" + DOSSIER_LEGEND)
        self.assertEqual((response["conversation_id"], response["engine"], response["agent_status"]), ("conv", "v2", "completed"))

        first, second = model.calls
        self.assertEqual((first["tool_choice"], len(first["tools"])), ("auto", 11))
        self.assertIn("## 预取证据（本轮可引用）", first["messages"][0]["content"])
        self.assertIn(NOTE, first["messages"][0]["content"])
        self.assertIn("事后收益机会与策略执行分开评价", first["messages"][0]["content"])
        self.assertIn("引号内必须逐字保留原文", first["messages"][0]["content"])
        self.assertEqual(first["messages"][1:], [{"role": "user", "content": MOTIVE_QUESTION}])
        assistant, tool = second["messages"][-2:]
        self.assertEqual((assistant["role"], assistant["reasoning_content"]), ("assistant", "先查笔记"))
        self.assertEqual((tool["tool_call_id"], json.loads(tool["content"])["evidence_id"]), ("c1", "E2"))

        run = state.get_run(response["run_id"])
        self.assertEqual((run["status"], run["steps"], run["tool_calls"], run["prompt_tokens"], run["completion_tokens"], run["guard_flags"]),
                         ("completed", 2, 1, 220, 40, []))
        self.assertEqual([step["kind"] for step in run["trace"]], ["prefetch", "model", "tool", "model", "guard"])
        self.assertEqual(run["trace"][2]["args_redacted"]["query"], {"redacted": True, "length": 2})
        self.assertEqual(state.focus("conv"), {"asset": "CN:code:000725", "symbol": "京东方A", "trade_id": None})
        self.assertEqual([message["content"] for message in storage.get_conversation("conv")["messages"]], [MOTIVE_QUESTION, response["reply"]])
        self.legacy.assert_not_awaited()

    def test_follow_up_uses_focus_and_history_without_old_citations(self):
        self.ask_motive()
        model = FakeModel(answer("是的，你在7月14日以4.8元卖出了1000股[E1]。"))
        response = self.run_agent(model, ask("那后来卖出了吗？", conversation_id="conv"))

        messages = model.calls[0]["messages"]
        self.assertEqual([message["role"] for message in messages], ["system", "user", "assistant", "user"])
        self.assertEqual(messages[2]["content"], f"你记录的交易理由是“{NOTE}” 当天以4.5元买入1000股。")
        self.assertIn("上一轮焦点标的：CN:code:000725（京东方A）", messages[0]["content"])
        self.assertIn("## 预取证据（本轮可引用）", messages[0]["content"])
        self.assertEqual(messages[3]["content"], "那后来卖出了吗？")
        self.assertTrue(response["reply"].endswith(DOSSIER_LEGEND))
        self.assertEqual(len(storage.get_conversation("conv")["messages"]), 4)

    def test_last_step_tool_budget_and_low_time_force_a_text_answer(self):
        lookup = answer("", tool_call("resolve_instrument", {"query": "京东方A"}, "c1"))
        final = answer("京东方A的代码是000725。", tool_call("resolve_instrument", {"query": "紫金矿业"}, "c2"))
        for settings, turns, choices in (
            ({"LIMITS": Limits(max_steps=2)}, [lookup, final], ["auto", "none"]),
            ({"LIMITS": Limits(max_tools=1)}, [lookup, final], ["auto", "none"]),
            ({"FORCE_ANSWER_SECONDS": 1000}, [final], ["none"]),
        ):
            with self.subTest(settings=settings):
                model = FakeModel(*turns)
                response = self.run_agent(model, ask("京东方A和紫金矿业分别是什么代码？"), **settings)
                self.assertEqual([call["tool_choice"] for call in model.calls], choices)
                self.assertEqual((response["agent_status"], response["reply"]), ("completed", "京东方A的代码是000725。"))
                self.assertEqual(state.get_run(response["run_id"])["tool_calls"], len(choices) - 1)

    def test_public_question_offers_and_runs_only_public_tools(self):
        model = FakeModel(answer("", tool_call("get_trade_dossier", {"trade_id": "t-buy"}, "c1")), answer("本轮只查看了公开行情工具。"))
        response = self.run_agent(model, ask(INDEX_QUESTION))

        first, second = model.calls
        self.assertEqual(set(first["tools"]), {"resolve_instrument", "get_price_history", "get_index_snapshot", "search_news"})
        self.assertNotIn("## 账户卡片", first["messages"][0]["content"])
        self.assertNotIn("## 预取证据", first["messages"][0]["content"])
        self.assertEqual(json.loads(second["messages"][-1]["content"])["code"], "PRIVACY_BLOCKED")
        run = state.get_run(response["run_id"])
        self.assertEqual((run["status"], run["tool_calls"]), ("completed", 0))
        self.assertIn("PRIVACY_BLOCKED", [step["error_code"] for step in run["trace"]])

    def test_missing_tool_calling_falls_back_to_legacy_without_saving_twice(self):
        for supported, kinds in ((False, ["fallback"]), (RuntimeError("probe failed"), ["probe", "fallback"])):
            with self.subTest(supported=supported):
                model = FakeModel(supported=supported)
                response = self.run_agent(model, ask(MOTIVE_QUESTION))
                forwarded = self.legacy.await_args.args[0]
                self.assertEqual((response["reply"], response["engine"], response["agent_status"]), ("legacy reply", "legacy", "fallback"))
                self.assertIsNotNone(forwarded.conversation_id)
                self.assertEqual(response["conversation_id"], forwarded.conversation_id)
                run = state.get_run(response["run_id"])
                self.assertEqual((run["status"], run["guard_flags"], run["error"]),
                                 ("fallback", ["TOOL_CALLING_UNAVAILABLE"], "TOOL_CALLING_UNAVAILABLE"))
                self.assertEqual([step["kind"] for step in run["trace"]], kinds)
                self.assertIsNone(storage.get_conversation(forwarded.conversation_id))
                self.assertEqual(model.calls, [])

    def test_transient_model_errors_are_retried_once(self):
        offline = APIConnectionError(request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"))
        for failure, code in ((offline, "APIConnectionError"), (answer("   "), "EMPTY_REPLY")):
            with self.subTest(code=code):
                model = FakeModel(failure, answer("大盘需要结合指数日线判断。"))
                response = self.run_agent(model, ask(INDEX_QUESTION))
                run = state.get_run(response["run_id"])
                self.assertEqual((response["agent_status"], run["steps"]), ("completed", 1))
                self.assertEqual([(step["ok"], step["error_code"]) for step in run["trace"] if step["kind"] == "model"],
                                 [(0, code), (1, None)])

    def test_non_retryable_model_errors_fall_back_to_legacy(self):
        model = FakeModel(ValueError("DeepSeek API key is missing."))
        response = self.run_agent(model, ask(INDEX_QUESTION, conversation_id="conv"))
        self.assertEqual((response["engine"], response["agent_status"], response["conversation_id"]), ("legacy", "fallback", "conv"))
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(state.get_run(response["run_id"])["guard_flags"], ["MODEL_UNAVAILABLE"])

    def test_late_model_failure_returns_gathered_evidence_or_a_clear_error(self):
        response = self.run_agent(FakeModel(ValueError("down")), ask("帮我看看这笔交易", trade_id="t-buy", conversation_id="conv"),
                                  FALLBACK_MIN_SECONDS=1000)
        self.assertEqual((response["engine"], response["agent_status"]), ("v2", "degraded"))
        self.assertTrue(response["reply"].startswith("模型暂时不可用"))
        self.assertIn(NOTE, response["reply"])
        self.assertTrue(response["reply"].endswith(DOSSIER_LEGEND + "\n\n" + NOTE_LEGEND))
        run = state.get_run(response["run_id"])
        self.assertEqual((run["status"], run["guard_flags"], run["error"]), ("degraded", ["MODEL_UNAVAILABLE"], "MODEL_UNAVAILABLE"))
        self.assertEqual(state.focus("conv"), {"asset": "CN:code:000725", "symbol": "京东方A", "trade_id": "t-buy"})
        self.legacy.assert_not_awaited()

        with self.assertRaises(HTTPException) as failed:
            self.run_agent(FakeModel(ValueError("down")), ask(INDEX_QUESTION), FALLBACK_MIN_SECONDS=1000)
        self.assertEqual(failed.exception.status_code, 502)
        self.assertEqual((runs()[-1]["status"], runs()[-1]["error"]), ("failed", "MODEL_UNAVAILABLE"))

    def test_context_overflow_and_legacy_errors_are_recorded(self):
        model = FakeModel()
        response = self.run_agent(model, ask(MOTIVE_QUESTION), LIMITS=Limits(input_tokens=10))
        self.assertEqual((response["agent_status"], model.calls), ("fallback", []))
        self.assertEqual(state.get_run(response["run_id"])["guard_flags"], ["CONTEXT_TOO_LARGE"])

        self.legacy.side_effect = HTTPException(status_code=503, detail="DeepSeek API key is missing.")
        with self.assertRaises(HTTPException) as unavailable:
            self.run_agent(FakeModel(supported=False), ask(MOTIVE_QUESTION))
        self.assertEqual(unavailable.exception.status_code, 503)
        self.assertEqual((runs()[-1]["status"], runs()[-1]["error"]), ("failed", "TOOL_CALLING_UNAVAILABLE; legacy HTTP 503"))

    def test_unexpected_errors_fail_the_run_and_free_the_conversation(self):
        with self.assertRaisesRegex(RuntimeError, "bug"):
            self.run_agent(FakeModel(RuntimeError("bug")), ask(INDEX_QUESTION, conversation_id="conv"))
        response = self.run_agent(FakeModel(answer("大盘需要结合指数日线判断。")), ask(INDEX_QUESTION, conversation_id="conv"))
        self.assertEqual(response["agent_status"], "completed")
        self.assertEqual([(run["status"], run["error"]) for run in runs()], [("failed", "RuntimeError"), ("completed", None)])

    def test_blocked_reply_is_repaired_once(self):
        draft = "你当时看好京东方A的反弹。建议你立即加仓。"
        repaired = f"你记录的交易理由是“{NOTE}”[N1]。"
        model = FakeModel(answer(draft), answer(repaired))
        response = self.run_agent(model, ask(MOTIVE_QUESTION, conversation_id="conv"))

        self.assertEqual(response["reply"], repaired + evidence.LEGEND_MARKER + "\n" + NOTE_LEGEND)
        self.assertEqual(model.calls[1]["tool_choice"], "none")
        previous, request = model.calls[1]["messages"][-2:]
        self.assertEqual(previous, {"role": "assistant", "content": draft})
        self.assertTrue(request["content"].startswith("请修改你上一条回答中的以下问题："))
        run = state.get_run(response["run_id"])
        self.assertEqual((run["status"], run["steps"], run["guard_flags"]), ("completed", 2, ["uncited_motive", "compliance", "repaired"]))

    def test_unrepairable_reply_is_fixed_deterministically(self):
        blocked = "京东方A的实时走势偏强。建议你立即买入。"
        response = self.run_agent(FakeModel(answer(blocked), answer(blocked)), ask(MARKET_QUESTION))
        self.assertEqual(response["reply"], "京东方A的最近日线走势偏强。" + guard.COMPLIANCE_NOTE)
        run = state.get_run(response["run_id"])
        self.assertEqual((run["status"], run["guard_flags"]), ("degraded", ["realtime_claim", "compliance", "fixed"]))

        model = FakeModel(answer("京东方A的走势偏强。建议你立即买入。"))
        response = self.run_agent(model, ask(MARKET_QUESTION), REPAIR_MIN_SECONDS=1000)
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(response["reply"], "京东方A的走势偏强。" + guard.COMPLIANCE_NOTE)
        self.assertEqual(state.get_run(response["run_id"])["guard_flags"], ["compliance", "fixed"])

    def test_numeric_repair_is_recorded_and_final_numbers_have_cited_sources(self):
        model = FakeModel(answer("你以7元买入1000股[E1]。"), answer("你以4.5元买入1000股[E1]。"))
        response = self.run_agent(model, ask(MOTIVE_QUESTION))
        run = state.get_run(response["run_id"])
        self.assertEqual(run["guard_flags"], ["ungrounded_numbers", "repaired"])
        report = run["trace"][-1]["args_redacted"]["numbers"]
        self.assertEqual((report["total"], report["grounded"], report["cited"]), (2, 2, 2))
        self.assertEqual(run["steps"], 2)

    def test_repair_does_not_exceed_the_model_step_budget(self):
        model = FakeModel(answer("你以7元买入1000股[E1]。"))
        response = self.run_agent(model, ask(MOTIVE_QUESTION), LIMITS=Limits(max_steps=1))
        self.assertEqual(response["agent_status"], "degraded")
        self.assertIn(guard.NUMBERS_NOTE, response["reply"])
        self.assertNotIn("7元", response["reply"])
        run = state.get_run(response["run_id"])
        self.assertEqual((run["steps"], run["guard_flags"]), (1, ["ungrounded_numbers", "fixed"]))

    def test_same_client_message_id_replays_the_saved_answer(self):
        payload = ask(INDEX_QUESTION, conversation_id="conv", client_msg_id="m-1")
        first = self.run_agent(FakeModel(answer("大盘需要结合指数日线判断。")), payload)
        replayed = FakeModel()
        self.assertEqual(self.run_agent(replayed, payload), first)
        self.assertEqual(replayed.calls, [])
        self.assertEqual(len(storage.get_conversation("conv")["messages"]), 2)
        self.assertEqual(len(runs()), 1)


class RouterTests(AgentDatabaseTestCase):
    def dispatch(self, payload, engine="v2"):
        with patch.dict(os.environ, {"AGENT_ENGINE": engine}):
            return asyncio.run(router.dispatch_chat(payload, self.legacy))

    def test_engine_switch_defaults_to_legacy(self):
        for value, expected in (("v2", "v2"), (" V2 ", "v2"), ("legacy", "legacy"), ("", "legacy"), ("v3", "legacy")):
            with patch.dict(os.environ, {"AGENT_ENGINE": value}):
                self.assertEqual(router.engine(), expected, value)
        with patch.dict(os.environ):
            os.environ.pop("AGENT_ENGINE", None)
            self.assertEqual(router.engine(), "legacy")

    def test_scenario_flows_stay_on_legacy_and_simple_turns_use_templates(self):
        agent = AsyncMock(return_value={"reply": "agent"})
        with patch.object(runner, "run", agent):
            for payload in (ask("复盘这笔交易", action="review", trade_id="t-buy"), ask("这一天怎么样？", reference="daily-2026-10-23")):
                self.assertEqual(self.dispatch(payload).reply, "legacy reply")
            self.assertEqual(self.dispatch(ask("你好！"))["reply"], router.GREETING_REPLY)
            for message in ("推荐一只股票", "推荐一只明天能涨的股票", "明天应该买什么股票？"):
                self.assertEqual(self.dispatch(ask(message))["reply"], router.COMPLIANCE_REPLY)
            self.assertEqual((self.legacy.await_count, agent.await_count), (2, 0))

            for payload in (ask(MOTIVE_QUESTION), ask("推荐的股票为什么跌了？"),
                            ask("这一天怎么样？", reference="daily-2026-10-23-note")):
                self.assertEqual(self.dispatch(payload), {"reply": "agent"})
            self.assertEqual(agent.await_count, 3)
            self.assertEqual(self.dispatch(ask("你好！"), engine="legacy").reply, "legacy reply")
        self.assertEqual(self.legacy.await_count, 3)
        self.assertEqual([run["tier"] for run in runs()], ["tier1"] * 4)

    def test_chat_api_keeps_the_legacy_shape_and_exposes_agent_runs(self):
        client = TestClient(main.app)
        with patch.object(main, "_legacy_chat", self.legacy), patch.object(runner, "MODEL", FakeModel()):
            with patch.dict(os.environ, {"AGENT_ENGINE": "legacy"}):
                legacy = client.post("/api/agent/chat", json={"message": "你好！", "conversation_id": "c-legacy"})
            self.assertEqual(legacy.json(), {"conversation_id": "c-legacy", "reply": "legacy reply", "created_at": "2026-10-24T00:00:00+00:00"})

            with patch.dict(os.environ, {"AGENT_ENGINE": "v2"}):
                body = {"message": "你好！", "client_msg_id": "m-1"}
                greeting = client.post("/api/agent/chat", json=body).json()
                self.assertEqual(client.post("/api/agent/chat", json=body).json(), greeting)
                self.assertEqual(client.post("/api/agent/chat", json={"message": "你好！", "client_msg_id": ""}).status_code, 422)
                engine = client.get("/api/agent/engine").json()
        self.assertEqual((greeting["reply"], greeting["engine"], greeting["agent_status"]), (router.GREETING_REPLY, "v2", "completed"))
        self.assertEqual(self.legacy.await_count, 1)
        self.assertEqual((engine["engine"], engine["tool_calling"], engine["limits"]["max_steps"]), ("v2", True, 5))

        run = client.get(f"/api/agent/runs/{greeting['run_id']}").json()
        self.assertEqual((run["status"], run["tier"], run["steps"], run["trace"]), ("completed", "tier1", 0, []))
        missing = client.get("/api/agent/runs/missing")
        self.assertEqual((missing.status_code, missing.json()["detail"]), (404, "Agent run not found."))


if __name__ == "__main__":
    unittest.main()
