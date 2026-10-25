import re
from bisect import bisect_left
from dataclasses import dataclass

from . import evidence

LEADING_CITATIONS = re.compile(r"(?:[ \t]*(?:\*\*|__)?[ \t]*" + evidence.CITATION.pattern + r"(?:\*\*|__)?)+")
TERMINATORS = "。！？!?"
SENTENCE_END = TERMINATORS + "."
OPENING_QUOTES = "“‘「『（"
CLOSING_QUOTES = "”’」』）"
LIST_MARKER = re.compile(r"[ \t]*(?:[-*>][ \t]*)?(?:#{1,6}[ \t]*)?(?:\d{1,3}|[A-Za-z])")
ABBREVIATION = re.compile(r"(?:(?i:\b(?:e\.g|i\.e|vs|approx|incl|mr|mrs|ms|dr))|(?<![A-Za-z])[A-Z])\Z")
NEGATION = re.compile(r"[非不没无未]|\bnot\b|\bnon-?|n't|\bno\b|\bnever\b|\bwithout\b|\bcannot\b", re.I)
MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)"
MOTIVE_CLAIM = re.compile(
    r"你.{0,12}(买入|卖出|买|卖|加仓|减仓|建仓|清仓).{0,12}(因为|是因为|由于|原因是|理由是)|你记录的.{0,10}(理由|原因|动机|计划)"
    r"|你的(理由|动机|原因)是|你当时(认为|觉得|担心|打算|计划|想|判断|看好|预期)"
    r"|(?i:\byou\s+(?:bought|sold|added|trimmed|exited|entered|closed|cut)\b[^.?!\n]{0,40}\b(?:because|since|due to)\b"
    r"|\byour\s+(?:recorded\s+)?(?:reason|rationale|motive|motivation|thesis)s?\s+(?:was|were|is|for)\b"
    r"|\bthe reasons?\s+(?:you|for your)\b"
    r"|\byou\s+(?:were|felt)\s+(?:bullish|bearish|optimistic|confident|afraid|worried|fearful|greedy|anxious|nervous)\b"
    r"|\byou\s+(?:thought|believed|expected|feared|worried|wanted|intended|hoped)\b)")
NO_RECORD = re.compile(
    r"(没有|未|没|无)(有)?.{0,4}(记录|写|笔记|提到|说明)|未找到|找不到"
    r"|(?i:\b(?:no|not|never|didn't|did not|wasn't|was not|isn't|is not|without)\b[^.?!\n]{0,20}\b(?:record|recorded|note|notes|written|wrote|mention|mentioned|documented|reason)\b"
    r"|\bcould(?:n't| not) find\b|\bnot found\b)")
ADVICE = re.compile(
    r"建议|下次|今后|以后|不妨|可以考虑|记得|试着|如果你"
    r"|(?i:\bnext time\b|\bgoing forward\b|\bin the future\b|\bconsider\b|\btry to\b|\bremember to\b|\bif you\b|\byou (?:could|might|may want to)\b)")
AI_AS_USER = re.compile(
    r"你(自己)?(在[^，。]{0,8})?(记录|写|提到|认为|说|表示)|你的(笔记|记录|想法|观点|理由)"
    r"|(?i:\byou\s+(?:yourself\s+)?(?:wrote|recorded|noted|said|mentioned|stated|thought|believed|argued|felt)\b"
    r"|\byour\s+(?:own\s+)?(?:note|notes|record|records|view|views|opinion|thinking|idea|reason|reasons|assessment)\b)")
REALTIME = re.compile(
    r"实时|当前价|(?<![体实出表发呈兑再])现价|最新价|最新股价|目前股价|real-?time|live price"
    r"|\b(?:current|latest|today's)\s+(?:stock\s+|share\s+|market\s+)?(?:price|quote)s?\b"
    r"|\blive\s+(?:quotes?|market data)\b", re.I)
