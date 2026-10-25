import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from time import monotonic
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app import storage
from app.agent import context, evidence, state
from app.agent.runtime import ToolRuntime
from app.agent.tools import portfolio, registry
from app.agent.types import ContextTooLarge, Limits, ModelTurn
from app.main import AgentChatRequest


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


def ask(message, **fields):
    return AgentChatRequest(message=message, **fields)


def tool_call(name, arguments, call_id="call-1"):
    if not isinstance(arguments, str):
        arguments = json.dumps(arguments, ensure_ascii=False)
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}


def make_runtime(scope="private", limits=Limits(), run_id="run-test"):
    book = evidence.EvidenceBook()
    return ToolRuntime(scope, monotonic() + limits.timeout_s, limits, book, state.Trace(run_id)), book


def with_handler(name, handler, **changes):
    return patch.dict(registry.SPECS, {name: replace(registry.SPECS[name], handler=handler, **changes)})


def trace_rows():
    with storage.database() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM agent_steps WHERE run_id='run-test' ORDER BY idx")]


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


class ToolRuntimeTests(AgentDatabaseTestCase):
    def test_bad_calls_return_error_envelopes_without_using_budget(self):
        async def scenario():
            runtime, book = make_runtime()
            results = [await runtime.call(tool_call(name, arguments)) for name, arguments in (
                ("get_trade", {"trade_id": "t-buy"}),
                ("get_trade_dossier", "not json"),
                ("get_trade_dossier", {}),
                ("get_trade_dossier", {"trade_id": "t-buy", "extra": 1}),
                ("get_price_history", {"market": "CN", "code": "京东方A"}),
            )]
            return runtime, book, results

        runtime, book, results = asyncio.run(scenario())
        expected = ["UNKNOWN_TOOL", "INVALID_ARGS", "INVALID_ARGS", "INVALID_ARGS", "INVALID_ARGS"]
        self.assertEqual([result["code"] for result in results], expected)
        self.assertTrue(all(not result["ok"] and result["hint"] for result in results))
        self.assertEqual((runtime.calls, book.envelopes), (0, {}))
        self.assertEqual(book.failed, {"get_trade", "get_trade_dossier", "get_price_history"})
        self.assertEqual([row["error_code"] for row in trace_rows()], expected)

    def test_public_scope_offers_and_runs_only_public_tools(self):
        public = {schema["function"]["name"] for schema in registry.schemas("public")}
        self.assertEqual(public, {"resolve_instrument", "get_price_history", "get_index_snapshot", "search_news"})
        self.assertEqual(len(registry.schemas("private")), 11)

        async def scenario():
            runtime, _ = make_runtime("public")
            return [await runtime.call(tool_call(name, arguments)) for name, arguments in (
                ("get_trade_dossier", {"trade_id": "t-buy"}), ("search_notes", {"query": "止损"}), ("get_portfolio", {}),
                ("get_daily_context", {"date": "2026-07-07"}))]

        with patch.object(portfolio.today, "get_agent_daily_context") as daily, patch.object(portfolio.notes, "note_records") as records:
            self.assertEqual([result["code"] for result in asyncio.run(scenario())], ["PRIVACY_BLOCKED"] * 4)
        daily.assert_not_called()
        records.assert_not_called()

    def test_public_daily_close_question_does_not_enter_private_scope(self):
        self.assertEqual(context.scope_of(ask("600999最近日线收盘价是多少？没有数据就说明。")), "public")
        self.assertEqual(context.scope_of(ask("我的成交价与日线收盘价差多少？")), "private")

    def test_public_resolver_cannot_read_private_trades(self):
        async def scenario():
            runtime, _ = make_runtime("public")
            return await runtime.call(tool_call("resolve_instrument", {"query": "000725", "market": "CN"}))

        with patch.object(storage, "list_trades", side_effect=AssertionError("Private ledger read")) as read:
            result = asyncio.run(scenario())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["source"], "code_format")
        read.assert_not_called()
        self.assertIn("不读取账户", registry.allowed("public")["resolve_instrument"].description)

    def test_external_tools_receive_only_public_values(self):
        self.assertTrue(registry.is_public({"market": "CN", "code": "000725", "date_from": "2026-10-01", "date_to": None}))
        self.assertFalse(registry.is_public({"market": "CN", "code": "我卖出是因为止损"}))
        self.assertFalse(registry.is_public({"market": "CN", "limit": 5}))

        class LooseArgs(registry.Args):
            market: str
            code: str | None = None

        handler = Mock(return_value={"articles": [], "summary": ""})
        with with_handler("search_news", handler, args=LooseArgs):
            async def scenario():
                runtime, _ = make_runtime("public")
                return await runtime.call(tool_call("search_news", {"market": "CN", "code": "我卖出是因为止损"}))

            result = asyncio.run(scenario())
        self.assertEqual(result["code"], "PRIVACY_BLOCKED")
        handler.assert_not_called()

    def test_identical_calls_run_once_and_count_once(self):
        received = []

        async def history(**values):
            received.append(values)
            await asyncio.sleep(0.01)
            return {"code": values["code"], "source": "Fake", "as_of": "2026-10-23", "stats": {"last_close": 4.93}, "summary": "ok"}

        with with_handler("get_price_history", history):
            async def scenario():
                runtime, _ = make_runtime()
                first, second = await asyncio.gather(
                    runtime.call(tool_call("get_price_history", {"market": "CN", "code": "000725"}, "a")),
                    runtime.call(tool_call("get_price_history", {"code": "000725", "market": "CN"}, "b")))
                third = await runtime.call(tool_call("get_price_history", {"market": "CN", "code": "000725"}, "c"))
                return runtime, first, second, third

            runtime, first, second, third = asyncio.run(scenario())
        self.assertEqual(received, [{"market": "CN", "code": "000725"}])
        self.assertEqual((first["evidence_id"], second["duplicate_of"], third["duplicate_of"]), ("E1", "E1", "E1"))
        self.assertEqual(runtime.calls, 1)
        self.assertEqual([row["error_code"] for row in trace_rows()], [None, "DUPLICATE", "DUPLICATE"])

    def test_budget_exhaustion_rejects_new_calls(self):
        async def scenario():
            runtime, _ = make_runtime(limits=Limits(max_tools=2))
            results = [await runtime.call(tool_call("resolve_instrument", {"query": query}))
                       for query in ("京东方A", "紫金矿业", "000725")]
            return runtime, results

        runtime, results = asyncio.run(scenario())
        self.assertEqual([result["ok"] for result in results], [True, True, False])
        self.assertEqual(results[2]["code"], "BUDGET_EXCEEDED")
        self.assertTrue(runtime.exhausted())

    def test_slow_or_failing_tools_become_error_envelopes(self):
        async def slow(**values):
            await asyncio.sleep(1)

        def broken(**values):
            raise RuntimeError("provider down")

        with with_handler("get_price_history", slow, timeout_s=0.05), with_handler("search_news", broken), \
                with_handler("search_trades", broken), self.assertLogs("app.agent.runtime", "WARNING"):
            async def scenario():
                runtime, book = make_runtime()
                results = [await runtime.call(tool_call(name, arguments)) for name, arguments in (
                    ("get_price_history", {"market": "CN", "code": "000725"}),
                    ("search_news", {"market": "CN"}),
                    ("search_trades", {"asset": "京东方A"}),
                )]
                return book, results

            book, results = asyncio.run(scenario())
        self.assertEqual([result["code"] for result in results], ["TIMEOUT", "UPSTREAM_UNAVAILABLE", "INTERNAL_ERROR"])
        self.assertEqual(book.failed, {"get_price_history", "search_news", "search_trades"})
        self.assertEqual(book.envelopes, {})

    def test_prefetch_is_free_sets_focus_and_numbers_notes(self):
        async def scenario():
            runtime, _ = make_runtime()
            return runtime, await runtime.prefetch("get_trade_dossier", {"trade_id": "t-buy"})

        runtime, envelope = asyncio.run(scenario())
        self.assertTrue(envelope["ok"])
        self.assertEqual(runtime.calls, 0)
        self.assertEqual(runtime.focus, {"asset": "CN:code:000725", "symbol": "京东方A", "trade_id": "t-buy"})
        note = envelope["data"]["notes"][0]
        self.assertEqual((note["ref"], note["attribution"], note["text"]), ("N1", "你记录的", NOTE))
        self.assertEqual(trace_rows()[0]["kind"], "prefetch")

    def test_daily_context_numbers_original_notes_and_preserves_existing_fields(self):
        day = "2026-07-07"
        raw = {"trade_date": day, "summary": {"text": "原业务摘要", "facts": []},
               "today_trades": [TRADES[0]], "record_coverage": {"complete": False},
               "recent_notes": [{"trade_date": day, "text": "旧截取内容"}]}
        records = [
            {"note_id": "trade:t-buy", "kind": "trade_note", "author": "user", "date": day,
             "asset_key": "CN:code:000725", "trade_ids": ["t-buy"], "text": NOTE},
            {"note_id": "daily:day", "kind": "daily_note", "author": "user", "date": day,
             "trade_ids": ["t-buy"], "text": "京东方A回踩企稳，观察计划的执行。"},
            {"note_id": "asset:review", "kind": "asset_note", "author": "ai_review", "date": day,
             "trade_ids": ["t-buy"], "text": "这轮执行仍需核对成交记录。"},
            {"note_id": "daily:other", "kind": "daily_note", "author": "user", "date": "2026-07-08",
             "trade_ids": [], "text": "另一天的日记。"},
        ]

        async def scenario():
            runtime, book = make_runtime()
            daily = await runtime.call(tool_call("get_daily_context", {"date": day}, "daily"))
            dossier = await runtime.call(tool_call("get_trade_dossier", {"trade_id": "t-buy"}, "dossier"))
            return book, daily, dossier

        with patch.object(portfolio.today, "get_agent_daily_context", return_value=raw) as daily_handler, \
                patch.object(portfolio.notes, "note_records", return_value=records):
            book, daily, dossier = asyncio.run(scenario())
        self.assertTrue(daily["ok"], daily)
        self.assertTrue(dossier["ok"], dossier)
        daily_handler.assert_called_once_with(day)
        data = daily["data"]
        for key in ("trade_date", "today_trades", "record_coverage", "recent_notes"):
            self.assertEqual(data[key], raw[key])
        self.assertEqual(data["daily_summary"], raw["summary"])
        self.assertEqual(data["note_count"], 3)
        self.assertEqual([note["ref"] for note in data["notes"]], ["N1", "N2", "N3"])
        self.assertEqual([note["text"] for note in data["notes"]], [note["text"] for note in records[:3]])
        self.assertEqual([note["attribution"] for note in data["notes"]],
                         ["你记录的", "你记录的", "之前保存的AI复盘（不是用户观点）"])
        repeated = next(note for note in dossier["data"]["notes"] if note["note_id"] == "trade:t-buy")
        self.assertEqual(repeated["ref"], "N1")
        self.assertEqual(len(book.notes), 3)
        self.assertNotIn("daily:other", book.note_refs)
        legend = evidence.legend("当日日记[N2]，之前的AI复盘[N3]。", book)
        self.assertIn("[N2] Your daily journal · 2026-07-07", legend)
        self.assertIn("[N3] Previous AI review · 2026-07-07", legend)

    def test_daily_context_uses_canonical_dates_in_the_isolated_database(self):
        day = "2026-07-07"
        diary_text = "京东方A记录的观察条件。"
        long_text = "之前的AI复盘原文。" * 2000 + "最后的退出条件。"
        diary = portfolio.today.add_daily_note(portfolio.today.DailyNoteCreate(trade_date=day, text=diary_text))
        other = portfolio.today.add_daily_note(portfolio.today.DailyNoteCreate(trade_date="2026-07-08", text="其他日期的日记。"))
        review = storage.create_asset_note("CN:code:000725", long_text, source="ai_review")
        with storage.database() as connection:
            connection.execute("UPDATE asset_notes SET created_at=? WHERE id=?", (day + "T00:00:00+00:00", review["id"]))

        async def scenario():
            runtime, _ = make_runtime()
            return await runtime.call(tool_call("get_daily_context", {"date": day}))

        result = asyncio.run(scenario())
        self.assertTrue(result["ok"], result)
        records = {note["note_id"]: note for note in result["data"]["notes"]}
        self.assertEqual(set(records), {"trade:t-buy", f"daily:{diary['id']}", f"asset:{review['id']}"})
        self.assertEqual(records["trade:t-buy"]["text"], NOTE)
        daily = records[f"daily:{diary['id']}"]
        self.assertEqual((daily["date"], daily["text"], daily["author"]), (day, diary_text, "user"))
        self.assertNotIn("text_truncated", daily)
        ai_note = records[f"asset:{review['id']}"]
        self.assertEqual((ai_note["author"], ai_note["text"]), ("ai_review", long_text))
        self.assertNotIn("text_truncated", ai_note)
        self.assertNotIn(f"daily:{other['id']}", records)
        self.assertEqual(result["data"]["note_count"], 3)
        self.assertGreater(evidence.size(result), evidence.ENVELOPE_BYTES)

    def test_trace_redacts_note_search_terms(self):
        async def scenario():
            runtime, _ = make_runtime()
            return await runtime.call(tool_call("search_notes", {"query": "建仓", "tags": ["Pattern-Based Entry"]}))

        result = asyncio.run(scenario())
        self.assertEqual([note["text"] for note in result["data"]["notes"]], [NOTE])
        row = trace_rows()[0]
        self.assertEqual(json.loads(row["args_redacted"]), {
            "query": {"redacted": True, "length": 2}, "tags": {"redacted": True, "length": 1}, "author": "user", "limit": 20})
        self.assertNotIn("建仓", row["args_redacted"])


