import re
from dataclasses import dataclass, replace
from datetime import date
from functools import partial
from typing import Annotated, Any, Callable, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from . import ledger, market, notes, portfolio


def _real_date(value: str) -> str:
    date.fromisoformat(value)
    return value


Market = Literal["CN", "HK", "US"]
IsoDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_real_date)]
Asset = Annotated[str, Field(min_length=1, max_length=80)]
TICKERS = {
    "CN": (r"\d{6}(?:\.(?:SH|SZ|BJ|SS))?", "600519"),
    "HK": (r"\d{1,5}(?:\.HK)?", "00700"),
    "US": (r"[A-Z]{1,5}(?:[.-][A-Z]{1,2})?", "AAPL"),
}
# Everything an external provider may receive: market enum, ISO date or a public ticker.
PUBLIC_VALUE = re.compile(r"CN|HK|US|\d{4}-\d{2}-\d{2}|\d{1,6}(?:\.(?:SH|SZ|BJ|SS|HK))?|[A-Z]{1,5}(?:[.-][A-Z]{1,2})?")
ASSET_HELP = "标的名称或代码，可带市场前缀，如 京东方A、000725、CN:code:000725"
DATE_HELP = "YYYY-MM-DD"


def _ticker(market_name: str, code: str | None) -> str | None:
    if code is None:
        return None
    code = code.upper()
    pattern, example = TICKERS[market_name]
    if not re.fullmatch(pattern, code):
        raise ValueError(f"code must be a public {market_name} ticker such as {example}")
    return code


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DossierArgs(Args):
    trade_id: str | None = Field(None, min_length=1, max_length=80, description="账本成交ID")
    asset: Asset | None = Field(None, description=ASSET_HELP)

    @model_validator(mode="after")
    def _one_selector(self):
        if self.trade_id is None and self.asset is None:
            raise ValueError("Provide trade_id or asset.")
        return self


class SearchNotesArgs(Args):
    query: str = Field("", max_length=80, description="单个关键词，在笔记原文中做子串匹配；留空表示查看最近笔记")
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] | None = Field(None, max_length=10, description="必须全部命中的笔记标签")
    asset: Asset | None = Field(None, description=ASSET_HELP)
    date_from: IsoDate | None = Field(None, description=DATE_HELP)
    date_to: IsoDate | None = Field(None, description=DATE_HELP)
    author: Literal["user", "ai_review", "all"] = Field("user", description="user=用户自己写的；ai_review=之前保存的AI复盘；all=全部")
    limit: int = Field(20, ge=1, le=30)


class ResolveArgs(Args):
    query: Asset = Field(description="标的名称或代码，如 京东方A、000725、00700、AAPL")
    market: Market | None = None


class SearchTradesArgs(Args):
    asset: Asset | None = Field(None, description=ASSET_HELP)
    date_from: IsoDate | None = Field(None, description=DATE_HELP)
    date_to: IsoDate | None = Field(None, description=DATE_HELP)
    side: Literal["Buy", "Sell"] | None = None
    limit: int = Field(30, ge=1, le=50)


class AssetArgs(Args):
    asset: Asset | None = Field(None, description=ASSET_HELP + "；不填表示全部")


class AsOfArgs(Args):
    as_of: IsoDate | None = Field(None, description=DATE_HELP + "；不填表示今天")


class DayArgs(Args):
    date: IsoDate = Field(description=DATE_HELP)


class PriceArgs(Args):
    market: Market
    code: str = Field(min_length=1, max_length=12, description="公开代码，如 000725、00700、AAPL")
    date_from: IsoDate | None = Field(None, description=DATE_HELP + "；默认最近30天")
    date_to: IsoDate | None = Field(None, description=DATE_HELP)

    @model_validator(mode="after")
    def _public_code(self):
        self.code = _ticker(self.market, self.code)
        return self


class IndexArgs(Args):
    market: Market


class NewsArgs(Args):
    market: Market
    code: str | None = Field(None, min_length=1, max_length=12, description="公开代码；不填表示大盘新闻")
    date_from: IsoDate | None = Field(None, description=DATE_HELP + "；默认最近7天")
    date_to: IsoDate | None = Field(None, description=DATE_HELP)

    @model_validator(mode="after")
    def _public_code(self):
        self.code = _ticker(self.market, self.code)
        return self


def _symbol(trades: list[dict]) -> str | None:
    return next((trade.get("symbol") for trade in reversed(trades) if trade.get("symbol")), None)


def _dossier_focus(result: dict, args: dict) -> dict | None:
    focus = result.get("focus") or {}
    if not focus.get("asset"):
        return None
    return {"asset": focus["asset"], "symbol": _symbol(result.get("trades") or []), "trade_id": focus.get("trade_id")}


def _resolve_focus(result: dict, args: dict) -> dict | None:
    return {"asset": result["asset"], "symbol": result.get("symbol"), "trade_id": None}


def _trades_focus(result: dict, args: dict) -> dict | None:
    trades = result.get("trades") or []
    identities = {notes._identity(trade) for trade in trades}
    if not args.get("asset") or len(identities) != 1:
        return None
    return {"asset": identities.pop(), "symbol": _symbol(trades), "trade_id": None}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args: type[Args]
    handler: Callable[..., Any]
    privacy: str
    timeout_s: float
    kind: str
    focus: Callable[[dict, dict], dict | None] | None = None
    redact: frozenset[str] = frozenset()

    def schema(self) -> dict:
        return {"type": "function", "function": {
            "name": self.name, "description": self.description, "parameters": _clean(self.args.model_json_schema()),
        }}

    def source(self, result: dict) -> str:
        if self.kind in {"market", "news"}:
            return str(result.get("source") or "Unknown source")
        return "TradingNote local records"