DATED = re.compile(r"\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日|截至|\bas of\b|\b" + MONTHS + r"\.?\s+\d{1,2}\b", re.I)
COMPLIANCE = re.compile(
    r"建议(你)?(?:立即|马上|尽快|可以|考虑|适当|逐步|择机|继续){0,3}(买入|卖出|加仓|减仓|清仓|抄底|满仓|全仓|追涨|割肉)"
    r"|稳赚|保证收益|(?<![确担])保本(?!金)|必涨|必跌|一定会(涨|跌)|肯定会(涨|跌)|目标价必达"
    r"|(?i:\b(?:I|we)\s+(?:would\s+|strongly\s+)?(?:recommend|suggest|advise)\s+(?:that\s+)?(?:you\s+)?(?:to\s+)?(?:\w+ly\s+|now\s+)?(?:buy|buying|sell|selling|short|shorting|load up|dump|go long|add(?:ing)? to)\b"
    r"|\byou\s+should\s+(?:\w+ly\s+|now\s+|just\s+)?(?:buy|sell|short|add to|load up|dump|go all[- ]in|take profits?)\b"
    r"|\bguaranteed\s+(?:returns?|profits?|gains?)\b"
    r"|\bguarantees?\s+(?:you\s+)?(?:a\s+)?(?:returns?|profits?|gains?)\b"
    r"|\brisk[- ]free\s+(?:returns?|profits?|trades?)\b"
    r"|\bsure[- ](?:win|thing|bet)\b|\bcan'?t\s+lose\b"
    r"|\b(?:will|is going to)\s+definitely\s+(?:rise|go up|fall|go down|rally|drop)\b"
    r"|\bis\s+(?:bound|certain|sure)\s+to\s+(?:rise|go up|fall|drop|rally)\b)")
NEWS_MISSING = re.compile(
    r"(没有|未|无法|未能|暂未)(检索到|找到|获取到?|查到|搜到|获得)[^，。！？,!?\n]{0,10}(新闻|报道|消息)|暂无(相关)?新闻"
    r"|(?i:\b(?:could(?:n't| not)|did(?:n't| not)|was unable to|unable to)\s+(?:find|retrieve|get|locate)\s+(?:any\s+)?(?:relevant\s+|recent\s+|related\s+)?(?:news|articles|reports|headlines)\b"
    r"|\bno\s+(?:relevant\s+|recent\s+|related\s+)?(?:news|articles|reports|headlines)\s+(?:was\s+|were\s+)?(?:found|available|retrieved|returned)\b)")
MARKET_MISSING = re.compile(
    r"(没有|未|无法|未能|暂未)(检索到|找到|获取到?|查到|搜到|获得)[^，。！？,!?\n实时]{0,10}(行情|价格|日线|股价)|暂无(相关)?(行情|价格|日线)"
    r"|(?i:\b(?:could(?:n't| not)|did(?:n't| not)|was unable to|unable to)\s+(?:find|retrieve|get|locate)\s+(?:any\s+)?(?:relevant\s+|recent\s+|related\s+)?(?:market data|price data|prices|daily bars|bars|quotes|price history)\b"
    r"|\bno\s+(?:relevant\s+|recent\s+|related\s+)?(?:market data|price data|prices|daily bars|bars|quotes|price history)\s+(?:was\s+|were\s+)?(?:found|available|retrieved|returned)\b)")
NUMBER = re.compile(r"(?<![A-Za-z0-9_.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?")
NUMBER_NOISE = re.compile(
    r"https?://\S+|\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?"
    r"|\d{1,2}\s*月\s*\d{1,2}\s*日|(?<!\d)\d{1,2}\s*[-–—~至到]\s*\d{1,2}\s*月"
    r"|\d{4}\s*年|\d{1,2}\s*月|\d{1,2}:\d{2}(?::\d{2})?"
    r"|\b" + MONTHS + r"\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s*(?:19|20)\d{2}\b)?"
    r"|\b\d{1,2}(?:st|nd|rd|th)?\s+" + MONTHS + r"\b(?:,?\s*(?:19|20)\d{2}\b)?"
    r"|\b" + MONTHS + r"\s+(?:19|20)\d{2}\b"
    r"|\b(?:in|since|during|by|early|late|mid|Q[1-4]|H[12]|FY)\s*-?\s*(?:19|20)\d{2}\b(?!\s*(?:shares|CNY|USD|HKD|yuan|dollars|%))", re.I)
