import unittest

from app.agent import evidence, guard
from app.agent.tools import registry


USER_NOTE = "回踩20日均线企稳，按计划分批建仓。"


def evidence_book(news_articles=True):
    book = evidence.EvidenceBook("我为什么在7月7日买入京东方A？")
    book.add(registry.SPECS["get_trade_dossier"], {
        "focus": {"asset": "CN:code:000725", "trade_id": "t-buy", "market": "CN"},
        "trades": [{"id": "t-buy", "symbol": "京东方A", "code": "000725", "type": "Buy", "qty": 1000,
                    "price": 4.5, "amount": 4500, "trade_date": "2026-07-07"}],
        "notes": [
            {"note_id": "trade:t-buy", "kind": "trade_note", "author": "user", "asset_key": "CN:code:000725",
             "trade_ids": ["t-buy"], "date": "2026-07-07", "tags": [], "text": USER_NOTE, "plan": {"sl": 4.2}},
            {"note_id": "asset:a1", "kind": "asset_note", "author": "ai_review", "asset_key": "CN:code:000725",
             "trade_ids": ["t-buy"], "date": "2026-10-23", "tags": [], "text": "之前的复盘认为仓位偏重。", "plan": {}},
        ],
        "summary": "返回 1/1 笔成交及 2 条完整笔记。",
    })
    book.add(registry.SPECS["get_price_history"], {
        "code": "000725", "market": "CN", "source": "BaoStock", "as_of": "2026-10-23",
        "period": {"start": "2026-09-23", "end": "2026-10-23"},
        "stats": {"last_close": {"date": "2026-10-23", "close": 4.93}, "change_pct": 5.2},
        "recent_bars": [], "summary": "截至 2026-10-23 收盘 4.93，区间涨跌 5.2%。",
    })
    book.add(registry.SPECS["search_news"], {
        "source": "Tavily", "period": {"start": "2026-10-17", "end": "2026-10-23"},
        "articles": [{"title": "京东方A发布三季报", "url": "https://example.com/boe", "date": "2026-10-22"}] if news_articles else [],
        "summary": "京东方A 检索到带日期的新闻。",
    })
    return book


def codes(reply, book):
    return [issue.code for issue in guard.check(reply, book)]