class ContextTests(AgentDatabaseTestCase):
    def test_scope_follows_the_legacy_intent_vocabulary(self):
        for message, scope in {
            "今天A股大盘怎么样？": "public",
            "京东方A最近有什么新闻？": "public",
            "我的持仓今天表现怎么样？": "private",
            "为什么我在7月7日买入京东方A？": "private",
            "帮我总结一下": "private",
        }.items():
            self.assertEqual(context.scope_of(ask(message)), scope, message)
        self.assertEqual(context.scope_of(ask("京东方A行情", trade_id="t-buy")), "private")

    def test_diary_and_note_requests_do_not_become_public_when_market_reads_are_declined(self):
        for message in ("请读取2026-10-23的日记，不查行情或新闻。", "请引用当天笔记原文，不查询行情。"):
            with self.subTest(message=message):
                self.assertEqual(context.scope_of(ask(message)), "private")
        self.assertEqual(context.scope_of(ask("600999最近日线收盘价是多少？没有数据就说明。")), "public")

    def test_private_context_prefetches_the_trade_dossier(self):
        async def scenario():
            runtime, _ = make_runtime()
            return await context.build(ask("帮我看看这笔", trade_id="t-buy"), "conv", "private", {}, runtime)

        built = asyncio.run(scenario())
        system = built.system()
        self.assertIn("## 账户卡片", system)
        self.assertIn("## 预取证据（本轮可引用）", system)
        self.assertIn(NOTE, system)
        self.assertEqual(built.prefetched[0]["tool"], "get_trade_dossier")
        self.assertIn("trade_id: t-buy", built.user)
        self.assertEqual([message["role"] for message in built.messages()], ["system", "user"])

    def test_prefetch_uses_mentions_then_focus_then_recent_notes(self):
        focus = {"asset": "CN:code:000725", "symbol": "京东方A", "trade_id": None}

        async def prefetched(message, focus_data=None):
            runtime, _ = make_runtime(run_id=message)
            built = await context.build(ask(message), "conv", "private", focus_data or {}, runtime)
            return [(item["tool"], item["data"].get("focus", {}).get("asset")) for item in built.prefetched]

        self.assertEqual(asyncio.run(prefetched("我为什么买入京东方A？")), [("get_trade_dossier", "CN:code:000725")])
        self.assertEqual(asyncio.run(prefetched("那后来卖出了吗？", focus)), [("get_trade_dossier", "CN:code:000725")])
        self.assertEqual(asyncio.run(prefetched("那601899呢？", focus)), [("get_trade_dossier", "CN:code:601899")])
        self.assertEqual(asyncio.run(prefetched("我最近的交易理由有什么共同点？")), [("search_notes", None)])
        self.assertEqual(asyncio.run(prefetched("帮我总结一下")), [])

    def test_public_context_has_no_private_layers(self):
        storage.save_turn("conv", "上一问", "上一问", "上一答", "2026-10-24T00:00:00+00:00")

        async def scenario():
            runtime, _ = make_runtime("public")
            focus = {"asset": "CN:code:000725", "symbol": "京东方A", "trade_id": "t-buy"}
            return await context.build(ask("今天A股大盘怎么样？"), "conv", "public", focus, runtime)

        built = asyncio.run(scenario())
        self.assertNotIn("## 账户卡片", built.system())
        self.assertNotIn("t-buy", built.system())
        self.assertIn("上一轮焦点标的：CN:code:000725（京东方A）", built.system())
        self.assertEqual((built.prefetched, built.history), ([], []))

    def test_history_drops_the_citation_legend(self):
        reply = "你记录的理由是回踩企稳[N1]。" + evidence.LEGEND_MARKER + "\n[N1] 你记录的交易笔记 · 2026-07-07 · 000725"
        storage.save_turn("conv", "我为什么买入？", "我为什么买入？", reply, "2026-10-24T00:00:00+00:00")
        self.assertEqual(context._history("conv"), [
            {"role": "user", "content": "我为什么买入？"},
            {"role": "assistant", "content": "你记录的理由是回踩企稳。"},
        ])

    def test_fit_shrinks_market_data_before_notes_and_history(self):
        book = evidence.EvidenceBook()
        dossier = book.add(registry.SPECS["get_trade_dossier"], {
            "focus": {"asset": "CN:code:000725"}, "trades": [{"id": f"t{index}", "price": 4.5} for index in range(50)],
            "notes": [{"note_id": "trade:t-buy", "kind": "trade_note", "author": "user", "text": NOTE}], "summary": "档案"})
        bars = book.add(registry.SPECS["get_price_history"], {
            "source": "Fake", "as_of": "2026-10-23", "summary": "日线",
            "recent_bars": [{"date": "2026-10-23", "close": 4.93, "volume": 123456}] * 200})
        built = context.Context("private", "header", [dossier], [{"role": "user", "content": "旧问题" * 500}], "问题")
        built.add_turn(ModelTurn(tool_calls=[tool_call("get_price_history", {"market": "CN", "code": "000725"}, "c1")]))
        built.add_result("c1", bars)

        built.fit([], evidence.size(built.messages()) // 3 - 1)
        self.assertNotIn("data", built.transcript[-1]["envelope"])
        self.assertIn("compacted", built.transcript[-1]["envelope"])
        self.assertIn("trades", built.prefetched[0]["data"])
        self.assertEqual(len(built.history), 1)

        with self.assertRaises(ContextTooLarge):
            built.fit([], 10)
        self.assertEqual(built.history, [])
        self.assertNotIn("trades", built.prefetched[0]["data"])
        self.assertEqual(built.prefetched[0]["data"]["notes"][0]["text"], NOTE)

    def test_daily_original_notes_survive_compaction_and_still_obey_context_budget(self):
        text = "当天的完整日记。" * 4000
        book = evidence.EvidenceBook()
        daily = book.add(registry.SPECS["get_daily_context"], {
            "notes": [{"note_id": "daily:long", "kind": "daily_note", "author": "user", "text": text}],
            "summary": "当日记录"})
        built = context.Context("private", "header", [], [{"role": "user", "content": "旧问题" * 500}], "问题")
        built.add_turn(ModelTurn(tool_calls=[tool_call("get_daily_context", {"date": "2026-07-07"}, "daily")]))
        built.add_result("daily", daily)

        with self.assertRaises(ContextTooLarge):
            built.fit([], 10)
        self.assertEqual(built.history, [])
        retained = built.transcript[-1]["envelope"]
        self.assertNotIn("compacted", retained)
        self.assertEqual(retained["data"]["notes"][0]["text"], text)
        self.assertEqual(retained["data"]["notes"][0]["ref"], "N1")

    def test_tool_turns_keep_reasoning_content_for_deepseek(self):
        built = context.Context("private", "header", [], [], "问题")
        built.add_turn(ModelTurn(tool_calls=[tool_call("search_notes", {"query": "止损"}, "c1")], reasoning="先查笔记"))
        built.add_result("c1", evidence.error("search_notes", "TIMEOUT", "slow"))
        assistant, tool = built.messages()[-2:]
        self.assertEqual((assistant["content"], assistant["reasoning_content"]), (None, "先查笔记"))
        self.assertEqual((tool["role"], tool["tool_call_id"], json.loads(tool["content"])["code"]), ("tool", "c1", "TIMEOUT"))


class RunStateTests(AgentDatabaseTestCase):
    @staticmethod
    def finish(run_id, payload, response, status="completed", focus_data=None):
        state.finish(run_id, response, status=status, payload=payload, conversation_id=payload.conversation_id,
                     focus_data=focus_data, steps=1, tools=0, usage={"prompt_tokens": 5}, latency_ms=3, flags=[])

    def test_client_message_ids_replay_or_conflict(self):
        payload = ask("京东方A怎么样？", conversation_id="conv", client_msg_id="m-1")
        run_id, _, replay = state.start(payload, "conv", 60)
        self.assertIsNone(replay)
        with self.assertRaises(HTTPException) as running:
            state.start(payload, "conv", 60)
        self.assertEqual((running.exception.status_code, running.exception.detail), (409, "This message is still being answered."))
        with self.assertRaises(HTTPException) as reused:
            state.start(payload.model_copy(update={"message": "另一个问题"}), "conv", 60)
        self.assertEqual(reused.exception.detail, "This client_msg_id was already used for another message.")

        response = {"conversation_id": "conv", "reply": "回答", "created_at": state.now_iso(),
                    "run_id": run_id, "engine": "v2", "agent_status": "completed"}
        self.finish(run_id, payload, response, focus_data={"asset": "CN:code:000725"})
        self.assertEqual(state.start(payload, "conv", 60), (run_id, "conv", response))
        self.assertEqual(state.focus("conv"), {"asset": "CN:code:000725"})
        self.assertEqual([message["content"] for message in storage.get_conversation("conv")["messages"]], ["京东方A怎么样？", "回答"])

    def test_one_running_answer_per_conversation_and_stale_runs_expire(self):
        old_run, _, _ = state.start(ask("问题一", conversation_id="conv"), "conv", 60)
        with self.assertRaises(HTTPException) as busy:
            state.start(ask("问题二", conversation_id="conv"), "conv", 60)
        self.assertEqual((busy.exception.status_code, busy.exception.detail), (409, "A response is already running in this conversation."))

        with storage.database() as connection:
            connection.execute("UPDATE agent_runs SET created_at='2000-01-01T00:00:00+00:00' WHERE run_id=?", (old_run,))
        new_run, _, replay = state.start(ask("问题二", conversation_id="conv"), "conv", 60)
        self.assertIsNone(replay)
        self.assertNotEqual(new_run, old_run)
        old = state.get_run(old_run)
        self.assertEqual((old["status"], old["error"]), ("failed", "INTERRUPTED"))

    def test_failed_attempt_frees_its_client_message_id(self):
        payload = ask("问题", conversation_id="conv", client_msg_id="m-2")
        failed_run, _, _ = state.start(payload, "conv", 60)
        self.finish(failed_run, payload, None, status="failed")
        retry_run, _, replay = state.start(payload, "conv", 60)
        self.assertIsNone(replay)
        self.assertNotEqual(retry_run, failed_run)
        self.assertEqual(state.get_run(failed_run)["status"], "failed")
        self.assertIsNone(storage.get_conversation("conv"))


if __name__ == "__main__":
    unittest.main()