NUMBER_LABEL = re.compile(
    r"(?m)^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?\d+(?:\.(?!\d)|[)）、])\s*|第\d+(?:笔|次|条|步)|(?:MA|ma)\s*\d+|\d+\s*(?:日|天)\s*均线"
    r"|(?i:\b\d+\s*-?\s*(?:day|week)\s+(?:moving\s+)?(?:average|MA|SMA|EMA)\b"
    r"|\b\d+(?:st|nd|rd|th)\b"
    r"|\b(?:past|last|previous|recent|over the past|over the last)\s+\d{1,2}\s+(?:days?|weeks?|months?|years?)\b"
    r"|\b\d{1,2}-(?:month|week|year)\b)")
TICKER_NUMBER = re.compile(r"\d{5,6}")
VALUE_CONTEXT = re.compile(r"(?:成本|价格|价|盈亏|收益|金额|成交|数量|盈利|亏损|股数|[¥$￥]|CNY|HKD|USD|price|profit|loss|amount|shares)(?:为|是|约|共)?\s*[:：]?\s*$", re.I)
VALUE_UNIT = re.compile(r"元|股|手|%|％|万|亿|点|dollars|shares|CNY|HKD|USD", re.I)
NOTE_QUOTE = re.compile(r"[“「](?P<text>[^”」\n]{6,})[”」]\s*(?:\*\*|__)?\s*" + evidence.CITATION.pattern)
BLOCKING = {"unknown_citation", "uncited_motive", "ai_review_as_user", "realtime_claim", "compliance", "false_missing",
            "ungrounded_numbers", "uncited_numbers", "note_quote_mismatch"}
REPAIR_MESSAGES = {
    "unknown_citation": "引用了本轮证据中不存在的编号（{refs}）：删除这些编号，只使用真实存在的 [E#]/[N#]。",
    "uncited_motive": "关于用户交易理由的描述没有附笔记编号：引用笔记原话并附 [N#]；没有对应笔记就明确说“未记录理由”，不要推测动机。",
    "ai_review_as_user": "把之前保存的AI复盘说成了用户自己的记录或观点：改称“之前的复盘”。",
    "realtime_claim": "暗示了实时价格：行情是注明日期的日线，改为“截至某日的收盘价”。",
    "compliance": "包含具体买卖建议或收益保证：删除，改为讨论记录中的计划与执行、可观察的风险。",
    "false_missing": "声称没有取到新闻或行情，但本轮证据中实际有：改为引用这些证据。",
    "ungrounded_numbers": "数字没有在本轮工具证据中找到或盈亏正负号不符：删除未核实数字，只用已取到的证据，不自行补算；用户消息和页面数字不是核实依据。",
    "uncited_numbers": "数字缺少对应来源：在同一句中引用确实包含这些数值的 [E#]，笔记中的预期或计划用 [N#]；不要引用不相关证据。",
    "note_quote_mismatch": "引号内的笔记不是引用来源中的逐字原文：保留真实原话及 [N#]，翻译放在引号外并标为译意。",
}
COMPLIANCE_NOTE = "(Removed a specific buy/sell recommendation: TradingNote doesn't give trade recommendations or return guarantees.)"
FIX_NOTES = {
    "uncited_motive": "(Omitted a statement about your trade reasons that had no note source; please rely on your own notes.)",
    "ai_review_as_user": "(Omitted a statement that presented a previous AI review as your own note.)",
    "false_missing": "(Note: this turn did retrieve relevant news or market data; rely on the evidence in the cited sources.)",
}
NUMBERS_NOTE = "(Some figures could not be matched to this turn's tool evidence and were omitted; rely on the verified cited sources.)"
QUOTE_NOTE = "(A note quotation did not match your saved original word for word and was omitted; rely on your saved note.)"


@dataclass(frozen=True)
class Issue:
    code: str
    excerpt: str = ""