class GuardCheckTests(unittest.TestCase):
    def test_cited_reply_with_a_quoted_note_is_clean(self):
        reply = f"你记录的交易理由是“{USER_NOTE}”[N1] 截至2026-10-23收盘价为4.93元[E2]，近一个月上涨5.2%[E2]。"
        self.assertEqual(guard.check(reply, evidence_book()), [])

    def test_sentences_keep_quotes_and_trailing_citations_together(self):
        self.assertEqual(guard.sentences("你记录的理由是“A。B。”[N1]然后C。"), ["你记录的理由是“A。B。”[N1]", "然后C。"])
        self.assertEqual(guard.sentences("你当时认为回踩企稳是买点。[N1]"), ["你当时认为回踩企稳是买点。[N1]"])
        text = "建议你立即加仓。\n[N1] 你说“A”。然后B！"
        self.assertEqual("".join(guard.sentences(text)), text)

    def test_markdown_bold_does_not_separate_a_trailing_note_citation(self):
        book = evidence_book()
        for marker in ("**", "__"):
            reply = f"{marker}你记录的理由是：“{USER_NOTE}”{marker}[N1]\n成交价4.50元[E1]。"
            self.assertEqual("".join(guard.sentences(reply)), reply)
            self.assertEqual(guard.check(reply, book), [])
        self.assertEqual(codes(f"**你记录的理由是：“{USER_NOTE}”**[N999]", book), ["unknown_citation"])

    def test_unknown_citations_block_and_fix_keeps_only_real_refs(self):
        book = evidence_book()
        reply = "截至2026-10-23收盘价4.93元[E2, E9]，详见【N7】。"
        issues = guard.check(reply, book)
        self.assertEqual([(issue.code, issue.excerpt) for issue in issues], [("unknown_citation", "E9"), ("unknown_citation", "N7")])
        fixed = guard.fix(reply, book)
        self.assertIn("[E2]", fixed)
        self.assertNotIn("E9", fixed)
        self.assertNotIn("N7", fixed)

    def test_motive_claims_need_a_note_citation(self):
        book = evidence_book()
        self.assertEqual(codes("你买入是因为看好面板涨价。", book), ["uncited_motive"])
        self.assertEqual(codes("你买入是因为看好面板涨价[N1]。", book), [])
        self.assertEqual(codes("你买入是因为什么？", book), [])
        self.assertEqual(codes("这笔卖出你没有记录理由，无法判断你卖出是因为止盈还是止损。", book), [])
        self.assertEqual(codes("下次可以在笔记里写下你买入是因为什么信号。", book), [])
        self.assertEqual(codes(f"你记录的交易理由如下：\n“{USER_NOTE}”[N1]", book), [])
        self.assertEqual(codes(f"### 你记录的理由（原文与译意）\n“{USER_NOTE}”[N1]", book), [])
        self.assertEqual(codes("你记录的交易理由如下：\n回踩企稳。", book), ["uncited_motive"])

    def test_ai_review_cannot_be_presented_as_the_users_view(self):
        book = evidence_book()
        self.assertEqual(codes("你在笔记中提到仓位偏重[N2]。", book), ["ai_review_as_user"])
        self.assertEqual(codes("之前的复盘认为仓位偏重[N2]。", book), [])
        self.assertEqual(codes("你在笔记中提到回踩企稳[N1]。", book), [])

    def test_realtime_wording_needs_a_date_and_respects_negation(self):
        book = evidence_book()
        self.assertEqual(codes("京东方A当前价4.93元[E2]。", book), ["realtime_claim"])
        self.assertEqual(codes("截至2026-10-23收盘价4.93元[E2]，这不是实时价格。", book), [])
        self.assertEqual(codes("这体现价值回归。", book), [])
        self.assertEqual(codes("The quote is not real-time [E2]", book), [])
        self.assertEqual(codes("The quote is not real-time [E2], but the live price moved", book), ["realtime_claim"])

    def test_compliance_blocks_advice_and_guarantees_but_not_negations(self):
        book = evidence_book()
        for reply in ("建议你立即加仓。", "这只股票必涨。", "这个方法稳赚。"):
            self.assertEqual(codes(reply, book), ["compliance"], reply)
        for reply in ("不建议你买入。", "未必涨。", "确保本金安全。"):
            self.assertEqual(codes(reply, book), [], reply)

    def test_false_missing_only_when_the_evidence_is_complete(self):
        self.assertEqual(codes("本轮没有检索到相关新闻。", evidence_book()), ["false_missing"])
        self.assertEqual(codes("本轮没有检索到相关新闻。", evidence_book(news_articles=False)), [])
        failed = evidence_book()
        failed.failed.add("search_news")
        self.assertEqual(codes("本轮没有检索到相关新闻。", failed), [])
        self.assertEqual(codes("未能获取到行情数据。", evidence_book()), ["false_missing"])
        self.assertEqual(codes("未能获取到实时行情。", evidence_book()), [])

        partial = evidence.EvidenceBook()
        partial.add(registry.SPECS["get_index_snapshot"], {"source": "BaoStock", "as_of": "2026-10-23", "summary": "",
                                                           "indexes": [{"code": "^HSI", "available": False}]})
        self.assertEqual(codes("未能获取到行情数据。", partial), [])

    def test_numbers_must_come_from_evidence(self):
        book = evidence_book()
        reply = "成本4.5元，最近收盘约4.9元，涨幅12.3%，收益率52%，成交1,000股，价格4930，代码000725，2026-07-07 10:00 共3笔。"
        self.assertEqual(guard.ungrounded_numbers(reply, book), ["12.3", "52", "4930", "3"])
        self.assertEqual(guard.check(reply, book), [guard.Issue("ungrounded_numbers", "12.3,52,4930,3"),
                                                 guard.Issue("uncited_numbers", "4.5,4.9,1,000")])
        self.assertEqual(len(guard.blocking(guard.check(reply, book))), 2)

    def test_small_prices_counts_and_negative_returns_are_not_exempt(self):
        book = evidence_book()
        self.assertEqual(guard.ungrounded_numbers("价格7元，持有3股，收益率-5.2%。", book), ["7", "3", "-5.2"])
        self.assertEqual(guard.check("价格4.5元[E1]，持有1000股[E1]，涨幅5.2%[E2]。", book), [])

    def test_user_numbers_and_wrong_sources_are_not_verified_evidence(self):
        book = evidence_book()
        book.user_text = "我赚了987.65元"
        self.assertEqual(guard.ungrounded_numbers("收益987.65元[E1]。", book), ["987.65"])
        self.assertEqual(codes("收盘4.93元[E1]。", book), ["uncited_numbers"])
        self.assertEqual(codes("收盘4.93元。", book), ["uncited_numbers"])

    def test_numeric_report_excludes_dates_codes_lists_and_note_ma_labels(self):
        book = evidence_book()
        reply = "1. 代码000725，截至2026-10-23收盘4.93元[E2]。\n2. 回踩20日均线[N1]。"
        self.assertEqual(guard.number_report(reply, book), {"total": 1, "grounded": 1, "cited": 1,
                                                           "grounding_rate": 1.0, "citation_rate": 1.0})
        self.assertIsNone(guard.number_report("暂无数值。", book)["grounding_rate"])
        self.assertEqual(guard.ungrounded_numbers("金额2000元。", evidence.EvidenceBook()), ["2000"])

    def test_months_and_spaced_dates_are_not_trading_values(self):
        book = evidence_book()
        reply = "7月与8月属于不同周期。6—7月缺少日线。2026年10 月 23 日收盘4.93元[E2]。"
        self.assertEqual(guard.check(reply, book), [])
        self.assertEqual(guard.number_report(reply, book)["total"], 1)
        self.assertEqual(guard.ungrounded_numbers("7月价格7元，持有12股、12天和12个月。", book), ["7", "12", "12", "12"])

    def test_decimal_prices_after_dates_are_not_list_markers(self):
        book = evidence_book()
        self.assertEqual(guard.check("- 7月7日 4.50元[E1]。", book), [])
        self.assertEqual(guard.ungrounded_numbers("- 9月16日 4.40元[E1]。", book), ["4.40"])
        self.assertEqual(guard.ungrounded_numbers("- 7月7日 -4.50元[E1]。", book), ["-4.50"])
        self.assertEqual(guard.ungrounded_numbers("1.价格7元。\n2）数量12股。", book), ["7", "12"])

    def test_note_quotes_must_be_verbatim_and_translation_stays_outside(self):
        book = evidence_book()
        book.notes["N1"]["text"] = "Take profit at the planned target."
        self.assertEqual(codes("你记录的交易理由是“达到目标后止盈离场。”[N1]。", book), ["note_quote_mismatch"])
        self.assertEqual(codes("你记录的交易理由是“Take profit at the planned target.”[N1]；译意：达到目标后止盈。", book), [])