def _clean(schema: Any) -> Any:
    if isinstance(schema, list):
        return [_clean(item) for item in schema]
    if not isinstance(schema, dict):
        return schema
    result = {key: _clean(value) for key, value in schema.items() if not (key == "title" and isinstance(value, str))}
    options = result.get("anyOf")
    if isinstance(options, list):
        concrete = [option for option in options if option.get("type") != "null"]
        if len(concrete) == 1 and len(concrete) < len(options):
            result = {**concrete[0], **{key: value for key, value in result.items() if key != "anyOf"}}
    if "default" in result and result["default"] is None:
        del result["default"]
    if result.get("type") == "object":
        result["additionalProperties"] = False
    return result


SPECS: dict[str, ToolSpec] = {spec.name: spec for spec in (
    ToolSpec("get_trade_dossier",
             "读取某笔成交或某个标的的交易档案：最近三个记录持仓周期的成交，以及相关笔记的完整原文（交易笔记、标的笔记、当日日记）。"
             "解释买卖理由、计划、止损、情绪或复盘某个标的时首先使用。上下文里已有同一标的的预取档案时不要重复调用。",
             DossierArgs, notes.get_trade_dossier, "private_local", 3, "notes", _dossier_focus),
    ToolSpec("search_notes",
             "在用户笔记中按关键词、标签、标的、日期检索原文。适合跨标的找规律（如“止损”“追高”）或查看最近笔记（query 留空）。"
             "默认只返回用户本人的笔记；只含笔记，不含成交明细和行情。",
             SearchNotesArgs, notes.search_notes, "private_local", 3, "notes", redact=frozenset({"query", "tags"})),
    ToolSpec("resolve_instrument",
             "把标的名称或代码解析为市场和公开代码，供行情、新闻工具使用。只读本地账本和别名，不联网；"
             "source=code_format 表示仅按代码格式解析，未核实该标的是否存在。",
             ResolveArgs, ledger.resolve_instrument, "local_identity", 3, "identity", _resolve_focus),
    ToolSpec("search_trades",
             "按标的、日期、买卖方向查询账本成交明细（价格、数量、金额、费用），按日期倒序。需要具体成交事实时使用；"
             "不含笔记，解释动机请用 get_trade_dossier。",
             SearchTradesArgs, ledger.search_trades, "private_local", 3, "ledger", _trades_focus),
    ToolSpec("get_trade_stats",
             "按现有六个月规则统计已平仓多头周期的胜率、盈亏等，按币种分列。问胜率、盈亏比、整体表现时使用；样本少时结论不可靠。",
             AssetArgs, ledger.get_trade_stats, "private_local", 3, "ledger"),
    ToolSpec("get_behavior_facts",
             "读取“行为洞察”使用的只读事实：近六个月交易频率、持仓集中度、估值状态等。问交易习惯、仓位集中、交易频率时使用。",
             AsOfArgs, portfolio.get_behavior_facts, "private_local", 5, "account"),
    ToolSpec("get_portfolio",
             "读取持仓概览与估值（缓存的收盘估值，非实时）。问当前持仓、仓位、浮动盈亏时使用。",
             AsOfArgs, portfolio.get_portfolio, "private_local", 20, "account"),
    ToolSpec("get_daily_context",
             "读取某个交易日的成交、日记和已保存的复盘。问某一天发生了什么时使用。",
             DayArgs, portfolio.get_daily_context, "private_local", 5, "account"),
    ToolSpec("get_price_history",
             "公开日线行情（非实时）：区间统计、均线和最近10根日线。只接受市场、公开代码和日期；默认最近30天，最长400天。"
             "代码或市场不确定时先用 resolve_instrument。",
             PriceArgs, market.get_price_history, "public_external", 20, "market"),
    ToolSpec("get_index_snapshot",
             "主要指数最近两周日线概况（A股：上证指数、沪深300、深证成指、创业板指；港股：恒生指数；美股：标普500、纳指、道指）。问大盘时使用。",
             IndexArgs, market.get_index_snapshot, "public_external", 20, "market"),
    ToolSpec("search_news",
             "检索带日期的公开新闻（Tavily）。只接受市场、可选公开代码和日期；不传代码时检索大盘新闻。默认最近7天，最长31天。"
             "新闻不能证明某次涨跌的原因。",
             NewsArgs, market.search_news, "public_external", 15, "news"),
)}
PUBLIC_PRIVACY = {"local_identity", "public_external"}


def allowed(scope: str) -> dict[str, ToolSpec]:
    if scope == "private":
        return SPECS
    public = {name: spec for name, spec in SPECS.items() if spec.privacy in PUBLIC_PRIVACY}
    spec = public["resolve_instrument"]
    public["resolve_instrument"] = replace(spec, handler=partial(spec.handler, allow_private=False),
        description="只使用已缓存的公开标的别名或代码格式解析市场和代码，不读取账户、成交或笔记。"
                    "无法解析名称时请用户提供市场和公开代码；source=code_format 表示尚未核实代码是否存在。")
    return public


def schemas(scope: str) -> list[dict]:
    return [spec.schema() for spec in allowed(scope).values()]


def is_public(values: dict) -> bool:
    return all(value is None or isinstance(value, str) and PUBLIC_VALUE.fullmatch(value) for value in values.values())


def redacted(spec: ToolSpec, values: dict) -> dict:
    return {key: {"redacted": True, "length": len(value)} if key in spec.redact else value for key, value in values.items()}