def _sentence_dot(text: str, index: int) -> bool:
    rest = text[index + 1:].lstrip("*_")
    if rest and not rest[0].isspace() and rest[0] not in "[【":
        return False
    line = text[text.rfind("\n", 0, index) + 1:index]
    return not LIST_MARKER.fullmatch(line) and not ABBREVIATION.search(text[max(0, index - 10):index])


def _pieces(text: str) -> list[str]:
    pieces, start, depth, straight = [], 0, 0, False
    for index, char in enumerate(text):
        closing = False
        if char == '"':
            straight, closing = not straight, straight
        elif char in OPENING_QUOTES:
            depth += 1
        elif char in CLOSING_QUOTES and not (char == "’" and text[index - 1:index].isalpha() and text[index + 1:index + 2].isalpha()):
            depth, closing = max(0, depth - 1), True
        if char == "\n":
            depth, straight = 0, False
        elif depth or straight or index + 1 < len(text) and text[index + 1] in CLOSING_QUOTES:
            continue
        elif closing:
            if not (index and text[index - 1] in SENTENCE_END):
                continue
        elif char not in TERMINATORS and not (char == "." and _sentence_dot(text, index)):
            continue
        pieces.append(text[start:index + 1])
        start = index + 1
    if start < len(text):
        pieces.append(text[start:])
    return pieces


def sentences(text: str) -> list[str]:
    merged: list[str] = []
    for piece in _pieces(text):
        match = LEADING_CITATIONS.match(piece)
        if merged and match and not merged[-1].endswith("\n"):
            merged[-1] += match.group(0)
            piece = piece[match.end():]
        if piece:
            merged.append(piece)
    return merged


def _excerpt(sentence: str) -> str:
    return " ".join(sentence.split())[:80]


def _negated(sentence: str, start: int) -> bool:
    width = 16 if sentence[start:start + 1].isascii() else 6
    return bool(NEGATION.search(sentence[max(0, start - width):start]))


def _unnegated(pattern: re.Pattern, sentence: str) -> bool:
    return any(not _negated(sentence, match.start()) for match in pattern.finditer(sentence))


def _has_note(sentence: str) -> bool:
    return any(ref.startswith("N") for ref in evidence.citations(sentence))


def _uncited_motive(parts: list[str], index: int) -> bool:
    sentence = parts[index]
    if not MOTIVE_CLAIM.search(sentence) or _has_note(sentence):
        return False
    plain = evidence.CITATION.sub("", sentence).strip()
    if plain.endswith(("？", "?")) or NO_RECORD.search(sentence) or ADVICE.search(sentence):
        return False
    heading = re.fullmatch(
        r"你记录的(?:交易)?(?:理由|动机|计划)(?:（[^）]{0,20}）)?[：:]?"
        r"|(?i:(?:your\s+)?(?:recorded\s+)?(?:trade\s+|buy\s+|sell\s+)?(?:reasons?|rationale|motives?|plans?)(?:\s*\([^)]{0,30}\))?\s*:?)",
        plain.strip("#* "))
    if heading or plain.endswith(("：", ":")):
        return not (index + 1 < len(parts) and _has_note(parts[index + 1]))
    return True


def _ai_review_as_user(sentence: str, book: evidence.EvidenceBook) -> bool:
    start = 0
    for match in evidence.CITATION.finditer(sentence):
        refs = evidence.refs_in(match.group(1))
        if any(ref in book.notes and book.notes[ref].get("author") != "user" for ref in refs) \
                and _unnegated(AI_AS_USER, sentence[start:match.start()]):
            return True
        start = match.end()
    return False


def _news_complete(book: evidence.EvidenceBook) -> bool:
    news = book.by_tool("search_news")
    return bool(news) and "search_news" not in book.failed and all(item["data"].get("articles") for item in news)


def _market_complete(book: evidence.EvidenceBook) -> bool:
    market = book.by_tool("get_price_history", "get_index_snapshot")
    if not market or {"get_price_history", "get_index_snapshot"} & book.failed:
        return False
    return all(item["data"].get("stats") or item["data"].get("indexes")
               and all(row.get("available") for row in item["data"]["indexes"]) for item in market)