class GuardRepairAndFixTests(unittest.TestCase):
    def test_repair_prompt_lists_each_problem_once_with_excerpts(self):
        book = evidence_book()
        issues = guard.check("你买入是因为看好面板涨价[E9]。建议你立即加仓。", book)
        prompt = guard.repair_prompt(issues)
        self.assertIn("1. 引用了本轮证据中不存在的编号（E9）", prompt)
        self.assertIn("2. 关于用户交易理由的描述没有附笔记编号", prompt)
        self.assertIn("3. 包含具体买卖建议或收益保证", prompt)
        self.assertIn("原句：“建议你立即加仓。”", prompt)
        self.assertTrue(prompt.endswith("请直接输出修改后的完整回答，不要调用工具，不要解释修改过程。"))

    def test_fix_dates_realtime_wording_and_removes_advice_once(self):
        book = evidence_book()
        fixed = guard.fix("京东方A当前价4.93元[E2]。建议你立即加仓。建议你马上清仓。这不是实时数据。", book)
        self.assertEqual(fixed, "京东方A截至2026-10-23的收盘价4.93元[E2]。" + guard.COMPLIANCE_NOTE + "这不是实时数据。")
        self.assertEqual(guard.blocking(guard.check(fixed, book)), [])

    def test_fix_without_market_data_uses_a_generic_daily_label(self):
        fixed = guard.fix("京东方A的实时走势偏强。", evidence.EvidenceBook())
        self.assertEqual(fixed, "京东方A的最近日线走势偏强。")

    def test_fix_removes_unverified_numbers_and_false_note_quotes(self):
        book = evidence_book()
        fixed = guard.fix("盈亏987.65元[E1]。行情4.93元[E2]。", book)
        self.assertNotIn("987.65", fixed)
        self.assertIn("4.93元[E2]", fixed)
        self.assertIn(guard.NUMBERS_NOTE, fixed)
        self.assertEqual(guard.check(fixed, book), [])
        fixed = guard.fix("你记录的交易理由是“为了快速获利才买入。”[N1]。", book)
        self.assertNotIn("快速获利", fixed)
        self.assertIn(guard.QUOTE_NOTE, fixed)
        self.assertEqual(guard.check(fixed, book), [])

    def test_fix_omits_unsupported_motives_instead_of_leaving_a_claim_with_a_warning(self):
        book = evidence_book()
        fixed = guard.fix("你买入是因为看好面板涨价。", book)
        self.assertEqual(fixed, guard.FIX_NOTES["uncited_motive"])
        self.assertEqual(guard.check(fixed, book), [])
        fixed = guard.fix("你在笔记中提到仓位偏重[N2]。", book)
        self.assertEqual(fixed, guard.FIX_NOTES["ai_review_as_user"])
        self.assertEqual(guard.check(fixed, book), [])