def _evidence_numbers(text: str) -> list[float]:
    return sorted(float(raw.replace(",", "")) for raw in NUMBER.findall(NUMBER_NOISE.sub(" ", text)))


def _number_checks(reply: str, book: evidence.EvidenceBook) -> list[dict]:
    known = _evidence_numbers(book.grounding_text())
    checks = []
    for sentence in sentences(reply.split(evidence.LEGEND_MARKER)[0]):
        sources = []
        for ref in evidence.citations(sentence):
            if ref in book.envelopes:
                envelope = book.envelopes[ref]
                sources.append(envelope["summary"] + evidence.dumps(envelope["data"]))
            elif ref in book.notes:
                sources.append(evidence.dumps(book.notes[ref]))
        cited = _evidence_numbers("\n".join(sources))
        text = NUMBER_LABEL.sub(" ", NUMBER_NOISE.sub(" ", evidence.CITATION.sub(" ", sentence))).replace("**", "")
        for match in NUMBER.finditer(text):
            raw = match.group(0)
            suffix = text[match.end():].lstrip()
            unit = suffix[:1]
            if TICKER_NUMBER.fullmatch(raw) and not VALUE_UNIT.match(suffix) \
                    and not VALUE_CONTEXT.search(text[max(0, match.start() - 10):match.start()]):
                continue
            value = float(raw.replace(",", ""))
            decimals = len(raw.split(".")[1]) if "." in raw else 0
            scales = [1.0] + ([0.01] if unit in {"%", "％"} else []) + ([1e4] if unit == "万" else []) + ([1e8] if unit == "亿" else [])

            def supported(values):
                return any(_near(values, value * scale, 0.5 * 10 ** -decimals * scale + 1e-9) for scale in scales)
            checks.append({"raw": raw, "grounded": supported(known), "cited": supported(cited)})
    return checks


def number_report(reply: str, book: evidence.EvidenceBook) -> dict:
    checks = _number_checks(reply, book)
    total = len(checks)
    grounded, cited = sum(item["grounded"] for item in checks), sum(item["cited"] for item in checks)
    return {"total": total, "grounded": grounded, "cited": cited,
            "grounding_rate": grounded / total if total else None,
            "citation_rate": cited / total if total else None}


def ungrounded_numbers(reply: str, book: evidence.EvidenceBook) -> list[str]:
    return [item["raw"] for item in _number_checks(reply, book) if not item["grounded"]]


def _quote_mismatches(reply: str, book: evidence.EvidenceBook) -> list[str]:
    mismatches = []
    for match in NOTE_QUOTE.finditer(reply):
        notes = [book.notes[ref] for ref in evidence.citations(match.group(0)) if ref in book.notes]
        if notes and not any(match.group("text") in str(note.get("text") or "") or match.group("text") in note.get("tags", []) for note in notes):
            mismatches.append(match.group("text"))
    return mismatches


def _near(values: list[float], target: float, tolerance: float) -> bool:
    index = bisect_left(values, target - tolerance)
    return index < len(values) and values[index] <= target + tolerance


def check(reply: str, book: evidence.EvidenceBook) -> list[Issue]:
    issues = [Issue("unknown_citation", ref) for ref in dict.fromkeys(evidence.citations(reply)) if not book.has(ref)]
    parts = sentences(reply)
    news_complete, market_complete = _news_complete(book), _market_complete(book)
    for index, sentence in enumerate(parts):
        excerpt = _excerpt(sentence)
        if _uncited_motive(parts, index):
            issues.append(Issue("uncited_motive", excerpt))
        if _ai_review_as_user(sentence, book):
            issues.append(Issue("ai_review_as_user", excerpt))
        if _unnegated(REALTIME, sentence) and not DATED.search(sentence):
            issues.append(Issue("realtime_claim", excerpt))
        if _unnegated(COMPLIANCE, sentence):
            issues.append(Issue("compliance", excerpt))
        if news_complete and NEWS_MISSING.search(sentence) or market_complete and MARKET_MISSING.search(sentence):
            issues.append(Issue("false_missing", excerpt))
    numbers = _number_checks(reply, book)
    missing = [item["raw"] for item in numbers if not item["grounded"]]
    uncited = [item["raw"] for item in numbers if item["grounded"] and not item["cited"]]
    if missing:
        issues.append(Issue("ungrounded_numbers", ",".join(missing[:10])))
    if uncited:
        issues.append(Issue("uncited_numbers", ",".join(uncited[:10])))
    issues += [Issue("note_quote_mismatch", text[:80]) for text in _quote_mismatches(reply, book)]
    return issues