class LegendTests(unittest.TestCase):
    def test_dossier_keeps_full_note_even_above_the_generic_envelope_limit(self):
        text = "这笔交易的理由。" * 4000 + "最后的退出条件。"
        book = evidence.EvidenceBook()
        envelope = book.add(registry.SPECS["get_trade_dossier"], {
            "notes": [{"note_id": "trade:long", "author": "user", "kind": "trade_note", "text": text}], "summary": "完整笔记"})
        self.assertEqual(envelope["data"]["notes"][0]["text"], text)
        self.assertNotIn("text_truncated", envelope["data"]["notes"][0])
        self.assertGreater(evidence.size(envelope), evidence.ENVELOPE_BYTES)

    def test_legend_lists_cited_sources_in_first_use_order(self):
        book = evidence_book()
        reply = evidence.legend("理由见[N1]，之前的复盘见[N2]。行情[E2]和新闻[E3]，重复引用[N1]，无效[E9]。", book)
        body, legend = reply.split(evidence.LEGEND_MARKER)
        self.assertTrue(body.endswith("无效[E9]。"))
        self.assertEqual(legend.strip().split("\n\n"), [
            "[N1] 你记录的交易笔记 · 2026-07-07 · 000725",
            "[N2] 之前保存的AI复盘 · 2026-10-23 · 000725",
            "[E2] 日线行情 · BaoStock · 截至 2026-10-23",
            "[E3] 新闻检索 · Tavily · 2026-10-17~2026-10-23",
        ])

    def test_reply_without_known_citations_is_unchanged(self):
        self.assertEqual(evidence.legend("没有引用。[E9]", evidence_book()), "没有引用。[E9]")


if __name__ == "__main__":
    unittest.main()