def blocking(issues: list[Issue]) -> list[Issue]:
    return [issue for issue in issues if issue.code in BLOCKING]


def repair_prompt(issues: list[Issue]) -> str:
    lines = ["请修改你上一条回答中的以下问题："]
    codes = list(dict.fromkeys(issue.code for issue in blocking(issues)))
    for number, code in enumerate(codes, 1):
        excerpts = [issue.excerpt for issue in issues if issue.code == code]
        if code == "unknown_citation":
            lines.append(f"{number}. " + REPAIR_MESSAGES[code].format(refs="、".join(excerpts)))
            continue
        lines.append(f"{number}. " + REPAIR_MESSAGES[code])
        lines += [f"   - 原句：“{excerpt}”" for excerpt in excerpts[:3]]
    lines.append("保持原回答的语言：用户用英文提问就全文用英文回答；笔记原文保持原语言，译意放在引号外。")
    lines.append("请直接输出修改后的完整回答，不要调用工具，不要解释修改过程。")
    return "\n".join(lines)


def _strip_unknown(text: str, book: evidence.EvidenceBook) -> str:
    def replace(match: re.Match) -> str:
        kept = [ref for ref in evidence.refs_in(match.group(1)) if book.has(ref)]
        return f"[{', '.join(kept)}]" if kept else ""
    return evidence.CITATION.sub(replace, text)


def fix(reply: str, book: evidence.EvidenceBook) -> str:
    """Deterministic last resort when the repair turn is unavailable or still blocked."""
    latest = book.latest_market_date()
    price = f"截至{latest}的收盘价" if latest else "最近收盘价"
    english_price = f"close as of {latest}" if latest else "latest daily close"

    def dated(sentence: str) -> str:
        def replace(match: re.Match) -> str:
            if _negated(sentence, match.start()):
                return match.group(0)
            word = match.group(0).lower()
            if word == "实时":
                return "最近日线"
            if word in {"real-time", "realtime"}:
                return "latest daily"
            return english_price if match.group(0).isascii() else price
        return REALTIME.sub(replace, sentence)

    parts: list[str] = []
    omitted_numbers, omitted_quotes, omitted_claims = False, False, set()
    original = sentences(_strip_unknown(reply, book))
    for index, sentence in enumerate(original):
        if _uncited_motive(original, index):
            omitted_claims.add("uncited_motive")
            continue
        if _ai_review_as_user(sentence, book):
            omitted_claims.add("ai_review_as_user")
            continue
        if _unnegated(COMPLIANCE, sentence):
            if not parts or not parts[-1].startswith(COMPLIANCE_NOTE):
                parts.append(COMPLIANCE_NOTE + ("\n" if sentence.endswith("\n") else ""))
            continue
        if any(not item["grounded"] or not item["cited"] for item in _number_checks(sentence, book)):
            omitted_numbers = True
            continue
        if _quote_mismatches(sentence, book):
            omitted_quotes = True
            continue
        if _unnegated(REALTIME, sentence) and not DATED.search(sentence):
            sentence = dated(sentence)
        parts.append(sentence)
    text = "".join(parts).rstrip()
    if omitted_numbers:
        text += "\n\n" + NUMBERS_NOTE
    if omitted_quotes:
        text += "\n\n" + QUOTE_NOTE
    remaining = {issue.code for issue in check(text, book)} | omitted_claims
    return (text.strip() + "".join(f"\n\n{note}" for code, note in FIX_NOTES.items() if code in remaining)).strip()
